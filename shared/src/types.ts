// ─── Lock Record ───────────────────────────────────────────────
export interface Lock {
  id: string;
  file_path: string;
  agent_id: string;
  task_summary: string;
  claimed_at: string;
  expires_at: string;
  last_heartbeat_at: string;
  status: 'active' | 'released';
  issue_id?: string;
}

// ─── Audit Log Entry ──────────────────────────────────────────
export type AuditAction =
  | 'CLAIM'
  | 'RELEASE'
  | 'CONFLICT_TRIGGERED'
  | 'HEARTBEAT'
  | 'BROADCAST';

export interface AuditEntry {
  id: string;
  timestamp: string;
  agent_id: string;
  action: AuditAction;
  details: string;
}

// ─── WebSocket Event Types ────────────────────────────────────
export type EventType =
  | 'lock_claimed'
  | 'lock_released'
  | 'conflict_blocked'
  | 'broadcast'
  | 'heartbeat'
  | 'symbol_warning'
  | 'ttl_expired';

export interface WSEvent {
  id: string;
  type: EventType;
  data: Record<string, unknown>;
  timestamp: string;
}

// ─── API Request / Response Shapes ────────────────────────────
export interface ClaimRequest {
  paths: string[];
  agentId: string;
  taskSummary: string;
  ttlMinutes?: number;
  issueId?: string;
}

export interface ClaimResponse {
  success: boolean;
  claimed?: Lock[];
  conflicts?: Array<{
    file_path: string;
    held_by: string;
    task_summary: string;
    expires_at: string;
  }>;
  symbolWarnings?: SymbolWarning[];
}

export interface ReleaseRequest {
  paths: string[];
  agentId: string;
  completed?: boolean;
}

export interface ReleaseResponse {
  success: boolean;
  released: string[];
  skipped: string[];
}

export interface HeartbeatRequest {
  paths: string[];
  agentId: string;
}

export interface HeartbeatResponse {
  success: boolean;
  extended: string[];
  notFound: string[];
}

export interface BroadcastRequest {
  decisionNotes: string;
  agentId: string;
}

export interface BroadcastResponse {
  success: boolean;
  entryId: string;
}

export interface CheckLocksResponse {
  locks: Lock[];
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  lockCount: number;
  version: string;
}

export interface SimulateRequest {
  scenario: 'claim' | 'conflict' | 'broadcast';
  agentId?: string;
  filePath?: string;
}

// ─── Symbol Analysis (Phase 2) ────────────────────────────────
export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum';
  exported: boolean;
  line: number;
}

export interface SymbolWarning {
  sourceFile: string;
  sourceAgent: string;
  targetFile: string;
  targetAgent: string;
  symbolName: string;
  message: string;
}

// ─── Webhook (Phase 3) ───────────────────────────────────────
export interface WebhookPayload {
  provider: 'github' | 'linear';
  event: string;
  data: Record<string, unknown>;
}

// ─── Constants ────────────────────────────────────────────────
export const DAEMON_PORT = 4000;
export const DAEMON_HOST = 'http://localhost';
export const DAEMON_URL = `${DAEMON_HOST}:${DAEMON_PORT}`;
export const DEFAULT_TTL_MINUTES = 15;
export const SWEEP_INTERVAL_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const PID_DIR = '.branchlock';
export const PID_FILE = 'daemon.pid';
export const DB_FILE = 'branchlock.db';
