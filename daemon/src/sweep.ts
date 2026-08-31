import { sweepExpiredLocks } from './db.js';
import { broadcast } from './ws.js';
import { SWEEP_INTERVAL_MS } from '@branchlock/shared';

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background TTL sweep interval.
 * Runs every SWEEP_INTERVAL_MS (30s), sweeping expired locks and
 * broadcasting ttl_expired events to the dashboard.
 */
export function startSweep(): void {
  if (sweepTimer) return;

  sweepTimer = setInterval(() => {
    try {
      const count = sweepExpiredLocks();
      if (count > 0) {
        console.log(`${new Date().toISOString()} [sweep] released ${count} expired lock(s)`);
        broadcast('ttl_expired', { count });
      }
    } catch (err) {
      console.error(`${new Date().toISOString()} [sweep] error:`, err);
    }
  }, SWEEP_INTERVAL_MS);

  console.log(`${new Date().toISOString()} [sweep] started (interval: ${SWEEP_INTERVAL_MS}ms)`);
}

/**
 * Stop the background sweep.
 */
export function stopSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
