import http from 'node:http';
import { DAEMON_URL } from '@branchlock/shared';

/**
 * Generic HTTP client for communicating with the BranchLock daemon.
 * All adapter tool calls are proxied through this client.
 */

function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, DAEMON_URL);

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          const data = JSON.parse(raw);
          resolve({ status: res.statusCode ?? 200, data });
        } catch {
          resolve({ status: res.statusCode ?? 200, data: raw });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

export async function get(path: string): Promise<unknown> {
  const { data } = await request('GET', path);
  return data;
}

export async function post(path: string, body: unknown): Promise<unknown> {
  const { data } = await request('POST', path, body);
  return data;
}

/**
 * Check if the daemon is reachable.
 */
export async function isDaemonHealthy(): Promise<boolean> {
  try {
    const result = (await get('/api/health')) as { status: string };
    return result.status === 'ok';
  } catch {
    return false;
  }
}
