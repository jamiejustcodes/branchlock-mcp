import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isDaemonHealthy } from './daemon-client.js';
import { PID_DIR, PID_FILE } from '@branchlock/shared';

function log(msg: string): void {
  // CRITICAL: never write to stdout — only stderr for adapter logging
  process.stderr.write(`[branchlock-adapter] ${msg}\n`);
}

function getPidDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, PID_DIR);
}

function getPidPath(): string {
  return path.join(getPidDir(), PID_FILE);
}

/**
 * Check if a process with the given PID is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = just check existence
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the daemon entry point. Looks for the compiled JS first,
 * then falls back to running via tsx for dev.
 */
function findDaemonEntry(): { command: string; args: string[] } {
  // Check for compiled daemon
  const distEntry = path.resolve(__dirname, '../../daemon/dist/index.js');
  if (fs.existsSync(distEntry)) {
    return { command: process.execPath, args: [distEntry] };
  }

  // Fallback: try to run the TS source via tsx
  const srcEntry = path.resolve(__dirname, '../../daemon/src/index.ts');
  const tsxBin = path.resolve(__dirname, '../../node_modules/.bin/tsx');
  const tsxBinCmd = path.resolve(__dirname, '../../node_modules/.bin/tsx.cmd');

  const tsxPath = process.platform === 'win32'
    ? (fs.existsSync(tsxBinCmd) ? tsxBinCmd : tsxBin)
    : tsxBin;

  if (fs.existsSync(tsxPath) && fs.existsSync(srcEntry)) {
    return { command: tsxPath, args: [srcEntry] };
  }

  // Last resort: assume daemon is built
  return { command: process.execPath, args: [distEntry] };
}

/**
 * Ensure the BranchLock daemon is running.
 * 1. Check health endpoint
 * 2. If not reachable, check PID file for stale process
 * 3. Spawn daemon as detached background process
 * 4. Wait for health check to pass
 */
export async function ensureDaemon(): Promise<void> {
  // Step 1: check if daemon is already healthy
  if (await isDaemonHealthy()) {
    log('daemon already running');
    return;
  }

  log('daemon not reachable, attempting auto-start...');

  // Step 2: check PID file
  const pidPath = getPidPath();
  if (fs.existsSync(pidPath)) {
    const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid) && isProcessAlive(pid)) {
      log(`daemon PID ${pid} exists but health check failed, waiting...`);
      // Daemon might still be starting up
      const ok = await waitForHealth(10_000);
      if (ok) return;
      log(`daemon PID ${pid} is alive but not responding, proceeding with new spawn`);
    } else {
      log(`stale PID file found (pid: ${pidStr}), removing`);
      try { fs.unlinkSync(pidPath); } catch { /* best effort */ }
    }
  }

  // Step 3: spawn daemon as detached background process
  const { command, args } = findDaemonEntry();
  log(`spawning daemon: ${command} ${args.join(' ')}`);

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
    // Use the project root as cwd so the DB lands in the right place
    cwd: path.resolve(__dirname, '../..'),
  });

  child.unref();
  log(`daemon spawned (pid: ${child.pid})`);

  // Step 4: wait for health check to pass
  const ok = await waitForHealth(15_000);
  if (!ok) {
    throw new Error(
      'BranchLock daemon failed to start within 15 seconds. ' +
      'Try starting it manually with: npm run dev (in the branchlock-mcp directory)'
    );
  }

  log('daemon is now healthy');
}

/**
 * Poll the health endpoint until it responds or timeout is reached.
 */
async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const interval = 500;

  while (Date.now() - start < timeoutMs) {
    if (await isDaemonHealthy()) return true;
    await sleep(interval);
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
