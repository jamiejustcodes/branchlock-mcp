import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { v4 as uuid } from 'uuid';
import type { WSEvent, EventType } from '@branchlock/shared';

let wss: WebSocketServer;

/**
 * Initialize WebSocket server on the given HTTP server instance.
 * Listens on the /api/events path.
 */
export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/api/events' });

  wss.on('connection', (ws) => {
    log(`[ws] client connected (total: ${wss.clients.size})`);

    ws.on('close', () => {
      log(`[ws] client disconnected (total: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      log(`[ws] client error: ${err.message}`);
    });
  });

  log('[ws] WebSocket server ready on /api/events');
  return wss;
}

/**
 * Broadcast an event to all connected WebSocket clients.
 */
export function broadcast(type: EventType, data: Record<string, unknown>): void {
  if (!wss) return;

  const event: WSEvent = {
    id: uuid(),
    type,
    data,
    timestamp: new Date().toISOString(),
  };

  const payload = JSON.stringify(event);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Close the WebSocket server.
 */
export function closeWebSocket(): void {
  if (wss) {
    for (const client of wss.clients) {
      client.close();
    }
    wss.close();
  }
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}
