import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PROSE } from '../../src/content/corpus';
import { corpusExercise } from '../../src/domain/exercises/exercise';
import type { InputMeta } from '../../src/domain/input/types';
import type { KeyboardSetup } from '../../src/domain/records';
import { TrialEngine } from '../../src/domain/scoring/engine';
import { toGraphemes } from '../../src/domain/text/graphemes';
import { runningTrial } from '../../src/domain/trial-record';
import { PROTOCOLS } from '../../src/domain/versions';
import { openTypistDb } from '../../src/storage/db';
import { WriterLease } from '../../src/storage/lease';
import { recoverRunningTrials } from '../../src/storage/recovery';
import { LeaseLostError, Repository, StorageWriteError } from '../../src/storage/repo';

const KEY: InputMeta = { path: 'key', inputType: 'insertText', code: null, key: null };
let dbCount = 0;
const opened: { close(): void }[] = [];

async function fresh(name = `typist-test-${(dbCount += 1)}`) {
  const db = await openTypistDb(name);
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

const SETUP: KeyboardSetup = {
  schemaVersion: 1,
  id: 'setup-1',
  setupId: 'S',
  revision: 1,
  createdAt: '2026-09-01T00:00:00Z',
  geometryId: 'ansi-us',
  geometryVersion: 1,
  keyboardLabel: 'Test board',
  os: 'linux',
  sessionType: 'wayland',
  browser: 'test',
  qwertyLayoutId: 'qwerty-us-intl',
  modifierStrategy: 'hold-shift',
  modifierNotes: '',
  remaps: '',
  keyboardOffset: { left: '', right: '' },
  chairDeskNotes: '',
  changeReason: null,
  geometryVerified: true,
};

function benchmarkTrial(id: string) {
  const exercise = corpusExercise(PROSE, PROSE.items[2]!);
  const trial = runningTrial({
    id,
    sessionId: 'session-1',
    blockId: 'block-1',
    mode: 'QL',
    kind: 'benchmark',
    protocol: PROTOCOLS['english-prose-60-v1'],
    setup: SETUP,
    layout: { id: 'qwerty-us-intl', revision: 1 },
    ledger: { id: 'ledger-1', revision: 1 },
    calibrationId: null,
    exercise,
    assistance: { initial: 'none', shown: ['none'], revealed: false, policy: 'no-assistance' },
    startedAt: '2026-09-01T10:00:00Z',
    timeZone: 'UTC',
    localDate: '2026-09-01',
    benchmarkSetId: 'set-1',
    setIndex: 0,
    replacesTrialId: null,
    assessmentLevel: null,
    inputPath: 'native',
  });
  return { exercise, trial };
}

describe('writer lease', () => {
  it('gives one tab the lease and leaves another read-only until an explicit takeover', async () => {
    const db = await fresh();
    const a = new WriterLease(db, 'tab-a');
    const b = new WriterLease(db, 'tab-b');
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(b.state).toBe('read-only');
    expect(await b.acquire(true)).toBe(true);
    await a.renew();
    expect(a.state).toBe('lost');
    a.dispose();
    b.dispose();
  });

  it('A21: a second tab cannot write a competing active trial', async () => {
    const db = await fresh();
    const a = new WriterLease(db, 'tab-a');
    await a.acquire();
    const repoB = new Repository(db, 'tab-b');
    const { exercise, trial } = benchmarkTrial('t-b');
    await expect(repoB.beginTrial(trial, exercise)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await db.get('trials', 't-b')).toBeUndefined();
    a.dispose();
  });

  it('claims a lease whose holder no longer answers (a reloaded or closed page) without waiting for expiry', async () => {
    const db = await fresh();
    await db.put('meta', { key: 'lease', holderId: 'reloaded-page', expiresAt: Date.now() + 9_000, acquiredAt: 0 });
    const lease = new WriterLease(db, 'tab-new');
    expect(await lease.acquireUnlessLive(50)).toBe(true);
    lease.dispose();
  });

  it('stays read-only while the holder is alive and answers the ping', async () => {
    const db = await fresh();
    const alive = new WriterLease(db, 'tab-alive');
    await alive.acquire();
    const other = new WriterLease(db, 'tab-other');
    expect(await other.acquireUnlessLive(200)).toBe(false);
    expect(other.state).toBe('read-only');
    alive.dispose();
    other.dispose();
  });

  it('lets an expired lease be acquired by the next tab', async () => {
    const db = await fresh();
    await db.put('meta', { key: 'lease', holderId: 'crashed', expiresAt: Date.now() - 1, acquiredAt: 0 });
    const lease = new WriterLease(db, 'tab-new');
    expect(await lease.acquire()).toBe(true);
    lease.dispose();
  });
});

describe('journal and recovery', () => {
  it('persists the frozen prompt before input and recovers a killed page as an interrupted record', async () => {
    const db = await fresh();
    const lease = new WriterLease(db, 'tab-a');
    await lease.acquire();
    const repo = new Repository(db, 'tab-a');
    const { exercise, trial } = benchmarkTrial('t-1');
    await repo.beginTrial(trial, exercise);
    expect((await repo.loadExercise(exercise.sha256))?.exercise.text).toBe(exercise.text);

    const engine = new TrialEngine({ kind: 'benchmark', timing: { mode: 'fixed', durationMs: 60_000 }, target: toGraphemes(exercise.text) });
    const target = toGraphemes(exercise.text);
    for (let i = 0; i < 30; i += 1) engine.insert(1000 + i * 200, target[i] as string, KEY);
    await repo.appendChunk({ trialId: 't-1', chunk: 0, events: engine.events.slice(0, 20) });
    await repo.appendChunk({ trialId: 't-1', chunk: 1, events: engine.events.slice(20) });
    // The page is killed here; a new page starts and recovers.
    const recovered = await recoverRunningTrials(repo);
    expect(recovered).toHaveLength(1);
    const saved = await db.get('trials', 't-1');
    expect(saved?.status).toBe('interrupted');
    expect(saved?.interruption).toBe('recovered-after-restart');
    expect(saved?.counters.attempts).toBe(30);
    expect(saved?.activeMs).toBe(29 * 200);
    const events = await repo.loadEvents('t-1');
    expect(events.at(-1)).toMatchObject({ kind: 'interrupt', reason: 'recovered-after-restart' });
    expect(await repo.runningTrials()).toEqual([]);
    lease.dispose();
  });

  it('turns a zero-input armed trial into an aborted record, not a benchmark', async () => {
    const db = await fresh();
    const lease = new WriterLease(db, 'tab-a');
    await lease.acquire();
    const repo = new Repository(db, 'tab-a');
    const { exercise, trial } = benchmarkTrial('t-2');
    await repo.beginTrial(trial, exercise);
    await recoverRunningTrials(repo);
    expect((await db.get('trials', 't-2'))?.status).toBe('aborted');
    lease.dispose();
  });

  it('A21: a failed commit reports an unsaved state and leaves the old data intact', async () => {
    const db = await fresh();
    const lease = new WriterLease(db, 'tab-a');
    await lease.acquire();
    const repo = new Repository(db, 'tab-a');
    const states: string[] = [];
    repo.onSaveState((s) => states.push(s.status));
    const { exercise, trial } = benchmarkTrial('t-3');
    await repo.beginTrial(trial, exercise);
    repo.failNextWrite = new DOMException('full', 'QuotaExceededError');
    await expect(repo.commitTrial({ trial: { ...trial, status: 'completed' } })).rejects.toBeInstanceOf(StorageWriteError);
    expect(repo.saveState).toMatchObject({ status: 'failed', error: expect.stringMatching(/storage is full/) });
    expect((await db.get('trials', 't-3'))?.status).toBe('running');
    await repo.commitTrial({ trial: { ...trial, status: 'completed' } });
    expect(repo.saveState.status).toBe('saved');
    expect(states).toEqual(['saving', 'failed', 'saving', 'saved']);
    lease.dispose();
  });
});
