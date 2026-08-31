import Database from 'better-sqlite3';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import type {
  Lock,
  AuditEntry,
  AuditAction,
  ClaimRequest,
  ClaimResponse,
  ReleaseRequest,
  ReleaseResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  BroadcastRequest,
  BroadcastResponse,
  CheckLocksResponse,
  ExtractedSymbol,
} from '@branchlock/shared';
import { DEFAULT_TTL_MINUTES, DB_FILE } from '@branchlock/shared';

let db: Database.Database;

// ─── Path Normalization ───────────────────────────────────────
// Resolve to absolute, forward slashes, lowercase drive letter on Windows
export function normalizePath(filePath: string): string {
  let resolved = path.resolve(filePath);
  // Normalize separators to forward slashes
  resolved = resolved.replace(/\\/g, '/');
  // Lowercase drive letter on Windows (C: → c:)
  if (/^[A-Z]:\//.test(resolved)) {
    resolved = resolved[0].toLowerCase() + resolved.slice(1);
  }
  return resolved;
}

// ─── Database Setup ───────────────────────────────────────────
export function initDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DB_FILE;
  db = new Database(resolvedPath);

  // Enable WAL mode for concurrent reads/writes
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS locks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_summary TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'released')) DEFAULT 'active',
      issue_id TEXT DEFAULT NULL
    );

    try {
      db.exec("ALTER TABLE locks ADD COLUMN issue_id TEXT DEFAULT NULL;");
    } catch {
      // column already exists in schema
    }

    -- Partial unique index: only one active lock per file path at a time
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_file_lock
    ON locks(file_path) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('CLAIM', 'RELEASE', 'CONFLICT_TRIGGERED', 'HEARTBEAT', 'BROADCAST')),
      details TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_locks_status ON locks(status);

    CREATE TABLE IF NOT EXISTS lock_symbols (
      id TEXT PRIMARY KEY,
      lock_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      symbol_kind TEXT NOT NULL,
      exported INTEGER NOT NULL DEFAULT 1,
      line INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (lock_id) REFERENCES locks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_lock_symbols_lock_id ON lock_symbols(lock_id);
    CREATE INDEX IF NOT EXISTS idx_lock_symbols_file_path ON lock_symbols(file_path);
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ─── Lock Operations ──────────────────────────────────────────

/**
 * Atomically claim a set of file paths for an agent.
 * If any path is already actively locked by a *different* agent, the entire
 * claim is rejected and a conflict response is returned.
 */
export function claimFiles(req: ClaimRequest): ClaimResponse {
  const d = getDb();
  const now = new Date().toISOString();
  const ttl = req.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();

  const normalized = req.paths.map(normalizePath);

  // Run the entire check-and-insert in a single transaction
  const result = d.transaction(() => {
    // Check for active conflicts (not expired and not owned by this agent)
    const conflicts: ClaimResponse['conflicts'] = [];

    const checkStmt = d.prepare(`
      SELECT file_path, agent_id, task_summary, expires_at
      FROM locks
      WHERE file_path = ? AND status = 'active' AND expires_at > ? AND agent_id != ?
    `);

    for (const fp of normalized) {
      const existing = checkStmt.get(fp, now, req.agentId) as
        | { file_path: string; agent_id: string; task_summary: string; expires_at: string }
        | undefined;

      if (existing) {
        conflicts.push({
          file_path: existing.file_path,
          held_by: existing.agent_id,
          task_summary: existing.task_summary,
          expires_at: existing.expires_at,
        });
      }
    }

    if (conflicts.length > 0) {
      // Log the conflict
      d.prepare(`
        INSERT INTO audit_log (id, timestamp, agent_id, action, details)
        VALUES (?, ?, ?, 'CONFLICT_TRIGGERED', ?)
      `).run(
        uuid(),
        now,
        req.agentId,
        JSON.stringify({ attempted: normalized, conflicts })
      );

      return { success: false, conflicts } as ClaimResponse;
    }

    // All clear — claim all paths
    const insertStmt = d.prepare(`
      INSERT INTO locks (id, file_path, agent_id, task_summary, issue_id, claimed_at, expires_at, last_heartbeat_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      ON CONFLICT(file_path) WHERE status = 'active' DO UPDATE SET
        agent_id = excluded.agent_id,
        task_summary = excluded.task_summary,
        issue_id = excluded.issue_id,
        claimed_at = excluded.claimed_at,
        expires_at = excluded.expires_at,
        last_heartbeat_at = excluded.last_heartbeat_at
    `);

    const claimed: Lock[] = [];

    for (const fp of normalized) {
      const lockId = uuid();
      insertStmt.run(lockId, fp, req.agentId, req.taskSummary, req.issueId ?? null, now, expiresAt, now);
      claimed.push({
        id: lockId,
        file_path: fp,
        agent_id: req.agentId,
        task_summary: req.taskSummary,
        issue_id: req.issueId,
        claimed_at: now,
        expires_at: expiresAt,
        last_heartbeat_at: now,
        status: 'active',
      });
    }

    // Log the claim
    d.prepare(`
      INSERT INTO audit_log (id, timestamp, agent_id, action, details)
      VALUES (?, ?, ?, 'CLAIM', ?)
    `).run(uuid(), now, req.agentId, JSON.stringify({ files: normalized, ttlMinutes: ttl, issueId: req.issueId }));

    return { success: true, claimed } as ClaimResponse;
  })();

  return result;
}

/**
 * Release locks owned by a specific agent on the given file paths.
 */
export function releaseFiles(req: ReleaseRequest): ReleaseResponse & { linkedIssues?: string[]; broadcastSummary?: string } {
  const d = getDb();
  const now = new Date().toISOString();
  const normalized = req.paths.map(normalizePath);

  const released: string[] = [];
  const skipped: string[] = [];
  let linkedIssues: string[] = [];
  let broadcastSummary = '';

  const releaseStmt = d.prepare(`
    UPDATE locks SET status = 'released'
    WHERE file_path = ? AND agent_id = ? AND status = 'active'
  `);

  d.transaction(() => {
    // If completed is true, check for linked issue IDs before releasing
    if (req.completed) {
      const getIssuesStmt = d.prepare(`
        SELECT DISTINCT issue_id FROM locks
        WHERE file_path = ? AND agent_id = ? AND status = 'active' AND issue_id IS NOT NULL
      `);
      for (const fp of normalized) {
        const row = getIssuesStmt.get(fp, req.agentId) as { issue_id: string } | undefined;
        if (row?.issue_id && !linkedIssues.includes(row.issue_id)) {
          linkedIssues.push(row.issue_id);
        }
      }

      // Fetch recent broadcasts to form the context summary
      const broadcastRows = d.prepare(`
        SELECT details FROM audit_log
        WHERE agent_id = ? AND action = 'BROADCAST'
        ORDER BY timestamp DESC LIMIT 3
      `).all(req.agentId) as Array<{ details: string }>;

      if (broadcastRows.length > 0) {
        broadcastSummary = broadcastRows.map((b) => b.details).join('\n\n');
      } else {
        broadcastSummary = `Completed work on files: ${normalized.map((p) => path.basename(p)).join(', ')}`;
      }
    }

    for (const fp of normalized) {
      const result = releaseStmt.run(fp, req.agentId);
      if (result.changes > 0) {
        released.push(fp);
      } else {
        skipped.push(fp);
      }
    }

    if (released.length > 0) {
      d.prepare(`
        INSERT INTO audit_log (id, timestamp, agent_id, action, details)
        VALUES (?, ?, ?, 'RELEASE', ?)
      `).run(
        uuid(),
        now,
        req.agentId,
        JSON.stringify({
          files: released,
          completed: req.completed ?? false,
          linkedIssues,
        })
      );
    }
  })();

  return { success: true, released, skipped, linkedIssues, broadcastSummary };
}

/**
 * Return all active locks. Treats expired rows as effectively released
 * in the query itself (never trust the sweep alone).
 */
export function checkLocks(paths?: string[]): CheckLocksResponse {
  const d = getDb();
  const now = new Date().toISOString();

  let rows: Lock[];

  if (paths && paths.length > 0) {
    const normalized = paths.map(normalizePath);
    const placeholders = normalized.map(() => '?').join(', ');
    rows = d.prepare(`
      SELECT * FROM locks
      WHERE status = 'active' AND expires_at > ?
      AND file_path IN (${placeholders})
    `).all(now, ...normalized) as Lock[];
  } else {
    rows = d.prepare(`
      SELECT * FROM locks
      WHERE status = 'active' AND expires_at > ?
    `).all(now) as Lock[];
  }

  return { locks: rows };
}

/**
 * Extend TTL for active locks via heartbeat.
 */
export function sendHeartbeat(req: HeartbeatRequest): HeartbeatResponse {
  const d = getDb();
  const now = new Date().toISOString();
  const newExpiry = new Date(Date.now() + DEFAULT_TTL_MINUTES * 60_000).toISOString();
  const normalized = req.paths.map(normalizePath);

  const extended: string[] = [];
  const notFound: string[] = [];

  const updateStmt = d.prepare(`
    UPDATE locks SET expires_at = ?, last_heartbeat_at = ?
    WHERE file_path = ? AND agent_id = ? AND status = 'active'
  `);

  d.transaction(() => {
    for (const fp of normalized) {
      const result = updateStmt.run(newExpiry, now, fp, req.agentId);
      if (result.changes > 0) {
        extended.push(fp);
      } else {
        notFound.push(fp);
      }
    }

    if (extended.length > 0) {
      d.prepare(`
        INSERT INTO audit_log (id, timestamp, agent_id, action, details)
        VALUES (?, ?, ?, 'HEARTBEAT', ?)
      `).run(uuid(), now, req.agentId, JSON.stringify({ files: extended }));
    }
  })();

  return { success: true, extended, notFound };
}

/**
 * Broadcast architectural context to all connected dashboards.
 */
export function broadcastContext(req: BroadcastRequest): BroadcastResponse {
  const d = getDb();
  const now = new Date().toISOString();
  const entryId = uuid();

  d.prepare(`
    INSERT INTO audit_log (id, timestamp, agent_id, action, details)
    VALUES (?, ?, ?, 'BROADCAST', ?)
  `).run(entryId, now, req.agentId, req.decisionNotes);

  return { success: true, entryId };
}

/**
 * Get recent audit log entries.
 */
export function getAuditLogs(limit: number = 100): AuditEntry[] {
  const d = getDb();
  return d.prepare(`
    SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?
  `).all(limit) as AuditEntry[];
}

/**
 * Sweep expired locks — set status to 'released' and log the TTL expiry.
 */
export function sweepExpiredLocks(): number {
  const d = getDb();
  const now = new Date().toISOString();

  const expired = d.prepare(`
    SELECT id, file_path, agent_id FROM locks
    WHERE status = 'active' AND expires_at <= ?
  `).all(now) as Array<{ id: string; file_path: string; agent_id: string }>;

  if (expired.length === 0) return 0;

  d.transaction(() => {
    const releaseStmt = d.prepare(`UPDATE locks SET status = 'released' WHERE id = ?`);
    const logStmt = d.prepare(`
      INSERT INTO audit_log (id, timestamp, agent_id, action, details)
      VALUES (?, ?, ?, 'RELEASE', ?)
    `);

    for (const lock of expired) {
      releaseStmt.run(lock.id);
      logStmt.run(uuid(), now, lock.agent_id, JSON.stringify({
        file: lock.file_path,
        reason: 'ttl_expired',
      }));
    }
  })();

  return expired.length;
}

/**
 * Close the database connection cleanly.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}

// ─── Symbol Storage (Phase 2) ────────────────────────────────

/**
 * Store extracted symbols for a lock. Called after a successful claim.
 */
export function storeSymbols(lockId: string, filePath: string, symbols: ExtractedSymbol[]): void {
  const d = getDb();
  const insertStmt = d.prepare(`
    INSERT INTO lock_symbols (id, lock_id, file_path, symbol_name, symbol_kind, exported, line)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  d.transaction(() => {
    for (const sym of symbols) {
      insertStmt.run(uuid(), lockId, filePath, sym.name, sym.kind, sym.exported ? 1 : 0, sym.line);
    }
  })();
}

/**
 * Get all symbols from files currently locked by other agents.
 * Used for overlap detection when a new file is claimed.
 */
export function getLockedFileSymbols(excludeAgent: string): Array<{
  filePath: string;
  agentId: string;
  symbols: ExtractedSymbol[];
}> {
  const d = getDb();
  const now = new Date().toISOString();

  // Get active locks by other agents
  const locks = d.prepare(`
    SELECT id, file_path, agent_id FROM locks
    WHERE status = 'active' AND expires_at > ? AND agent_id != ?
  `).all(now, excludeAgent) as Array<{ id: string; file_path: string; agent_id: string }>;

  const result: Array<{ filePath: string; agentId: string; symbols: ExtractedSymbol[] }> = [];

  const getSymStmt = d.prepare(`
    SELECT symbol_name, symbol_kind, exported, line FROM lock_symbols WHERE lock_id = ?
  `);

  for (const lock of locks) {
    const rows = getSymStmt.all(lock.id) as Array<{
      symbol_name: string;
      symbol_kind: string;
      exported: number;
      line: number;
    }>;

    result.push({
      filePath: lock.file_path,
      agentId: lock.agent_id,
      symbols: rows.map((r) => ({
        name: r.symbol_name,
        kind: r.symbol_kind as ExtractedSymbol['kind'],
        exported: r.exported === 1,
        line: r.line,
      })),
    });
  }

  return result;
}
