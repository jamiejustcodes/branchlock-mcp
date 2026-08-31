// Direct stdio MCP adapter test simulating Claude / Cursor JSON-RPC client
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  console.log('🤖 Testing MCP Stdio Adapter over JSON-RPC protocol...\n');

  const adapter = spawn('node', ['adapter/dist/index.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'inherit'], // adapter logs go to stderr (inherited), JSON-RPC over stdin/stdout
  });

  let buffer = '';

  adapter.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        console.log('📥 Received JSON-RPC response:\n', JSON.stringify(msg, null, 2));

        if (msg.id === 1) {
          // Initialize received -> send tools/list
          console.log('📤 Sending tools/list request...');
          send(adapter, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          });
        } else if (msg.id === 2) {
          // Tools listed -> test check_file_locks tool call
          console.log('📤 Sending tools/call check_file_locks request...');
          send(adapter, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: 'check_file_locks',
              arguments: {},
            },
          });
        } else if (msg.id === 3) {
          console.log('✅ Stdio MCP tool call succeeded!');
          adapter.kill();
          process.exit(0);
        }
      } catch (err) {
        console.error('Failed to parse stdout line:', line, err);
      }
    }
  });

  // Send initialize request
  console.log('📤 Sending initialize request...');
  send(adapter, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-agent', version: '1.0.0' },
    },
  });

  setTimeout(() => {
    console.error('❌ Timeout waiting for adapter response');
    adapter.kill();
    process.exit(1);
  }, 10000);
}

function send(proc, obj) {
  proc.stdin.write(JSON.stringify(obj) + '\n');
}

run();
