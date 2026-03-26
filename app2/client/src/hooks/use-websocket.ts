import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WS_URL } from '@/config/api';
import type { WSMessage, ParsedEvent } from '@/types';

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log('[WS] Connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);

          if (msg.type === 'event') {
            const evt = msg.data as ParsedEvent;
            queryClient.setQueriesData<ParsedEvent[]>(
              { queryKey: ['events'] },
              (old) => (old ? [...old, evt] : [evt])
            );
            queryClient.invalidateQueries({ queryKey: ['agents', evt.sessionId] });
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
          }

          if (msg.type === 'agent_update') {
            queryClient.invalidateQueries({ queryKey: ['agents', msg.data.sessionId] });
          }

          if (msg.type === 'session_update') {
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            queryClient.invalidateQueries({ queryKey: ['projects'] });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[WS] Disconnected, reconnecting in 3s...');
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [queryClient]);

  return { connected };
}
