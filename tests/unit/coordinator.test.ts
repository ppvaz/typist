import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson as serverCanonical, manifestHash as serverHash, startServer } from '../../server/coordinator.mjs';
import { canonicalJson } from '../../src/domain/signature';
import { type DualManifest, manifestHash } from '../../src/domain/dual';

type Msg = Record<string, unknown> & { type: string };

class Client {
  readonly messages: Msg[] = [];
  private waiters: { type: string; resolve: (m: Msg) => void }[] = [];
  ws!: WebSocket;
  static async open(url: string): Promise<Client> {
    const c = new Client();
    c.ws = new WebSocket(url);
    c.ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as Msg;
      const i = c.waiters.findIndex((w) => w.type === m.type);
      if (i >= 0) c.waiters.splice(i, 1)[0]?.resolve(m);
      else c.messages.push(m);
    });
    await new Promise((r) => c.ws.addEventListener('open', r));
    return c;
  }
  send(m: Msg) {
    this.ws.send(JSON.stringify(m));
  }
  next(type: string, timeout = 3000): Promise<Msg> {
    const i = this.messages.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(this.messages.splice(i, 1)[0] as Msg);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no ${type}`)), timeout);
      this.waiters.push({ type, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }
  close() {
    this.ws.close();
  }
}

const manifest: DualManifest = {
  runId: 'run-1',
  protocolId: 'dual-copy-60-v1',
  scorerVersion: 'typist-scorer-v1',
  level: 'D1',
  durationMs: 60_000,
  seed: 3,
  createdAt: '2026-09-30T10:00:00Z',
  left: { role: 'left', mode: 'QL', layoutRevision: 'qwerty-us@1', setupRevisionId: 'a', taskId: 't', taskSha256: 'x', taskClass: 'drill', composition: false, baselineTrialIds: [] },
  right: { role: 'right', mode: 'DR', layoutRevision: 'dvorak-right-us@1', setupRevisionId: 'b', taskId: 't', taskSha256: 'x', taskClass: 'drill', composition: false, baselineTrialIds: [] },
};

let url = '';
let close: () => void = () => undefined;

beforeAll(async () => {
  const started = await startServer({ port: 0, host: '127.0.0.1', http: true, dist: 'dist', log: () => undefined });
  url = `ws://127.0.0.1:${started.port}/dual/ws`;
  close = () => started.server.close();
});
afterAll(() => close());

async function pair() {
  const left = await Client.open(url);
  left.send({ type: 'create', role: 'left' });
  const room = (await left.next('room')).room as string;
  const right = await Client.open(url);
  right.send({ type: 'join', room, role: 'right' });
  await right.next('room');
  return { left, right, room };
}

async function clocks(...clients: Client[]) {
  for (const c of clients) c.send({ type: 'clock', uncertaintyMs: 5, samples: 8 });
}

describe('coordinator', () => {
  it('hashes manifests exactly like the app', () => {
    expect(serverCanonical(manifest)).toBe(canonicalJson(manifest));
    expect(serverHash(manifest)).toBe(manifestHash(manifest));
  });

  it('gives each room an unguessable token and rejects a duplicate role', async () => {
    const { left, right, room } = await pair();
    expect(room).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const third = await Client.open(url);
    third.send({ type: 'join', room, role: 'right' });
    expect(await third.next('error')).toMatchObject({ code: 'role-taken' });
    third.send({ type: 'join', room: 'nope', role: 'left' });
    expect(await third.next('error')).toMatchObject({ code: 'no-room' });
    left.close();
    right.close();
    third.close();
  });

  it('A23: needs both sides to acknowledge the same manifest hash, then schedules a common start at least 5 s ahead', async () => {
    const { left, right } = await pair();
    const t0 = performance.now();
    left.send({ type: 'manifest', manifest });
    const { hash } = await right.next('manifest');
    expect(hash).toBe(manifestHash(manifest));
    right.send({ type: 'ready', hash: 'wrong' });
    expect(await right.next('error')).toMatchObject({ code: 'manifest-mismatch' });
    left.send({ type: 'ready', hash });
    right.send({ type: 'ready', hash });
    await clocks(left, right);
    left.send({ type: 'arm' });
    right.send({ type: 'arm' });
    const schedule = await left.next('schedule');
    await right.next('schedule');
    expect((schedule.startAt as number) - t0).toBeGreaterThanOrEqual(4900);
    left.send({ type: 'schedule-ack', startAt: schedule.startAt });
    right.send({ type: 'schedule-ack', startAt: schedule.startAt });
    expect(await left.next('go')).toMatchObject({ startAt: schedule.startAt, durationMs: 60_000 });
    // Results pair only when both match the manifest and roles.
    right.send({ type: 'result', result: { role: 'left', manifestHash: hash } });
    expect(await right.next('error')).toMatchObject({ code: 'result-mismatch' });
    left.send({ type: 'result', result: { role: 'left', manifestHash: hash, wpm: 18 } });
    right.send({ type: 'result', result: { role: 'right', manifestHash: hash, wpm: 22 } });
    expect(await left.next('complete')).toMatchObject({ status: 'complete', left: { wpm: 18 }, right: { wpm: 22 } });
    left.close();
    right.close();
  });

  it('cancels before the start when a side does not acknowledge the schedule', async () => {
    const { left, right } = await pair();
    left.send({ type: 'manifest', manifest });
    const { hash } = await left.next('manifest');
    left.send({ type: 'ready', hash });
    right.send({ type: 'ready', hash });
    await clocks(left, right);
    left.send({ type: 'arm' });
    right.send({ type: 'arm' });
    const schedule = await left.next('schedule');
    left.send({ type: 'schedule-ack', startAt: schedule.startAt });
    expect(await left.next('cancel', 6000)).toMatchObject({ reason: expect.stringMatching(/did not acknowledge/) });
    left.close();
    right.close();
  }, 10_000);

  it('refuses to schedule with a stale or missing clock estimate', async () => {
    const { left, right } = await pair();
    left.send({ type: 'manifest', manifest });
    const { hash } = await left.next('manifest');
    left.send({ type: 'ready', hash });
    right.send({ type: 'ready', hash });
    left.send({ type: 'clock', uncertaintyMs: 5, samples: 8 });
    left.send({ type: 'arm' });
    right.send({ type: 'arm' });
    expect(await left.next('cancel')).toMatchObject({ reason: expect.stringMatching(/right clock/) });
    left.close();
    right.close();
  });

  it('a lost side marks a running run incomplete; a stop notifies the other side', async () => {
    const { left, right } = await pair();
    left.send({ type: 'manifest', manifest });
    const { hash } = await left.next('manifest');
    left.send({ type: 'ready', hash });
    right.send({ type: 'ready', hash });
    await clocks(left, right);
    left.send({ type: 'arm' });
    right.send({ type: 'arm' });
    const schedule = await left.next('schedule');
    left.send({ type: 'schedule-ack', startAt: schedule.startAt });
    right.send({ type: 'schedule-ack', startAt: schedule.startAt });
    await left.next('go');
    right.send({ type: 'stop', reason: 'focus lost' });
    expect(await left.next('stopped')).toMatchObject({ by: 'right', reason: 'focus lost' });
    const again = await pair();
    again.left.send({ type: 'manifest', manifest });
    const h2 = (await again.left.next('manifest')).hash;
    again.left.send({ type: 'ready', hash: h2 });
    again.right.send({ type: 'ready', hash: h2 });
    await clocks(again.left, again.right);
    again.left.send({ type: 'arm' });
    again.right.send({ type: 'arm' });
    const s2 = await again.left.next('schedule');
    again.left.send({ type: 'schedule-ack', startAt: s2.startAt });
    again.right.send({ type: 'schedule-ack', startAt: s2.startAt });
    await again.left.next('go');
    again.right.close();
    expect(await again.left.next('peer-left')).toMatchObject({ role: 'right', incomplete: true });
    again.left.close();
    left.close();
    right.close();
  });
});
