import { useState, useEffect } from 'react';
import { GitBranch, Shield, Activity, Wifi, WifiOff, Zap } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { AgentGrid } from './components/AgentGrid';
import { ConflictFeed } from './components/ConflictFeed';
import { SimulatorPanel } from './components/SimulatorPanel';

function App() {
  const { events, connected, clearEvents } = useWebSocket();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [daemonUp, setDaemonUp] = useState(false);

  // Check daemon health on mount
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch('/api/health');
        if (res.ok) setDaemonUp(true);
      } catch {
        setDaemonUp(false);
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Refresh the lock grid whenever a relevant WS event arrives
  useEffect(() => {
    if (events.length > 0) {
      const latest = events[0];
      if (
        latest.type === 'lock_claimed' ||
        latest.type === 'lock_released' ||
        latest.type === 'conflict_blocked' ||
        latest.type === 'ttl_expired'
      ) {
        setRefreshTrigger((n) => n + 1);
      }
    }
  }, [events]);

  return (
    <div className="min-h-screen bg-surface-0">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-surface-0/80 backdrop-blur-xl border-b border-border-dim">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent-blue/10 border border-accent-blue/20">
              <GitBranch className="w-5 h-5 text-accent-blue" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary tracking-tight flex items-center gap-2">
                BranchLock
                <span className="text-[10px] font-medium text-text-muted bg-surface-2 px-2 py-0.5 rounded-full">
                  MCP
                </span>
              </h1>
              <p className="text-xs text-text-muted -mt-0.5">
                Multi-Agent Workspace Lock Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Daemon status */}
            <div className="flex items-center gap-2">
              {daemonUp ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-accent-emerald pulse-dot" />
                  <span className="text-xs text-text-muted">Daemon online</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-accent-red" />
                  <span className="text-xs text-accent-red">Daemon offline</span>
                </>
              )}
            </div>

            {/* WS connection */}
            <div className="flex items-center gap-1.5">
              {connected ? (
                <Wifi className="w-3.5 h-3.5 text-accent-emerald" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-accent-red" />
              )}
              <span className="text-[10px] text-text-muted">
                {connected ? 'Live' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content ───────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Agent Workspace Grid */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-accent-blue" />
            <h2 className="text-sm font-semibold text-text-primary">
              Active Agent Workspaces
            </h2>
          </div>
          <AgentGrid refreshTrigger={refreshTrigger} />
        </section>

        {/* Two-column layout: Feed + Simulator */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Live Conflict Feed */}
          <section className="lg:col-span-3">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-accent-cyan" />
                <h2 className="text-sm font-semibold text-text-primary">
                  Live Event Feed
                </h2>
                {events.length > 0 && (
                  <span className="text-[10px] bg-surface-2 text-text-muted px-1.5 py-0.5 rounded-full">
                    {events.length}
                  </span>
                )}
              </div>
              {events.length > 0 && (
                <button
                  onClick={clearEvents}
                  className="text-[10px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            <ConflictFeed events={events} />
          </section>

          {/* Simulator Panel */}
          <section className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-accent-amber" />
              <h2 className="text-sm font-semibold text-text-primary">
                Demo Controls
              </h2>
            </div>
            <SimulatorPanel
              onSimulated={() => setRefreshTrigger((n) => n + 1)}
            />
          </section>
        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-border-dim mt-12 py-6">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <p className="text-xs text-text-muted">
            BranchLock MCP v0.1.0 — Multi-Agent Collision Prevention
          </p>
          <p className="text-xs text-text-muted">
            Daemon: <span className="font-mono">localhost:4000</span>
          </p>
        </div>
      </footer>
    </div>
  );
}


export default App;
