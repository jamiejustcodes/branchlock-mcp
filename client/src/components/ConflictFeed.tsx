import { AlertTriangle, Radio, MessageSquare, Heart, Clock, Lock, Unlock } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

function getEventIcon(type: string) {
  switch (type) {
    case 'conflict_blocked':
      return <AlertTriangle className="w-4 h-4 text-accent-red" />;
    case 'lock_claimed':
      return <Lock className="w-4 h-4 text-accent-blue" />;
    case 'lock_released':
      return <Unlock className="w-4 h-4 text-accent-emerald" />;
    case 'broadcast':
      return <MessageSquare className="w-4 h-4 text-accent-violet" />;
    case 'heartbeat':
      return <Heart className="w-4 h-4 text-accent-cyan" />;
    case 'ttl_expired':
      return <Clock className="w-4 h-4 text-accent-amber" />;
    default:
      return <Radio className="w-4 h-4 text-text-muted" />;
  }
}

function getEventLabel(type: string): string {
  switch (type) {
    case 'conflict_blocked':
      return 'CONFLICT';
    case 'lock_claimed':
      return 'CLAIMED';
    case 'lock_released':
      return 'RELEASED';
    case 'broadcast':
      return 'BROADCAST';
    case 'heartbeat':
      return 'HEARTBEAT';
    case 'ttl_expired':
      return 'TTL EXPIRED';
    default:
      return type.toUpperCase();
  }
}

function getEventColor(type: string): string {
  switch (type) {
    case 'conflict_blocked':
      return 'border-accent-red/30 bg-accent-red/5';
    case 'lock_claimed':
      return 'border-accent-blue/20 bg-accent-blue/5';
    case 'lock_released':
      return 'border-accent-emerald/20 bg-accent-emerald/5';
    case 'broadcast':
      return 'border-accent-violet/20 bg-accent-violet/5';
    case 'heartbeat':
      return 'border-accent-cyan/10 bg-transparent';
    case 'ttl_expired':
      return 'border-accent-amber/20 bg-accent-amber/5';
    default:
      return 'border-border-dim bg-transparent';
  }
}

function formatEventMessage(event: WSEvent): string {
  const { type, data } = event;
  const agentId = (data.agentId as string) || 'unknown';
  const files = (data.files as string[]) || [];
  const simTag = data.simulated ? ' [simulated]' : '';

  switch (type) {
    case 'conflict_blocked': {
      const conflicts = (data.conflicts as Array<{ file_path: string; held_by: string }>) || [];
      const fileList = conflicts.map((c) => c.file_path.split('/').pop()).join(', ');
      const heldBy = conflicts[0]?.held_by || 'another agent';
      return `⚠️ ${agentId} attempted to touch ${fileList}, locked by ${heldBy}${simTag}`;
    }
    case 'lock_claimed': {
      if (data.message) return data.message as string;
      const fileList = files.map((f) => (f as string).split('/').pop()).join(', ');
      return `🔒 ${agentId} claimed ${fileList}${simTag}`;
    }
    case 'lock_released': {
      const fileList = files.map((f) => (f as string).split('/').pop()).join(', ');
      return `🔓 ${agentId} released ${fileList}${simTag}`;
    }
    case 'broadcast': {
      const notes = (data.decisionNotes as string) || '';
      return `📢 ${agentId}: ${notes.slice(0, 120)}${notes.length > 120 ? '…' : ''}${simTag}`;
    }
    case 'heartbeat': {
      return `💓 ${agentId} heartbeat (${files.length} files)`;
    }
    case 'ttl_expired': {
      const count = (data.count as number) || 0;
      return `⏰ ${count} lock(s) expired due to TTL`;
    }
    default:
      return JSON.stringify(data).slice(0, 100);
  }
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

interface ConflictFeedProps {
  events: WSEvent[];
  showHeartbeats?: boolean;
}

export function ConflictFeed({ events, showHeartbeats = false }: ConflictFeedProps) {
  const filtered = showHeartbeats
    ? events
    : events.filter((e) => e.type !== 'heartbeat');

  if (filtered.length === 0) {
    return (
      <div className="glass-card p-6 text-center">
        <Radio className="w-10 h-10 text-text-muted mx-auto mb-3 opacity-30" />
        <p className="text-text-secondary text-sm">No events yet.</p>
        <p className="text-text-muted text-xs mt-1">
          Events will appear here in real-time when agents interact.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
      {filtered.map((event, i) => (
        <div
          key={event.id || `${event.type}-${event.timestamp}-${i}`}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${getEventColor(
            event.type
          )} animate-slide-in`}
          style={{ animationDelay: `${i * 30}ms` }}
        >
          <span className="mt-0.5 shrink-0">{getEventIcon(event.type)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-semibold tracking-wider text-text-muted uppercase">
                {getEventLabel(event.type)}
              </span>
              <span className="text-[10px] text-text-muted ml-auto shrink-0">
                {timeAgo(event.timestamp)}
              </span>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              {formatEventMessage(event)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
