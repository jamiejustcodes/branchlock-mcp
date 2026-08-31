#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureDaemon } from './lifecycle.js';
import { get, post } from './daemon-client.js';
import { HEARTBEAT_INTERVAL_MS } from '@branchlock/shared';
import type {
  ClaimResponse,
  ReleaseResponse,
  HeartbeatResponse,
  BroadcastResponse,
  CheckLocksResponse,
} from '@branchlock/shared';

function log(msg: string): void {
  // CRITICAL: adapter must NEVER write to stdout — only stderr
  process.stderr.write(`[branchlock-adapter] ${msg}\n`);
}

// Track claimed files for automatic heartbeat
const heldLocks = new Map<string, Set<string>>(); // agentId -> Set<filePaths>
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeatLoop(): void {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(async () => {
    for (const [agentId, paths] of heldLocks.entries()) {
      if (paths.size === 0) continue;
      try {
        await post('/api/locks/heartbeat', {
          paths: Array.from(paths),
          agentId,
        });
        log(`heartbeat sent for ${agentId} (${paths.size} files)`);
      } catch (err) {
        log(`heartbeat failed for ${agentId}: ${err}`);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function trackClaim(agentId: string, paths: string[]): void {
  if (!heldLocks.has(agentId)) {
    heldLocks.set(agentId, new Set());
  }
  const set = heldLocks.get(agentId)!;
  for (const p of paths) set.add(p);
  startHeartbeatLoop();
}

function trackRelease(agentId: string, paths: string[]): void {
  const set = heldLocks.get(agentId);
  if (!set) return;
  for (const p of paths) set.delete(p);
  if (set.size === 0) heldLocks.delete(agentId);

  // Stop heartbeat if no locks held anywhere
  if (heldLocks.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function main(): Promise<void> {
  log('starting BranchLock MCP adapter...');

  // Ensure the daemon is running before registering tools
  await ensureDaemon();

  const server = new McpServer({
    name: 'branchlock',
    version: '0.1.0',
  });

  // ─── Tool: claim_files ──────────────────────────────────────
  server.tool(
    'claim_files',
    'Claim exclusive locks on one or more files before editing them. Prevents other AI agents from creating merge conflicts by working on the same files simultaneously. Returns conflict details if any file is already locked by another agent.',
    {
      paths: z.array(z.string()).describe('Array of file paths to claim (relative or absolute)'),
      agentId: z.string().describe('Unique identifier for this agent (e.g., "Claude-Code-01", "Cursor-Dev")'),
      taskSummary: z.string().describe('Brief description of what you plan to do with these files'),
      ttlMinutes: z.number().optional().describe('Lock TTL in minutes (default: 15). Locks auto-expire after this time unless heartbeat extends them.'),
      issueId: z.string().optional().describe('Optional GitHub/Linear issue ID to link this work to'),
    },
    async ({ paths, agentId, taskSummary, ttlMinutes, issueId }) => {
      try {
        const result = (await post('/api/locks/claim', {
          paths,
          agentId,
          taskSummary,
          ttlMinutes,
          issueId,
        })) as ClaimResponse;

        if (result.success) {
          // Track for auto-heartbeat
          trackClaim(agentId, paths);

          return {
            content: [
              {
                type: 'text' as const,
                text: `✅ Successfully claimed ${paths.length} file(s):\n${paths.map((p) => `  • ${p}`).join('\n')}\n\nLocks will auto-expire in ${ttlMinutes ?? 15} minutes unless extended by heartbeat.`,
              },
            ],
          };
        } else {
          const conflictLines = (result.conflicts ?? []).map(
            (c) => `  ⚠️ ${c.file_path} — held by ${c.held_by} (${c.task_summary})`
          );

          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Claim blocked — the following files are already locked:\n${conflictLines.join('\n')}\n\nWait for the other agent to release these files, or coordinate via broadcast_context.`,
              },
            ],
          };
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error claiming files: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: release_files ────────────────────────────────────
  server.tool(
    'release_files',
    'Release your locks on files when you are done editing them. Only releases locks owned by your agent. Call this when your task on these files is complete.',
    {
      paths: z.array(z.string()).describe('Array of file paths to release'),
      agentId: z.string().describe('Your agent identifier'),
      completed: z.boolean().optional().describe('Set to true if the task on these files is fully complete'),
    },
    async ({ paths, agentId, completed }) => {
      try {
        const result = (await post('/api/locks/release', {
          paths,
          agentId,
          completed,
        })) as ReleaseResponse;

        trackRelease(agentId, result.released);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Released ${result.released.length} file(s):\n${result.released.map((p) => `  ✓ ${p}`).join('\n')}${
                result.skipped.length > 0
                  ? `\n\nSkipped (not owned by you):\n${result.skipped.map((p) => `  - ${p}`).join('\n')}`
                  : ''
              }`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error releasing files: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: check_file_locks ─────────────────────────────────
  server.tool(
    'check_file_locks',
    'Check which files are currently locked and by which agents. Use this before starting work to see if any files you need are already claimed by another agent.',
    {
      paths: z
        .array(z.string())
        .optional()
        .describe('Optional list of specific file paths to check. Omit to see all active locks.'),
    },
    async ({ paths }) => {
      try {
        let url = '/api/locks';
        if (paths && paths.length > 0) {
          url += `?paths=${paths.join(',')}`;
        }
        const result = (await get(url)) as CheckLocksResponse;

        if (result.locks.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No active locks. All files are available.' }],
          };
        }

        const lockLines = result.locks.map(
          (l) =>
            `  🔒 ${l.file_path}\n     Agent: ${l.agent_id}\n     Task: ${l.task_summary}\n     Expires: ${l.expires_at}`
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: `Active locks (${result.locks.length}):\n${lockLines.join('\n\n')}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error checking locks: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: broadcast_context ────────────────────────────────
  server.tool(
    'broadcast_context',
    'Broadcast an architectural decision or important context to all other agents and the dashboard. Use this to communicate decisions that affect the shared codebase (e.g., "switching auth to JWT", "database schema change").',
    {
      decisionNotes: z
        .string()
        .describe('The architectural decision or context to broadcast to other agents'),
      agentId: z.string().describe('Your agent identifier'),
    },
    async ({ decisionNotes, agentId }) => {
      try {
        const result = (await post('/api/broadcast', {
          decisionNotes,
          agentId,
        })) as BroadcastResponse;

        return {
          content: [
            {
              type: 'text' as const,
              text: `📢 Broadcast sent successfully (id: ${result.entryId}).\nAll connected agents and dashboards have been notified.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error broadcasting: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: send_heartbeat ───────────────────────────────────
  server.tool(
    'send_heartbeat',
    'Extend the TTL on your active locks. Call this if your task is taking longer than expected to prevent locks from auto-expiring. The adapter also sends heartbeats automatically in the background.',
    {
      paths: z.array(z.string()).describe('Array of file paths to extend locks on'),
      agentId: z.string().describe('Your agent identifier'),
    },
    async ({ paths, agentId }) => {
      try {
        const result = (await post('/api/locks/heartbeat', {
          paths,
          agentId,
        })) as HeartbeatResponse;

        return {
          content: [
            {
              type: 'text' as const,
              text: `💓 Heartbeat: extended TTL for ${result.extended.length} file(s).${
                result.notFound.length > 0
                  ? `\nNot found (may have expired): ${result.notFound.join(', ')}`
                  : ''
              }`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error sending heartbeat: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server connected via stdio');
}

main().catch((err) => {
  process.stderr.write(`[branchlock-adapter] fatal error: ${err}\n`);
  process.exit(1);
});
