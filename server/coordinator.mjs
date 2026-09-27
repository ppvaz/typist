#!/usr/bin/env node
// Typist two-machine coordinator (docs/dual-machine.md, "Coordinating two
// devices"). Optional: the core app never needs it.
//
// Serves the built app over HTTPS (or HTTP on localhost for testing) and a
// same-origin WebSocket relay at /dual/ws. The relay handles rooms, roles,
// manifest acknowledgement, clock pings, a scheduled common start, stop
// notices and final counters. It never sees keystrokes, never stores typed
// text, keeps rooms only in memory, and never logs room tokens.
//
//   node server/coordinator.mjs --port 8443 --cert cert.pem --key key.pem [--dist dist]
//   node server/coordinator.mjs --port 8080 --http                (localhost testing)
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { extname, join, normalize, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';

export const ROOM_IDLE_MS = 30 * 60 * 1000;
export const START_LEAD_MS = 5000;
export const ACK_DEADLINE_MS = 1500;
const CLOCK_MAX_AGE_MS = 30_000;
const MIN_CLOCK_SAMPLES = 8;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

/** Canonical JSON with sorted keys, matching src/domain/signature.ts. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function manifestHash(manifest) {
  return createHash('sha256').update(canonicalJson(manifest), 'utf8').digest('hex');
}

function newToken() {
  return randomBytes(16).toString('base64url');
}

export function createCoordinator({ now = () => performance.now(), log = () => {} } = {}) {
  /** @type {Map<string, any>} */
  const rooms = new Map();

  function send(ws, message) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  function broadcast(room, message) {
    send(room.sockets.left, message);
    send(room.sockets.right, message);
  }

  function peerState(room) {
    const side = (role) => ({ present: !!room.sockets[role], ready: room.ready[role], armed: room.armed[role], clock: room.clock[role] ? { uncertaintyMs: room.clock[role].uncertaintyMs, samples: room.clock[role].samples } : null });
    return { type: 'peers', left: side('left'), right: side('right'), sides: room.sides, manifestHash: room.manifestHash, status: room.status };
  }

  function touch(room) {
    room.lastActivity = Date.now();
  }

  function clockFresh(room, role) {
    const c = room.clock[role];
    return !!c && c.samples >= MIN_CLOCK_SAMPLES && Date.now() - c.receivedAt <= CLOCK_MAX_AGE_MS;
  }

  function cancelSchedule(room, reason) {
    if (room.ackTimer) clearTimeout(room.ackTimer);
    room.ackTimer = null;
    room.schedule = null;
    room.status = 'lobby';
    broadcast(room, { type: 'cancel', reason });
  }

  function maybeSchedule(room) {
    if (room.status !== 'lobby' || !room.manifest) return;
    if (!room.ready.left || !room.ready.right || !room.armed.left || !room.armed.right) return;
    const problems = [];
    for (const role of ['left', 'right']) if (!clockFresh(room, role)) problems.push(`The ${role} clock estimate is missing or stale.`);
    if (problems.length > 0) {
      broadcast(room, { type: 'cancel', reason: problems.join(' ') });
      room.armed = { left: false, right: false };
      return;
    }
    const startAt = now() + START_LEAD_MS;
    room.schedule = { startAt, durationMs: room.manifest.durationMs, acks: { left: false, right: false } };
    room.status = 'scheduled';
    broadcast(room, { type: 'schedule', startAt, durationMs: room.manifest.durationMs, manifestHash: room.manifestHash });
    room.ackTimer = setTimeout(() => {
      if (room.schedule && !(room.schedule.acks.left && room.schedule.acks.right)) cancelSchedule(room, 'A side did not acknowledge the scheduled start in time.');
    }, START_LEAD_MS - ACK_DEADLINE_MS);
  }

  function leave(room, role, reason) {
    room.sockets[role] = null;
    room.sides[role] = null;
    room.ready[role] = false;
    room.armed[role] = false;
    if (room.status === 'scheduled' || room.status === 'running') {
      room.status = 'incomplete';
      broadcast(room, { type: 'peer-left', role, reason, incomplete: true });
    } else {
      broadcast(room, { type: 'peer-left', role, reason, incomplete: false });
    }
    touch(room);
    if (!room.sockets.left && !room.sockets.right) rooms.delete(room.token);
  }

  function handle(ws, state, message) {
    const room = state.room ? rooms.get(state.room) : null;
    switch (message.type) {
      case 'create': {
        const role = message.role === 'right' ? 'right' : 'left';
        const token = newToken();
        const created = {
          token,
          createdAt: Date.now(),
          lastActivity: Date.now(),
          sockets: { left: null, right: null },
          ready: { left: false, right: false },
          armed: { left: false, right: false },
          clock: { left: null, right: null },
          manifest: null,
          manifestHash: null,
          schedule: null,
          ackTimer: null,
          results: { left: null, right: null },
          sides: { left: null, right: null },
          status: 'lobby',
        };
        created.sockets[role] = ws;
        rooms.set(token, created);
        state.room = token;
        state.role = role;
        send(ws, { type: 'room', room: token, role });
        log('room created');
        return;
      }
      case 'join': {
        const target = rooms.get(String(message.room ?? ''));
        const role = message.role === 'right' ? 'right' : message.role === 'left' ? 'left' : null;
        if (!target) return send(ws, { type: 'error', code: 'no-room', message: 'That room does not exist or has expired.' });
        if (!role) return send(ws, { type: 'error', code: 'bad-role', message: 'Choose the left or the right role.' });
        if (target.sockets[role]) return send(ws, { type: 'error', code: 'role-taken', message: `The ${role} role is already taken in this room.` });
        target.sockets[role] = ws;
        state.room = target.token;
        state.role = role;
        touch(target);
        send(ws, { type: 'room', room: target.token, role });
        if (target.manifest) send(ws, { type: 'manifest', manifest: target.manifest, hash: target.manifestHash });
        broadcast(target, peerState(target));
        return;
      }
      default:
        break;
    }
    if (!room || !state.role) return send(ws, { type: 'error', code: 'no-room', message: 'Create or join a room first.' });
    touch(room);
    const role = state.role;
    const other = role === 'left' ? 'right' : 'left';
    switch (message.type) {
      case 'ping':
        send(ws, { type: 'pong', id: message.id, t: message.t, server: now() });
        return;
      case 'side':
        // This machine's mode, setup revision and baselines (no typed text).
        room.sides[role] = message.spec && typeof message.spec === 'object' ? message.spec : null;
        broadcast(room, peerState(room));
        return;
      case 'clock':
        room.clock[role] = { uncertaintyMs: Number(message.uncertaintyMs), samples: Number(message.samples), receivedAt: Date.now() };
        broadcast(room, peerState(room));
        return;
      case 'manifest': {
        if (room.status !== 'lobby') return send(ws, { type: 'error', code: 'busy', message: 'A run is already scheduled.' });
        const hash = manifestHash(message.manifest);
        room.manifest = message.manifest;
        room.manifestHash = hash;
        room.ready = { left: false, right: false };
        room.armed = { left: false, right: false };
        room.results = { left: null, right: null };
        broadcast(room, { type: 'manifest', manifest: room.manifest, hash });
        return;
      }
      case 'ready':
        if (!room.manifest || message.hash !== room.manifestHash) return send(ws, { type: 'error', code: 'manifest-mismatch', message: 'This machine acknowledged a different manifest.' });
        room.ready[role] = true;
        broadcast(room, peerState(room));
        return;
      case 'arm':
        if (!room.ready[role]) return send(ws, { type: 'error', code: 'not-ready', message: 'Acknowledge the manifest first.' });
        room.armed[role] = true;
        maybeSchedule(room);
        broadcast(room, peerState(room));
        return;
      case 'schedule-ack':
        if (!room.schedule || message.startAt !== room.schedule.startAt) return;
        room.schedule.acks[role] = true;
        if (room.schedule.acks.left && room.schedule.acks.right) {
          if (room.ackTimer) clearTimeout(room.ackTimer);
          room.ackTimer = null;
          room.status = 'running';
          broadcast(room, { type: 'go', startAt: room.schedule.startAt, durationMs: room.schedule.durationMs });
        }
        return;
      case 'status':
        send(room.sockets[other], { type: 'peer-status', role, state: String(message.state ?? '') });
        return;
      case 'stop':
        if (room.ackTimer) clearTimeout(room.ackTimer);
        room.ackTimer = null;
        room.status = 'stopped';
        broadcast(room, { type: 'stopped', by: role, reason: String(message.reason ?? 'stopped') });
        return;
      case 'result': {
        const result = message.result ?? {};
        if (result.manifestHash !== room.manifestHash || result.role !== role) return send(ws, { type: 'error', code: 'result-mismatch', message: 'The result does not match this room’s manifest and role.' });
        room.results[role] = result;
        if (room.results.left && room.results.right) {
          if (room.status === 'running') room.status = 'complete';
          broadcast(room, { type: 'complete', left: room.results.left, right: room.results.right, status: room.status });
        } else send(ws, { type: 'result-received' });
        return;
      }
      case 'reset':
        if (room.ackTimer) clearTimeout(room.ackTimer);
        room.ackTimer = null;
        room.status = 'lobby';
        room.schedule = null;
        // A finished run's manifest is never reused: the next run gets a new run ID.
        room.manifest = null;
        room.manifestHash = null;
        room.ready = { left: false, right: false };
        room.armed = { left: false, right: false };
        room.results = { left: null, right: null };
        broadcast(room, peerState(room));
        return;
      case 'leave':
        leave(room, role, 'left the room');
        state.room = null;
        state.role = null;
        return;
      default:
        send(ws, { type: 'error', code: 'unknown', message: 'Unknown message.' });
    }
  }

  function connection(ws) {
    const state = { room: null, role: null };
    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        send(ws, { type: 'error', code: 'bad-json', message: 'Messages are JSON.' });
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      handle(ws, state, message);
    });
    ws.on('close', () => {
      const room = state.room ? rooms.get(state.room) : null;
      if (room && state.role && room.sockets[state.role] === ws) leave(room, state.role, 'disconnected');
    });
  }

  function sweep() {
    const cutoff = Date.now() - ROOM_IDLE_MS;
    for (const [token, room] of rooms) {
      if (room.lastActivity < cutoff) {
        broadcast(room, { type: 'expired' });
        rooms.delete(token);
      }
    }
  }

  return { rooms, connection, sweep };
}

function serveStatic(dist) {
  const root = resolve(dist);
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Build the app first (npm run build).');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': file.endsWith('index.html') || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(res);
  };
}

export function startServer({ port = 8443, host = '0.0.0.0', cert = null, key = null, http: plain = false, dist = 'dist', log = console.log } = {}) {
  const coordinator = createCoordinator({ log: () => {} });
  const handler = serveStatic(dist);
  const server = plain ? http.createServer(handler) : https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, handler);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://local').pathname !== '/dual/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => coordinator.connection(ws));
  });
  const sweeper = setInterval(() => coordinator.sweep(), 60_000);
  server.on('close', () => clearInterval(sweeper));
  return new Promise((resolveServer) => {
    server.listen(port, host, () => {
      const address = server.address();
      log(`Typist coordinator on ${plain ? 'http' : 'https'}://${host}:${typeof address === 'object' && address ? address.port : port} (rooms are in memory only)`);
      resolveServer({ server, coordinator, wss, port: typeof address === 'object' && address ? address.port : port });
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const arg = (name, fallback = null) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const plain = process.argv.includes('--http');
  if (!plain && (!arg('cert') || !arg('key'))) {
    console.error('Provide --cert and --key for HTTPS (see docs/dual-machine-setup.md), or --http for localhost testing.');
    process.exit(1);
  }
  void startServer({ port: Number(arg('port', plain ? '8080' : '8443')), host: arg('host', plain ? '127.0.0.1' : '0.0.0.0'), cert: arg('cert'), key: arg('key'), http: plain, dist: arg('dist', 'dist') });
}
