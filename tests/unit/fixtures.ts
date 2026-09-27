// Record fixtures for gate, maintenance and planning tests. Counters are
// chosen so metrics are exact: a 60 s trial with C_final characters has
// WPM = C_final / 5.
import { PROSE } from '../../src/content/corpus';
import { corpusExercise } from '../../src/domain/exercises/exercise';
import type { ModeId } from '../../src/domain/modes';
import type {
  BenchmarkSetRecord,
  Declarations,
  GlanceDeclaration,
  MilestoneRecord,
  TrialRecord,
} from '../../src/domain/records';
import { comparisonSignature, signatureHash } from '../../src/domain/signature';
import { PROTOCOLS } from '../../src/domain/versions';

let counter = 0;
export function nextId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

const SETUP = { id: 'setup-rev-1', geometryId: 'ansi-us' as const, geometryVersion: 1, modifierStrategy: 'hold-shift' as const };

export function signatureFor(mode: ModeId, setupRevisionId = SETUP.id, ledgerRevisionId: string | null = `ledger-${mode}-1`) {
  const exercise = corpusExercise(PROSE, PROSE.items[0]!);
  const signature = comparisonSignature({
    protocol: PROTOCOLS['english-prose-60-v1'],
    mode,
    layoutId: mode.startsWith('Q') ? 'qwerty-us-intl' : mode === 'DL' ? 'dvorak-left-us' : 'dvorak-right-us',
    layoutRevision: 1,
    setup: { ...SETUP, id: setupRevisionId },
    ledgerRevisionId,
    exercise,
    inputPath: 'native',
  });
  return { signature, hash: signatureHash(signature) };
}

export const CLEAN: Declarations = { glances: { kind: 'exact', count: 0 }, hand: 'stated', unrecordedAssistance: false, updatedAt: '2026-09-01T00:00:00.000Z' };

export interface TrialSpec {
  readonly mode?: ModeId;
  /** Correct-output WPM for a 60 s trial; must be a multiple of 0.2. */
  readonly wpm: number;
  /** Attempt accuracy as correct / attempts. */
  readonly correct?: number;
  readonly attempts?: number;
  readonly date?: string;
  readonly glances?: GlanceDeclaration | null;
  readonly hand?: 'stated' | 'other' | null;
  readonly unrecordedAssistance?: boolean | null;
  readonly assistance?: 'none' | 'full-map' | 'anchors';
  readonly revealed?: boolean;
  readonly status?: TrialRecord['status'];
  readonly setupRevisionId?: string;
  readonly protocolId?: string;
  readonly activeMs?: number;
  readonly verification?: 'verified' | 'unverified';
}

export function trial(spec: TrialSpec): TrialRecord {
  const mode = spec.mode ?? 'QL';
  const finalCorrect = Math.round(spec.wpm * 5);
  const attempts = spec.attempts ?? Math.max(finalCorrect, 1) * 2;
  const correct = spec.correct ?? attempts;
  const date = spec.date ?? '2026-09-01';
  const { signature, hash } = signatureFor(mode, spec.setupRevisionId);
  const exercise = corpusExercise(PROSE, PROSE.items[0]!);
  const assistance = spec.assistance ?? 'none';
  return {
    schemaVersion: 1,
    id: nextId('trial'),
    sessionId: 'session',
    blockId: 'block',
    mode,
    kind: 'benchmark',
    protocolId: spec.protocolId ?? 'english-prose-60-v1',
    scorerVersion: 'typist-scorer-v1',
    appVersion: 'test',
    origin: 'native-run',
    reference: true,
    verification: spec.verification ?? 'verified',
    inputPath: 'native',
    setup: {
      setupRevisionId: spec.setupRevisionId ?? SETUP.id,
      setupRevision: 1,
      geometryId: 'ansi-us',
      keyboardLabel: 'test',
      modifierStrategy: 'hold-shift',
      keyboardOffset: { left: '', right: '' },
      chairDeskNotes: '',
      browser: 'test',
      os: 'linux',
    },
    layoutId: 'qwerty-us-intl',
    layoutRevision: 1,
    ledgerRevisionId: `ledger-${mode}-1`,
    ledgerRevision: 1,
    calibrationId: null,
    exercise,
    timing: { mode: 'fixed', durationMs: 60_000 },
    assistance: { initial: assistance, shown: [assistance], revealed: spec.revealed ?? false, policy: 'no-assistance' },
    status: spec.status ?? 'completed',
    endReason: 'deadline',
    interruption: null,
    invalidity: [],
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T10:01:00.000Z`,
    timeZone: 'UTC',
    localDate: date,
    startAtMs: 0,
    endAtMs: 60_000,
    activeMs: spec.activeMs ?? 60_000,
    counters: {
      attempts,
      attemptsCorrect: correct,
      finalCorrect,
      residualErrors: 0,
      corrections: 0,
      emptyBackspaces: 0,
      lateInputs: 0,
    },
    metrics: { wpm: spec.wpm, rawWpm: attempts / 5, accuracy: (100 * correct) / attempts },
    declarations: {
      glances: spec.glances === undefined ? CLEAN.glances : spec.glances,
      hand: spec.hand === undefined ? 'stated' : spec.hand,
      unrecordedAssistance: spec.unrecordedAssistance === undefined ? false : spec.unrecordedAssistance,
      updatedAt: CLEAN.updatedAt,
    },
    signature,
    signatureHash: hash,
    benchmarkSetId: null,
    setIndex: null,
    replacesTrialId: null,
    eventCount: 0,
    eventsPruned: false,
    assessmentLevel: null,
    note: null,
  };
}

/** Accuracy spec helper: `acc(98)` → 196 of 200 attempts. */
export function acc(percent: number, attempts = 1000): { correct: number; attempts: number } {
  return { correct: Math.round((percent * attempts) / 100), attempts };
}

export interface SetBundle {
  readonly set: BenchmarkSetRecord;
  readonly trials: readonly TrialRecord[];
}

export function set(trials: readonly TrialRecord[], opts: { date?: string; createdAt?: string; mode?: ModeId } = {}): SetBundle {
  const first = trials[0];
  const date = opts.date ?? first?.localDate ?? '2026-09-01';
  const mode = opts.mode ?? first?.mode ?? 'QL';
  const id = nextId('set');
  const record: BenchmarkSetRecord = {
    schemaVersion: 1,
    id,
    sessionId: 'session',
    mode,
    protocolId: 'english-prose-60-v1',
    localDate: date,
    timeZone: 'UTC',
    createdAt: opts.createdAt ?? `${date}T10:00:00.000Z`,
    signatureHash: first?.signatureHash ?? signatureFor(mode).hash,
    trialIds: trials.map((t) => t.id),
    status: 'complete',
    purpose: 'stage',
  };
  return { set: record, trials: trials.map((t, i) => ({ ...t, localDate: date, benchmarkSetId: id, setIndex: i })) };
}

/** Three identical passing trials on a date. */
export function passingSet(date: string, mode: ModeId = 'QL', wpm = 32, accuracy = 99, extra: Partial<TrialSpec> = {}): SetBundle {
  return set(
    [0, 1, 2].map(() => trial({ mode, wpm, ...acc(accuracy), date, ...extra })),
    { date, mode },
  );
}

export function index(bundles: readonly SetBundle[]): { sets: BenchmarkSetRecord[]; trials: Map<string, TrialRecord> } {
  const trials = new Map<string, TrialRecord>();
  for (const b of bundles) for (const t of b.trials) trials.set(t.id, t);
  return { sets: bundles.map((b) => b.set), trials };
}

export function milestone(mode: ModeId, setIds: string[], hash: string, date: string): MilestoneRecord {
  return {
    schemaVersion: 1,
    id: nextId('milestone'),
    mode,
    kind: 'acquired',
    target: { wpm: '30', accuracyPercent: '98', label: null },
    protocolId: 'english-prose-60-v1',
    gateRules: 'test',
    awardedAt: `${date}T12:00:00.000Z`,
    awardedLocalDate: date,
    signatureHash: hash,
    setIds,
    trialIds: [],
    evaluation: [],
    origin: 'native-run',
  };
}
