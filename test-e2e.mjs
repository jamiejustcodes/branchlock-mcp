// Automated end-to-end verification script for BranchLock MCP
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
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

async function run() {
  console.log('🧪 Starting BranchLock MCP End-to-End Verification...\n');

  // 1. Spawn daemon
  console.log('1️⃣  Starting daemon server...');
  const daemon = spawn('node', ['daemon/dist/index.js'], {
    cwd: __dirname,
    stdio: 'inherit',
  });

  // Wait for health
  let healthy = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const res = await request('GET', '/api/health');
      if (res.body?.status === 'ok') {
        healthy = true;
        break;
      }
    } catch {}
  }

  if (!healthy) {
    console.error('❌ Daemon failed to start');
    daemon.kill();
    process.exit(1);
  }
  console.log('✅ Daemon is online and healthy.\n');

  try {
    // 2. Test Atomic Claim
    console.log('2️⃣  Testing Atomic File Claim (Agent: Claude-Code-01)...');
    const claim1 = await request('POST', '/api/locks/claim', {
      paths: ['src/services/auth.ts', 'src/services/session.ts'],
      agentId: 'Claude-Code-01',
      taskSummary: 'Refactoring session token verification',
      ttlMinutes: 10,
    });
    console.log('Claim 1 response:', claim1.body);
    if (!claim1.body.success || claim1.body.claimed?.length !== 2) {
      throw new Error('Claim 1 failed');
    }
    console.log('✅ Claim 1 succeeded.\n');

    // 3. Test Conflict Detection
    console.log('3️⃣  Testing Conflict Collision Detection (Agent: Cursor-Dev)...');
    const claim2 = await request('POST', '/api/locks/claim', {
      paths: ['src/services/auth.ts', 'src/components/Login.tsx'],
      agentId: 'Cursor-Dev',
      taskSummary: 'Updating login form validation',
    });
    console.log('Claim 2 conflict response:', claim2.body);
    if (claim2.body.success || !claim2.body.conflicts?.length) {
      throw new Error('Expected conflict was not triggered!');
    }
    console.log('✅ Conflict correctly blocked second agent.\n');

    // 4. Test Check Locks
    console.log('4️⃣  Testing Check Active Locks...');
    const check = await request('GET', '/api/locks');
    console.log(`Active locks count: ${check.body.locks?.length}`);
    if (check.body.locks?.length !== 2) {
      throw new Error('Lock count mismatch');
    }
    console.log('✅ Active locks verified.\n');

    // 5. Test Heartbeat Extension
    console.log('5️⃣  Testing Heartbeat TTL Extension...');
    const hb = await request('POST', '/api/locks/heartbeat', {
      paths: ['src/services/auth.ts'],
      agentId: 'Claude-Code-01',
    });
    console.log('Heartbeat response:', hb.body);
    if (!hb.body.success || !hb.body.extended?.length) {
      throw new Error('Heartbeat failed');
    }
    console.log('✅ Heartbeat extended lock successfully.\n');

    // 6. Test Broadcast
    console.log('6️⃣  Testing Context Broadcast...');
    const bc = await request('POST', '/api/broadcast', {
      decisionNotes: 'Migrated auth to RS256 JWT tokens with public key rotation.',
      agentId: 'Claude-Code-01',
    });
    console.log('Broadcast response:', bc.body);
    if (!bc.body.success) throw new Error('Broadcast failed');
    console.log('✅ Broadcast registered and sent to dashboard.\n');

    // 7. Test Release with Completion Sync
    console.log('7️⃣  Testing File Release & Task Completion...');
    const rel = await request('POST', '/api/locks/release', {
      paths: ['src/services/auth.ts', 'src/services/session.ts'],
      agentId: 'Claude-Code-01',
      completed: true,
    });
    console.log('Release response:', rel.body);
    if (!rel.body.success || rel.body.released?.length !== 2) {
      throw new Error('Release failed');
    }
    console.log('✅ Locks released cleanly.\n');

    // 8. Verify locks are now empty
    const checkAfter = await request('GET', '/api/locks');
    if (checkAfter.body.locks?.length !== 0) {
      throw new Error('Expected zero active locks after release');
    }
    console.log('✅ All locks cleared.\n');

    // 9. Test Cursor-Dev can now claim auth.ts
    console.log('8️⃣  Testing Second Agent Can Now Claim Previously Locked File...');
    const claim3 = await request('POST', '/api/locks/claim', {
      paths: ['src/services/auth.ts'],
      agentId: 'Cursor-Dev',
      taskSummary: 'Updating login form validation',
    });
    if (!claim3.body.success) throw new Error('Second claim should have succeeded after release');
    console.log('✅ Cursor-Dev claimed file without conflict.\n');

    // Release remaining
    await request('POST', '/api/locks/release', {
      paths: ['src/services/auth.ts'],
      agentId: 'Cursor-Dev',
    });

    console.log('🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY!');
  } finally {
    daemon.kill('SIGINT');
  }
}

run().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
