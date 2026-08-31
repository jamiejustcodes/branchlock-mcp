#!/usr/bin/env node

// Interactive Real-Time CLI for BranchLock MCP
// Usage: node cli.mjs <YourName>

import readline from 'node:readline';
import http from 'node:http';

const agentId = process.argv[2] || `Dev-${Math.floor(1000 + Math.random() * 9000)}`;

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
    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `\x1b[36m[${agentId}]\x1b[0m ➜ `,
});

console.clear();
console.log('\x1b[35m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m');
console.log(`\x1b[35m║\x1b[0m  🔒 \x1b[1mBranchLock Interactive Agent CLI\x1b[0m                                    \x1b[35m║\x1b[0m`);
console.log(`\x1b[35m║\x1b[0m  Logged in as: \x1b[32m\x1b[1m${agentId.padEnd(52)}\x1b[0m \x1b[35m║\x1b[0m`);
console.log(`\x1b[35m║\x1b[0m  Dashboard: \x1b[34mhttp://localhost:5173\x1b[0m                                         \x1b[35m║\x1b[0m`);
console.log('\x1b[35m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m');
console.log('\n\x1b[1mAvailable Commands:\x1b[0m');
console.log('  \x1b[33mclaim <path1> <path2> ... [summary]\x1b[0m  Claim exclusive lock on files');
console.log('  \x1b[33mrelease <path1> <path2> ...        \x1b[0m  Release locks owned by you');
console.log('  \x1b[33mcheck [paths]                      \x1b[0m  Inspect all currently active locks');
console.log('  \x1b[33mbroadcast <message>                \x1b[0m  Broadcast context to all agents & dashboard');
console.log('  \x1b[33mhelp                               \x1b[0m  Show this help menu');
console.log('  \x1b[33mexit                               \x1b[0m  Quit CLI\n');

rl.prompt();

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }

  const parts = trimmed.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  try {
    switch (cmd) {
      case 'claim': {
        if (args.length === 0) {
          console.log('\x1b[31mUsage: claim <filepath> [taskSummary]\x1b[0m');
          break;
        }
        const filePath = args[0];
        const summary = args.slice(1).join(' ') || `Editing ${filePath}`;

        console.log(`⏳ Attempting to claim lock on "${filePath}"...`);
        const res = await request('POST', '/api/locks/claim', {
          paths: [filePath],
          agentId,
          taskSummary: summary,
          ttlMinutes: 15,
        });

        if (res.success) {
          console.log(`\x1b[32m✅ SUCCESS: You locked "${filePath}" for 15 minutes.\x1b[0m`);
          console.log(`   Task: "${summary}"`);
          console.log(`   (Watch your card appear at http://localhost:5173)`);
        } else {
          console.log(`\x1b[31m❌ COLLISION BLOCKED:\x1b[0m File is already locked by another agent!`);
          for (const c of res.conflicts || []) {
            console.log(`   🔒 \x1b[1m${c.file_path}\x1b[0m is held by \x1b[33m${c.held_by}\x1b[0m`);
            console.log(`      Task: "${c.task_summary}"`);
            console.log(`      Expires at: ${c.expires_at}`);
          }
        }
        break;
      }

      case 'release': {
        if (args.length === 0) {
          console.log('\x1b[31mUsage: release <filepath>\x1b[0m');
          break;
        }
        const filePath = args[0];
        const res = await request('POST', '/api/locks/release', {
          paths: [filePath],
          agentId,
          completed: true,
        });

        if (res.released?.length > 0) {
          console.log(`\x1b[32m🔓 RELEASED: "${filePath}" is now available for other agents.\x1b[0m`);
        } else {
          console.log(`\x1b[33m⚠️ You don't own an active lock on "${filePath}".\x1b[0m`);
        }
        break;
      }

      case 'check': {
        const res = await request('GET', '/api/locks');
        const locks = res.locks || [];
        if (locks.length === 0) {
          console.log('\x1b[32m✨ No active locks in the workspace. All files are free to edit.\x1b[0m');
        } else {
          console.log(`\x1b[1mActive Workspace Locks (${locks.length}):\x1b[0m`);
          for (const l of locks) {
            const isMe = l.agent_id === agentId ? ' \x1b[32m(YOU)\x1b[0m' : '';
            console.log(`  🔒 \x1b[36m${l.file_path}\x1b[0m by \x1b[33m${l.agent_id}\x1b[0m${isMe}`);
            console.log(`     Task: "${l.task_summary}"`);
            console.log(`     Expires: ${l.expires_at}`);
          }
        }
        break;
      }

      case 'broadcast': {
        if (args.length === 0) {
          console.log('\x1b[31mUsage: broadcast <message>\x1b[0m');
          break;
        }
        const message = args.join(' ');
        await request('POST', '/api/broadcast', {
          agentId,
          decisionNotes: message,
        });
        console.log(`\x1b[35m📢 BROADCAST SENT:\x1b[0m "${message}" (Check http://localhost:5173)`);
        break;
      }

      case 'help': {
        console.log('\nCommands:');
        console.log('  claim <file> [summary]  - Claim exclusive lock');
        console.log('  release <file>          - Release your lock');
        console.log('  check                   - List all active locks');
        console.log('  broadcast <message>     - Send broadcast note');
        console.log('  exit                    - Quit\n');
        break;
      }

      case 'exit':
      case 'quit': {
        console.log('Goodbye!');
        process.exit(0);
      }

      default:
        console.log(`\x1b[31mUnknown command: "${cmd}". Type "help" for options.\x1b[0m`);
    }
  } catch (err) {
    console.error('\x1b[31mError connecting to daemon:\x1b[0m', err.message);
  }

  console.log('');
  rl.prompt();
});

rl.on('close', () => {
  console.log('\nExiting BranchLock CLI.');
  process.exit(0);
});
