import { useEffect, useState, useMemo } from 'react';
import { Lock, FileText, Timer, User, Shield } from 'lucide-react';

interface LockData {
  id: string;
  file_path: string;
  agent_id: string;
  task_summary: string;
  claimed_at: string;
  expires_at: string;
  status: string;
}

interface AgentGroup {
  agentId: string;
  locks: LockData[];
  color: string;
  glow: string;
}

const AGENT_COLORS: Array<{ color: string; glow: string; accent: string }> = [
  { color: 'border-accent-blue', glow: 'glow-blue', accent: 'text-accent-blue' },
  { color: 'border-accent-violet', glow: 'glow-violet', accent: 'text-accent-violet' },
  { color: 'border-accent-emerald', glow: 'glow-emerald', accent: 'text-accent-emerald' },
  { color: 'border-accent-amber', glow: 'glow-amber', accent: 'text-accent-amber' },
  { color: 'border-accent-cyan', glow: 'glow-blue', accent: 'text-accent-cyan' },
];

function getAgentColorIndex(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % AGENT_COLORS.length;
}

function TTLCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function update() {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('expired');
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}m ${secs.toString().padStart(2, '0')}s`);
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isLow = (() => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return diff < 120_000; // < 2 min
  })();

  return (
    <span className={`font-mono text-xs ${isLow ? 'text-accent-red' : 'text-text-muted'}`}>
      <Timer className="inline w-3 h-3 mr-1 -mt-px" />
      {remaining}
    </span>
  );
}

export function AgentGrid({ refreshTrigger }: { refreshTrigger: number }) {
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLocks() {
      try {
        const res = await fetch('/api/locks');
        const data = await res.json();
        const locks: LockData[] = data.locks || [];

        // Group by agent and deduplicate by canonical file_path
        const map = new Map<string, Map<string, LockData>>();
        for (const lock of locks) {
          if (!map.has(lock.agent_id)) {
            map.set(lock.agent_id, new Map());
          }
          map.get(lock.agent_id)!.set(lock.file_path, lock);
        }

        const agentGroups: AgentGroup[] = Array.from(map.entries()).map(
          ([agentId, lockMap]) => {
            const idx = getAgentColorIndex(agentId);
            return {
              agentId,
              locks: Array.from(lockMap.values()),
              color: AGENT_COLORS[idx].color,
              glow: AGENT_COLORS[idx].glow,
            };
          }
        );

        setGroups(agentGroups);
      } catch {
        // Daemon might not be up yet
      } finally {
        setLoading(false);
      }
    }

    fetchLocks();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card p-6 shimmer h-40" />
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <Shield className="w-12 h-12 text-text-muted mx-auto mb-3 opacity-40" />
        <p className="text-text-secondary text-sm">
          No active locks. All files are available.
        </p>
        <p className="text-text-muted text-xs mt-1">
          Use the simulator below to test conflict scenarios.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {groups.map((group) => {
        const idx = getAgentColorIndex(group.agentId);
        const colors = AGENT_COLORS[idx];

        return (
          <div
            key={group.agentId}
            className={`glass-card-hover p-5 border-l-4 ${colors.color} ${group.glow} animate-slide-in`}
          >
            <div className="flex items-center gap-2 mb-3">
              <User className={`w-4 h-4 ${colors.accent}`} />
              <h3 className="font-semibold text-sm text-text-primary truncate">
                {group.agentId}
              </h3>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-accent-emerald pulse-dot" />
                <span className="text-xs text-text-muted">{group.locks.length} file(s)</span>
              </span>
            </div>

            <p className="text-xs text-text-secondary mb-3 line-clamp-2">
              {group.locks[0]?.task_summary || 'No task summary'}
            </p>

            <div className="space-y-1.5">
              {group.locks.map((lock) => (
                <div
                  key={lock.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-surface-0/60"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <span className="font-mono text-xs text-text-secondary truncate">
                      {lock.file_path.split('/').slice(-2).join('/')}
                    </span>
                  </span>
                  <TTLCountdown expiresAt={lock.expires_at} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
