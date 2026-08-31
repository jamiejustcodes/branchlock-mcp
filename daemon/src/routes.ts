import { Router, json } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import {
  claimFiles,
  releaseFiles,
  checkLocks,
  sendHeartbeat,
  broadcastContext,
  getAuditLogs,
  normalizePath,
  storeSymbols,
  getLockedFileSymbols,
  resetAllLocks,
} from './db.js';
import { broadcast } from './ws.js';
import { extractSymbols, detectSymbolOverlaps } from './symbols.js';
import { postCompletionComment } from './webhooks.js';
import type {
  ClaimRequest,
  ReleaseRequest,
  HeartbeatRequest,
  BroadcastRequest,
  SimulateRequest,
} from '@branchlock/shared';

const router = Router();
router.use(json());

const startTime = Date.now();

// ─── Health Check ─────────────────────────────────────────────
router.get('/api/health', (_req: Request, res: Response) => {
  const locks = checkLocks();
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    lockCount: locks.locks.length,
    version: '0.1.0',
  });
});

// ─── Claim Files ──────────────────────────────────────────────
router.post('/api/locks/claim', (req: Request, res: Response) => {
  try {
    const body = req.body as ClaimRequest;

    if (!body.paths || !Array.isArray(body.paths) || body.paths.length === 0) {
      res.status(400).json({ error: 'paths must be a non-empty array' });
      return;
    }
    if (!body.agentId || typeof body.agentId !== 'string') {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const result = claimFiles(body);

    if (result.success && result.claimed) {
      // Phase 2: Extract and store symbols for each claimed file
      for (const lock of result.claimed) {
        try {
          const symbols = extractSymbols(lock.file_path);
          if (symbols.length > 0) {
            storeSymbols(lock.id, lock.file_path, symbols);
          }
        } catch (err) {
          // Symbol extraction is best-effort, don't fail the claim
          console.warn(`[routes] symbol extraction failed for ${lock.file_path}:`, err);
        }
      }

      // Phase 2: Check for symbol overlaps with other agents' locked files
      const lockedFileInfo = getLockedFileSymbols(body.agentId);
      const warnings = [];
      for (const lock of result.claimed) {
        try {
          const fileWarnings = detectSymbolOverlaps(
            lock.file_path,
            body.agentId,
            lockedFileInfo
          );
          warnings.push(...fileWarnings);
        } catch {
          // Best-effort
        }
      }

      if (warnings.length > 0) {
        result.symbolWarnings = warnings;
        broadcast('symbol_warning', {
          agentId: body.agentId,
          warnings,
        });
      }

      broadcast('lock_claimed', {
        agentId: body.agentId,
        files: body.paths.map(normalizePath),
        taskSummary: body.taskSummary,
      });
    } else {
      broadcast('conflict_blocked', {
        agentId: body.agentId,
        attempted: body.paths.map(normalizePath),
        conflicts: result.conflicts,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[routes] claim error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Release Files ────────────────────────────────────────────
router.post('/api/locks/release', (req: Request, res: Response) => {
  try {
    const body = req.body as ReleaseRequest;

    if (!body.paths || !Array.isArray(body.paths) || body.paths.length === 0) {
      res.status(400).json({ error: 'paths must be a non-empty array' });
      return;
    }
    if (!body.agentId || typeof body.agentId !== 'string') {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const result = releaseFiles(body);

    if (result.released.length > 0) {
      broadcast('lock_released', {
        agentId: body.agentId,
        files: result.released,
      });
    }

    // Phase 3: If task completed and linked to issues, post completion summary comments
    if (body.completed && result.linkedIssues && result.linkedIssues.length > 0) {
      for (const issueId of result.linkedIssues) {
        postCompletionComment(issueId, result.broadcastSummary || 'Task completed.')
          .then((res) => {
            broadcast('broadcast', {
              agentId: body.agentId,
              decisionNotes: `Task complete comment for issue ${issueId}: ${res.message}`,
              issueId,
            });
          })
          .catch((err) => {
            console.error(`[routes] failed to post completion comment for ${issueId}:`, err);
          });
      }
    }

    res.json({
      success: result.success,
      released: result.released,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error('[routes] release error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Check Locks ──────────────────────────────────────────────
router.get('/api/locks', (req: Request, res: Response) => {
  try {
    const paths = req.query.paths
      ? (req.query.paths as string).split(',')
      : undefined;
    const result = checkLocks(paths);
    res.json(result);
  } catch (err) {
    console.error('[routes] check locks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Reset All Locks (Demo / Testing helper) ──────────────────
router.post('/api/locks/reset', (_req: Request, res: Response) => {
  try {
    const count = resetAllLocks();
    broadcast('ttl_expired', { count, reason: 'manual_reset' });
    res.json({ success: true, releasedCount: count });
  } catch (err) {
    console.error('[routes] reset locks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Heartbeat ────────────────────────────────────────────────
router.post('/api/locks/heartbeat', (req: Request, res: Response) => {
  try {
    const body = req.body as HeartbeatRequest;

    if (!body.paths || !Array.isArray(body.paths) || body.paths.length === 0) {
      res.status(400).json({ error: 'paths must be a non-empty array' });
      return;
    }
    if (!body.agentId || typeof body.agentId !== 'string') {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const result = sendHeartbeat(body);

    if (result.extended.length > 0) {
      broadcast('heartbeat', {
        agentId: body.agentId,
        files: result.extended,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[routes] heartbeat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Broadcast Context ───────────────────────────────────────
router.post('/api/broadcast', (req: Request, res: Response) => {
  try {
    const body = req.body as BroadcastRequest;

    if (!body.decisionNotes || typeof body.decisionNotes !== 'string') {
      res.status(400).json({ error: 'decisionNotes is required' });
      return;
    }
    if (!body.agentId || typeof body.agentId !== 'string') {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const result = broadcastContext(body);

    broadcast('broadcast', {
      agentId: body.agentId,
      decisionNotes: body.decisionNotes,
      entryId: result.entryId,
    });

    res.json(result);
  } catch (err) {
    console.error('[routes] broadcast error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Audit Logs ───────────────────────────────────────────────
router.get('/api/logs', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = getAuditLogs(limit);
    res.json({ logs });
  } catch (err) {
    console.error('[routes] logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Simulate (Demo / Testing) ───────────────────────────────
router.post('/api/simulate', (req: Request, res: Response) => {
  try {
    const body = req.body as SimulateRequest;
    const scenario = body.scenario || 'claim';

    switch (scenario) {
      case 'claim': {
        const agentId = body.agentId || `sim-agent-${uuid().slice(0, 8)}`;
        const filePath = body.filePath || `/project/src/sim-${uuid().slice(0, 6)}.ts`;
        const result = claimFiles({
          paths: [filePath],
          agentId,
          taskSummary: `Simulated claim by ${agentId}`,
        });
        broadcast(result.success ? 'lock_claimed' : 'conflict_blocked', {
          agentId,
          files: [filePath],
          simulated: true,
          ...result,
        });
        res.json({ scenario: 'claim', result });
        break;
      }

      case 'conflict': {
        // Create a lock first, then try to claim with a different agent
        const filePath = body.filePath || '/project/src/auth.ts';
        const agent1 = 'Claude-Code-01';
        const agent2 = body.agentId || 'Cursor-Dev';

        // Ensure agent1 has the lock
        const claimResult = claimFiles({
          paths: [filePath],
          agentId: agent1,
          taskSummary: 'Refactoring authentication middleware',
        });

        if (claimResult.success) {
          broadcast('lock_claimed', {
            agentId: agent1,
            files: [filePath],
            taskSummary: 'Refactoring authentication middleware',
            simulated: true,
          });
        }

        // Now agent2 tries to claim — should conflict
        const conflictResult = claimFiles({
          paths: [filePath],
          agentId: agent2,
          taskSummary: 'Adding OAuth2 support',
        });

        broadcast('conflict_blocked', {
          agentId: agent2,
          attempted: [filePath],
          conflicts: conflictResult.conflicts,
          simulated: true,
        });

        res.json({
          scenario: 'conflict',
          agent1Claim: claimResult,
          agent2Conflict: conflictResult,
        });
        break;
      }

      case 'broadcast': {
        const agentId = body.agentId || 'Claude-Code-01';
        const result = broadcastContext({
          agentId,
          decisionNotes: 'Decided to use JWT tokens instead of session cookies for stateless auth. All auth endpoints should validate Bearer tokens.',
        });
        broadcast('broadcast', {
          agentId,
          decisionNotes: 'Decided to use JWT tokens instead of session cookies for stateless auth.',
          simulated: true,
        });
        res.json({ scenario: 'broadcast', result });
        break;
      }

      default:
        res.status(400).json({ error: `Unknown scenario: ${scenario}` });
    }
  } catch (err) {
    console.error('[routes] simulate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
