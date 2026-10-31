/*
 * Open Barrels live results server (Cloudflare Worker + Durable Object).
 *
 * Each live event is one Durable Object "room". The organizer's device sends
 * the public results (names, horses, times, places — never money) and the
 * room pushes them to every viewer over a WebSocket.
 *
 *   POST   /api/events          { organizerCode }  -> { id, adminKey }
 *   GET    /api/events/:id                         -> latest public results
 *   GET    /api/events/:id/ws                      -> live updates (WebSocket)
 *   PUT    /api/events/:id      (Bearer adminKey)  -> publish new results
 *   DELETE /api/events/:id      (Bearer adminKey)  -> end the live link
 *
 * ORGANIZER_CODES (a secret) is a comma-separated list of codes allowed to
 * create live links. Give each approved organizer their own code so one can
 * be removed without affecting the others.
 */
import { DurableObject } from 'cloudflare:workers';

const MAX_BYTES = 256 * 1024;
const EXPIRE_MS = 60 * 24 * 60 * 60 * 1000; // forget an event 60 days after its last update

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

function randomId(len) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const out = [];
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < 248 && out.length < len) out.push(alphabet[b % 31]); // 248 = 8 * 31, no bias
    }
  }
  return out.join('');
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length === 0) return json({ app: 'open-barrels-live', ok: true });
    if (parts[0] !== 'api' || parts[1] !== 'events') return json({ error: 'Not found' }, 404);

    if (parts.length === 2) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const body = await request.json().catch(() => null);
      const codes = String(env.ORGANIZER_CODES || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const code = String((body && body.organizerCode) || '').trim();
      if (!code || !codes.includes(code)) return json({ error: 'That organizer code is not valid.' }, 403);
      const id = randomId(10);
      const adminKey = randomHex(24);
      const stub = env.LIVE.get(env.LIVE.idFromName(id));
      await stub.init(await sha256(adminKey));
      return json({ id, adminKey }, 201);
    }

    const id = parts[2];
    if (!/^[a-z0-9]{6,24}$/.test(id) || parts.length > 4 || (parts.length === 4 && parts[3] !== 'ws')) {
      return json({ error: 'Not found' }, 404);
    }
    const stub = env.LIVE.get(env.LIVE.idFromName(id));
    return stub.fetch(request);
  },
};

export class LiveEvent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Viewers send "ping" to keep the connection open; answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async init(adminHash) {
    if (await this.ctx.storage.get('adminHash')) throw new Error('already exists');
    await this.ctx.storage.put({ adminHash, created: Date.now() });
    await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
  }

  broadcast(text) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch (e) {
        /* viewer already gone */
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const adminHash = await this.ctx.storage.get('adminHash');
    if (!adminHash) return json({ error: 'This live link has ended or does not exist.' }, 404);

    if (url.pathname.endsWith('/ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket' }, 426);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      const snap = await this.ctx.storage.get('snapshot');
      server.send(snap || JSON.stringify({ type: 'empty' }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === 'GET') {
      const snap = await this.ctx.storage.get('snapshot');
      return new Response(snap || JSON.stringify({ type: 'empty' }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
      });
    }

    const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!key || (await sha256(key)) !== adminHash) return json({ error: 'Not allowed' }, 403);

    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'Too large' }, 413);
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return json({ error: 'Bad JSON' }, 400);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Bad data' }, 400);
      data.updatedAt = Date.now();
      const out = JSON.stringify({ type: 'snapshot', data });
      await this.ctx.storage.put('snapshot', out);
      await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
      this.broadcast(out);
      return json({ ok: true, viewers: this.ctx.getWebSockets().length });
    }

    if (request.method === 'DELETE') {
      await this.end();
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  }

  async end() {
    this.broadcast(JSON.stringify({ type: 'ended' }));
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, 'ended');
      } catch (e) {
        /* ignore */
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    await this.end();
  }

  async webSocketMessage() {
    /* viewers only listen */
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch (e) {
      /* ignore */
    }
  }
}
