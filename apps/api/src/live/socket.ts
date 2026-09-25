// The WebSocket at /v1/live (docs/pvp-plan.md): each signed-in game keeps one open while it runs. This file only turns
// sockets into the hub's connect/receive/closed; everything online play does is in hub.ts and match.ts.
//
// The token comes in the first message ("hello"), never in the address, so it isn't written to any log. A socket that
// stops answering pings is closed, and the hub treats its player as gone.
//
// App Service needs Web Sockets switched on (Configuration → General settings) and one instance: the games live in
// this process's memory (their records are in the matches table, so a restart loses nothing).

import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { LIVE_PATH } from '@fruitcats/match';
import type { createHub } from './hub';

const PING_MS = 25_000;

export function attachLive(server: Server, hub: ReturnType<typeof createHub>, originAllowed: (origin: string | undefined) => boolean) {
  const wss = new WebSocketServer({
    server, path: LIVE_PATH, maxPayload: 64 * 1024,
    verifyClient: (info: { origin: string; req: IncomingMessage }) => originAllowed(info.origin || undefined),
  });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    const conn = hub.connect(
      (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
      () => ws.close(),
    );
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data, binary) => { if (!binary) conn.receive(data.toString()); });
    ws.on('close', () => conn.closed());
    ws.on('error', () => ws.terminate());
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, PING_MS);
  wss.on('close', () => clearInterval(ping));
  return wss;
}
