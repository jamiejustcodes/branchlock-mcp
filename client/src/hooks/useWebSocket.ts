import { useEffect, useRef, useState, useCallback } from 'react';

export interface WSEvent {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface UseWebSocketReturn {
  events: WSEvent[];
  connected: boolean;
  clearEvents: () => void;
}

/**
 * Custom hook for WebSocket connection to the BranchLock daemon.
 * Auto-reconnects on disconnection with exponential backoff.
 */
export function useWebSocket(maxEvents: number = 200): UseWebSocketReturn {
  const [events, setEvents] = useState<WSEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Use the Vite proxy path in dev, or direct WS in prod
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = 1000; // reset backoff
    };

    ws.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        setEvents((prev) => {
          // Deduplicate events by id or (type + timestamp + agentId)
          const isDuplicate = prev.some((existing) => {
            if (event.id && existing.id) return existing.id === event.id;
            return (
              existing.type === event.type &&
              existing.timestamp === event.timestamp &&
              JSON.stringify(existing.data) === JSON.stringify(event.data)
            );
          });

          if (isDuplicate) return prev;
          const next = [event, ...prev];
          return next.slice(0, maxEvents); // cap event buffer
        });
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      // Reconnect with exponential backoff (max 30s)
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [maxEvents]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
