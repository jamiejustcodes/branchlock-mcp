import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, closeDatabase } from './db.js';
import { initWebSocket, closeWebSocket } from './ws.js';
import { startSweep, stopSweep } from './sweep.js';
import routes from './routes.js';
import webhooks from './webhooks.js';
import { DAEMON_PORT, PID_DIR, PID_FILE, DB_FILE } from '@branchlock/shared';

// ─── PID File Management ─────────────────────────────────────

function getPidDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, PID_DIR);
}

function getPidPath(): string {
  return path.join(getPidDir(), PID_FILE);
}

function writePidFile(): void {
  const dir = getPidDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getPidPath(), process.pid.toString(), 'utf-8');
  console.log(`${ts()} [pid] wrote PID ${process.pid} to ${getPidPath()}`);
}

function removePidFile(): void {
  const pidPath = getPidPath();
  try {
    if (fs.existsSync(pidPath)) {
      fs.unlinkSync(pidPath);
      console.log(`${ts()} [pid] removed PID file`);
    }
  } catch {
    // Best effort — may already be gone
  }
}

function ts(): string {
  return new Date().toISOString();
}

// ─── Main ─────────────────────────────────────────────────────

function main(): void {
  console.log(`${ts()} [daemon] BranchLock daemon starting...`);

  // Initialize SQLite database
  const dbPath = process.env.BRANCHLOCK_DB || DB_FILE;
  initDatabase(dbPath);
  console.log(`${ts()} [daemon] database initialized (${dbPath})`);

  // Create Express app
  const app = express();
  app.use(cors({
    origin: true,
    credentials: true,
  }));
  app.use(webhooks);
  app.use(routes);

  // Create HTTP server and attach WebSocket
  const server = createServer(app);
  initWebSocket(server);

  // Start TTL sweep
  startSweep();

  // Write PID file
  writePidFile();

  // Start listening
  server.listen(DAEMON_PORT, () => {
    console.log(`${ts()} [daemon] HTTP API listening on http://localhost:${DAEMON_PORT}`);
    console.log(`${ts()} [daemon] WebSocket available at ws://localhost:${DAEMON_PORT}/api/events`);
    console.log(`${ts()} [daemon] dashboard API: http://localhost:${DAEMON_PORT}/api/health`);
  });

  // ─── Graceful Shutdown ────────────────────────────────────
  function shutdown(signal: string): void {
    console.log(`\n${ts()} [daemon] received ${signal}, shutting down...`);
    stopSweep();
    closeWebSocket();
    server.close(() => {
      closeDatabase();
      removePidFile();
      console.log(`${ts()} [daemon] shutdown complete`);
      process.exit(0);
    });

    // Force exit after 5 seconds if graceful shutdown stalls
    setTimeout(() => {
      console.error(`${ts()} [daemon] forced exit after timeout`);
      removePidFile();
      process.exit(1);
    }, 5000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    console.error(`${ts()} [daemon] uncaught exception:`, err);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`${ts()} [daemon] unhandled rejection:`, reason);
  });
}

main();
