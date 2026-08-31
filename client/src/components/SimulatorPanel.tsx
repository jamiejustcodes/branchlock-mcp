import { useState } from 'react';
import { Play, Zap, MessageCircle, Loader2 } from 'lucide-react';

interface SimulatorPanelProps {
  onSimulated: () => void;
}

export function SimulatorPanel({ onSimulated }: SimulatorPanelProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function simulate(scenario: 'claim' | 'conflict' | 'broadcast') {
    setLoading(scenario);
    setLastResult(null);

    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      const data = await res.json();
      setLastResult(`✅ ${scenario} scenario triggered successfully`);
      onSimulated();
    } catch (err) {
      setLastResult(`❌ Failed: ${err}`);
    } finally {
      setLoading(null);
    }
  }

  const buttons = [
    {
      scenario: 'claim' as const,
      label: 'Simulate Claim',
      description: 'An agent claims a file',
      icon: Play,
      color:
        'bg-accent-blue/10 border-accent-blue/20 hover:bg-accent-blue/20 hover:border-accent-blue/40 text-accent-blue',
    },
    {
      scenario: 'conflict' as const,
      label: 'Simulate Conflict',
      description: 'Two agents clash on the same file',
      icon: Zap,
      color:
        'bg-accent-red/10 border-accent-red/20 hover:bg-accent-red/20 hover:border-accent-red/40 text-accent-red',
    },
    {
      scenario: 'broadcast' as const,
      label: 'Simulate Broadcast',
      description: 'An agent shares a design decision',
      icon: MessageCircle,
      color:
        'bg-accent-violet/10 border-accent-violet/20 hover:bg-accent-violet/20 hover:border-accent-violet/40 text-accent-violet',
    },
  ];

  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-1">
        Manual Simulator
      </h3>
      <p className="text-xs text-text-muted mb-4">
        Trigger demo scenarios without needing a real agent connected.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {buttons.map((btn) => {
          const Icon = btn.icon;
          const isLoading = loading === btn.scenario;

          return (
            <button
              key={btn.scenario}
              onClick={() => simulate(btn.scenario)}
              disabled={loading !== null}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 cursor-pointer
                ${btn.color}
                disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Icon className="w-5 h-5" />
              )}
              <span className="text-xs font-medium">{btn.label}</span>
              <span className="text-[10px] text-text-muted text-center leading-tight">
                {btn.description}
              </span>
            </button>
          );
        })}
      </div>

      {lastResult && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-surface-0/80 text-xs text-text-secondary animate-fade-in">
          {lastResult}
        </div>
      )}
    </div>
  );
}
