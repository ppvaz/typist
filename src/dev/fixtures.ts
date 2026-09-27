// Development and test fixtures: synthetic benchmark history built with the
// same record code as real trials, so the whole progression can be shown in
// minutes instead of 20 weeks. Only loaded in development builds; synthetic
// records are labeled with a "fixture" note and never ship in production.
import { PROSE } from '../content/corpus';
import { corpusExercise } from '../domain/exercises/exercise';
import { newId } from '../domain/ids';
import type { ModeId } from '../domain/modes';
import {
  type BenchmarkSetRecord,
  type Declarations,
  RECORD_SCHEMA_VERSION,
  type SessionRecord,
  type StoredExercise,
  type SwitchProbeRecord,
  type TrialRecord,
} from '../domain/records';
import type { TrialOutcome } from '../domain/scoring/engine';
import { computeMetrics } from '../domain/scoring/metrics';
import { finalizedTrial, runningTrial } from '../domain/trial-record';
import { APP_VERSION, CORE_PROTOCOL_ID, PROTOCOLS } from '../domain/versions';
import type { AppStore } from '../app/store/AppStore';
import { currentLedger, currentSetup, layoutFor } from '../app/store/derive';

export interface FixtureTrial {
  readonly wpm: number;
  readonly accuracy: number;
  readonly glances?: number | 'unknown' | null;
  readonly hand?: 'stated' | 'other';
  readonly assistance?: 'none' | 'full-map';
  readonly status?: 'completed' | 'interrupted';
}

export interface FixtureSet {
  readonly date: string;
  readonly trials: readonly FixtureTrial[];
  readonly purpose?: BenchmarkSetRecord['purpose'];
}

function counters(wpm: number, accuracy: number) {
  const finalCorrect = Math.round(wpm * 5);
  const wrong = Math.round((finalCorrect * (100 - accuracy)) / accuracy);
  return { attempts: finalCorrect + wrong, attemptsCorrect: finalCorrect, finalCorrect, residualErrors: 0, corrections: wrong, emptyBackspaces: 0, lateInputs: 0 };
}

export function buildHistory(store: AppStore, mode: ModeId, sets: readonly FixtureSet[]) {
  const data = store.getState().data;
  const setup = currentSetup(data.setups);
  if (!setup) throw new Error('Create a profile first.');
  const layout = layoutFor(mode, setup);
  const ledger = currentLedger(data.ledgers, mode, setup.setupId);
  const timeZone = data.profile?.timeZone ?? 'UTC';
  const sessions: SessionRecord[] = [];
  const trials: TrialRecord[] = [];
  const setRecords: BenchmarkSetRecord[] = [];
  const exercises = new Map<string, StoredExercise>();
  sets.forEach((spec, n) => {
    const sessionId = newId();
    const startedAt = `${spec.date}T10:00:00.000Z`;
    const setId = newId();
    const ids: string[] = [];
    spec.trials.forEach((t, i) => {
      const exercise = corpusExercise(PROSE, PROSE.items[(n * 3 + i) % PROSE.items.length] as (typeof PROSE.items)[number]);
      exercises.set(exercise.sha256, { sha256: exercise.sha256, exercise, storedAt: startedAt });
      const running = runningTrial({
        id: newId(),
        sessionId,
        blockId: null,
        mode,
        kind: 'benchmark',
        protocol: PROTOCOLS['english-prose-60-v1'],
        setup,
        layout,
        ledger,
        calibrationId: null,
        exercise,
        assistance: { initial: t.assistance ?? 'none', shown: [t.assistance ?? 'none'], revealed: false, policy: 'no-assistance' },
        startedAt: `${spec.date}T10:0${i}:00.000Z`,
        timeZone,
        localDate: spec.date,
        benchmarkSetId: setId,
        setIndex: i,
        replacesTrialId: null,
        assessmentLevel: null,
        inputPath: 'native',
      });
      const c = counters(t.wpm, t.accuracy);
      const interrupted = t.status === 'interrupted';
      const activeMs = interrupted ? 30_000 : 60_000;
      const outcome: TrialOutcome = {
        status: interrupted ? 'interrupted' : 'completed',
        endReason: interrupted ? null : 'deadline',
        interruption: interrupted ? 'focus-lost' : null,
        invalidity: [],
        startAtMs: 0,
        endAtMs: activeMs,
        activeMs,
        counters: c,
        metrics: computeMetrics(c, activeMs),
      };
      const declarations: Declarations = {
        glances: t.glances === null ? null : t.glances === 'unknown' ? { kind: 'unknown' } : { kind: 'exact', count: t.glances ?? 0 },
        hand: t.hand ?? 'stated',
        unrecordedAssistance: false,
        updatedAt: startedAt,
      };
      trials.push({ ...finalizedTrial(running, outcome, `${spec.date}T10:0${i}:59.000Z`, running.assistance, 0), declarations, note: 'fixture' });
      ids.push(running.id);
    });
    setRecords.push({
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: setId,
      sessionId,
      mode,
      protocolId: 'english-prose-60-v1',
      localDate: spec.date,
      timeZone,
      createdAt: startedAt,
      signatureHash: trials.at(-1)?.signatureHash ?? '',
      trialIds: ids,
      status: 'complete',
      purpose: spec.purpose ?? 'stage',
    });
    sessions.push({
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: sessionId,
      startedAt,
      endedAt: `${spec.date}T10:30:00.000Z`,
      timeZone,
      localDate: spec.date,
      template: 'standard',
      plannedBlocks: [],
      plannedMinutes: 30,
      blocks: [{ blockId: newId(), kind: 'benchmark', mode, startedAt, endedAt: `${spec.date}T10:06:00.000Z`, activeMs: 180_000, trialIds: ids, status: 'completed' }],
      actualMinutes: 3,
      fatigueBefore: 1,
      fatigueAfter: 2,
      effort: 3,
      note: 'fixture',
      status: 'completed',
      appVersion: APP_VERSION,
      protocolId: CORE_PROTOCOL_ID,
      deferred: [],
    });
  });
  return { sessions, trials, sets: setRecords, exercises: [...exercises.values()] };
}

/** Write synthetic history, then evaluate awards exactly as after real sets. */
export async function loadHistory(store: AppStore, mode: ModeId, sets: readonly FixtureSet[]): Promise<{ trials: number; milestones: number }> {
  const built = buildHistory(store, mode, sets);
  const repo = store.repo;
  if (!repo) throw new Error('No repository');
  await repo.write(['exercises'], async (tx) => {
    const t = tx as unknown as { objectStore(n: 'exercises'): { put(v: StoredExercise): Promise<unknown> } };
    for (const e of built.exercises) await t.objectStore('exercises').put(e);
  });
  await repo.putMany({ sessions: built.sessions, trials: built.trials, sets: built.sets });
  store.applyUpserts({ sessions: built.sessions, trials: built.trials, sets: built.sets });
  const awards = await store.applyAwards();
  return { trials: built.trials.length, milestones: awards.milestones.length };
}

export async function loadProbes(store: AppStore, probes: readonly Partial<SwitchProbeRecord>[]): Promise<void> {
  for (const p of probes) {
    await store.saveProbe({
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: newId(),
      sessionId: null,
      blockId: null,
      stage: 'paired',
      from: 'QL',
      to: 'QR',
      fromLayout: '',
      toLayout: '',
      setupRevisionId: '',
      cueAt: new Date().toISOString(),
      localDate: store.getState().today,
      seed: 1,
      sequenceIndex: 0,
      prompt: 'fixture',
      outcome: 'complete',
      latencyMs: 7000,
      lowerBoundMs: null,
      firstInsertMs: 1500,
      resets: 0,
      interruption: null,
      declarations: { glances: { kind: 'exact', count: 0 } },
      events: [],
      origin: 'native-run',
      ...p,
    });
  }
}
