// Live Multi-Agent Collision Arena
// Run this with `http://localhost:5173` open in your browser to watch the real-time simulation.

import http from 'node:http';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 4000,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(emoji, agent, msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${emoji} \x1b[1m${agent.padEnd(16)}\x1b[0m ${msg}`);
}

async function runLiveScenario() {
  console.clear();
  console.log('\x1b[36m========================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[35m  🎭  BRANCHLOCK MCP — LIVE MULTI-AGENT WORKSPACE ARENA\x1b[0m');
  console.log('\x1b[36m========================================================================\x1b[0m');
  console.log('\x1b[33m👉 Make sure http://localhost:5173 is open in your browser right now!\x1b[0m\n');

  console.log('Starting real-time simulation in 3 seconds...\n');
  await sleep(3000);

  // ─── Phase 1: Claude claims core auth files ─────────────────────
  log('🔵', 'Claude-Code-01', 'Starting task: "Migrating auth to RS256 JWT tokens"');
  log('🔒', 'Claude-Code-01', 'Claiming locks on [src/auth/jwt.ts, src/middleware/session.ts]...');
  const claim1 = await request('POST', '/api/locks/claim', {
    paths: ['src/auth/jwt.ts', 'src/middleware/session.ts'],
    agentId: 'Claude-Code-01',
    taskSummary: 'Migrating auth to RS256 JWT tokens',
    ttlMinutes: 15,
  });
  log('✅', 'Claude-Code-01', `Successfully claimed 2 files! (Check your dashboard grid)`);
  console.log('');
  await sleep(4000);

  // ─── Phase 2: Claude broadcasts an architectural decision ───────
  log('📢', 'Claude-Code-01', 'Broadcasting design decision to all agents...');
  await request('POST', '/api/broadcast', {
    agentId: 'Claude-Code-01',
    decisionNotes: 'Switching auth headers from session cookies to standard Bearer tokens. Please do not edit auth or session middleware.',
  });
  log('📡', 'Claude-Code-01', 'Broadcast sent! (Check your live feed for the violet banner)');
  console.log('');
  await sleep(5000);

  // ─── Phase 3: Cursor attempts to touch auth.ts (Collision!) ─────
  log('🔴', 'Cursor-Dev', 'Starting task: "Adding Google OAuth2 social login"');
  log('⚡', 'Cursor-Dev', 'Attempting to claim [src/auth/jwt.ts, src/views/Login.tsx]...');
  const claim2 = await request('POST', '/api/locks/claim', {
    paths: ['src/auth/jwt.ts', 'src/views/Login.tsx'],
    agentId: 'Cursor-Dev',
    taskSummary: 'Adding Google OAuth2 social login',
    ttlMinutes: 15,
  });
  
  if (!claim2.success) {
    log('💥', 'BranchLock Engine', '\x1b[31mCOLLISION BLOCKED! Cursor-Dev attempted to touch locked file: src/auth/jwt.ts (held by Claude-Code-01)\x1b[0m');
    log('🛡️', 'Cursor-Dev', 'Claim was safely rejected by BranchLock. No merge conflict generated.');
  }
  console.log('');
  await sleep(5000);

  // ─── Phase 4: Cursor pivots to front-end files ──────────────────
  log('🔄', 'Cursor-Dev', 'Pivoting: Claiming front-end view files only [src/views/Login.tsx, src/views/Register.tsx]...');
  await request('POST', '/api/locks/claim', {
    paths: ['src/views/Login.tsx', 'src/views/Register.tsx'],
    agentId: 'Cursor-Dev',
    taskSummary: 'Building Google OAuth2 button in login UI',
    ttlMinutes: 15,
  });
  log('✅', 'Cursor-Dev', 'Claim succeeded for UI files. Both agents now working in parallel safely!');
  console.log('');
  await sleep(5000);

  // ─── Phase 5: Codex joins workspace ────────────────────────────
  log('🟢', 'Codex-Agent-03', 'Starting task: "Adding Prometheus telemetry metrics"');
  log('🔒', 'Codex-Agent-03', 'Claiming [src/metrics/telemetry.ts, src/routes/health.ts]...');
  await request('POST', '/api/locks/claim', {
    paths: ['src/metrics/telemetry.ts', 'src/routes/health.ts'],
    agentId: 'Codex-Agent-03',
    taskSummary: 'Adding Prometheus telemetry metrics',
    ttlMinutes: 15,
  });
  log('✅', 'Codex-Agent-03', 'Claim succeeded! (You should now see 3 distinct agent cards on your dashboard)');
  console.log('');
  await sleep(6000);

  // ─── Phase 6: Heartbeat simulation ─────────────────────────────
  log('💓', 'Claude-Code-01', 'Task taking extra time. Sending heartbeat to refresh 15-minute TTL...');
  await request('POST', '/api/locks/heartbeat', {
    paths: ['src/auth/jwt.ts', 'src/middleware/session.ts'],
    agentId: 'Claude-Code-01',
  });
  log('✨', 'BranchLock Engine', 'TTL refreshed for Claude-Code-01.');
  console.log('');
  await sleep(4000);

  // ─── Phase 7: Claude completes task & releases locks ───────────
  log('🎉', 'Claude-Code-01', 'Task complete! Releasing locks on [src/auth/jwt.ts, src/middleware/session.ts]...');
  await request('POST', '/api/locks/release', {
    paths: ['src/auth/jwt.ts', 'src/middleware/session.ts'],
    agentId: 'Claude-Code-01',
    completed: true,
  });
  log('🔓', 'Claude-Code-01', 'Locks released cleanly. Claude card removed from active grid.');
  console.log('');
  await sleep(4000);

  // ─── Phase 8: Cursor can now safely claim jwt.ts ───────────────
  log('🚀', 'Cursor-Dev', 'Retrying claim on [src/auth/jwt.ts] for OAuth2 backend hookup...');
  const claimRetry = await request('POST', '/api/locks/claim', {
    paths: ['src/auth/jwt.ts'],
    agentId: 'Cursor-Dev',
    taskSummary: 'Connecting OAuth2 backend callback',
    ttlMinutes: 15,
  });
  if (claimRetry.success) {
    log('✅', 'Cursor-Dev', 'Claim succeeded! File was unlocked and safely transferred to Cursor-Dev.');
  }
  console.log('');
  await sleep(5000);

  // ─── Phase 9: Clean wrap up ────────────────────────────────────
  log('🏁', 'All Agents', 'All tasks finished. Releasing remaining workspace locks...');
  await request('POST', '/api/locks/release', {
    paths: ['src/views/Login.tsx', 'src/views/Register.tsx', 'src/auth/jwt.ts'],
    agentId: 'Cursor-Dev',
    completed: true,
  });
  await request('POST', '/api/locks/release', {
    paths: ['src/metrics/telemetry.ts', 'src/routes/health.ts'],
    agentId: 'Codex-Agent-03',
    completed: true,
  });
  log('🛡️', 'BranchLock Engine', 'Workspace is now 100% free and clear. Zero merge conflicts!');
  console.log('\n\x1b[32m✨ Simulation complete! Check your dashboard at http://localhost:5173 to review the full live event log.\x1b[0m\n');
}

runLiveScenario().catch((err) => {
  console.error('Scenario error:', err);
});
