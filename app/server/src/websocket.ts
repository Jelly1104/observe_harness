import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { WSClientMessage } from './types'

// Track which session each client is subscribed to
const clientSessions = new Map<WebSocket, string>()
const allClients = new Set<WebSocket>()

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/api/events/stream' })

  wss.on('connection', (ws) => {
    allClients.add(ws)
    console.log('[WS] Client connected')

    ws.on('message', (raw) => {
      try {
        const msg: WSClientMessage = JSON.parse(raw.toString())
        if (msg.type === 'subscribe' && msg.sessionId) {
          clientSessions.set(ws, msg.sessionId)
        } else if (msg.type === 'unsubscribe') {
          clientSessions.delete(ws)
        }
      } catch {}
    })

    ws.on('close', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
      console.log('[WS] Client disconnected')
    })

    ws.on('error', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
    })
  })

  console.log('[WS] WebSocket enabled on /api/events/stream')
}

/** Send a message only to clients subscribed to a specific session */
export function broadcastToSession(sessionId: string, message: object): void {
  const json = JSON.stringify(message)
  for (const [client, subSessionId] of clientSessions) {
    if (subSessionId === sessionId && client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

/** Send a message to ALL connected clients (for global updates) */
export function broadcastToAll(message: object): void {
  const json = JSON.stringify(message)
  for (const client of allClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

export function getClientCount(): number {
  return allClients.size
}
