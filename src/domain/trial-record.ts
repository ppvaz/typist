// Building trial records. A trial record is written as "running" before the
// first keystroke (so the frozen prompt and configuration survive a crash),
// then finalized from the engine's outcome. Recovery uses the same code path.
import type { Exercise } from './exercises/exercise';
import type { LayoutDefinition } from './layouts/registry';
import type { ModeId } from './modes';
import {
  type AssistanceRecord,
  EMPTY_DECLARATIONS,
  exerciseRef,
  type FingeringLedger,
  type KeyboardSetup,
  RECORD_SCHEMA_VERSION,
  type SetupSnapshot,
  type TrialKind,
  type TrialRecord,
} from './records';
import type { Level } from './curriculum';
import type { TrialEngine, TrialEvent, TrialOutcome } from './scoring/engine';
import { comparisonSignature, signatureHash } from './signature';
import { APP_VERSION, type ProtocolDefinition, SCORER_VERSION } from './versions';

export interface TrialContext {
  readonly id: string;
  readonly sessionId: string | null;
  readonly blockId: string | null;
  readonly mode: ModeId;
  readonly kind: TrialKind;
  readonly protocol: ProtocolDefinition;
  readonly setup: KeyboardSetup;
  readonly layout: Pick<LayoutDefinition, 'id' | 'revision'>;
  readonly ledger: Pick<FingeringLedger, 'id' | 'revision'> | null;
  readonly calibrationId: string | null;
  readonly exercise: Exercise;
  readonly assistance: AssistanceRecord;
  readonly startedAt: string;
  readonly timeZone: string;
  readonly localDate: string;
  readonly benchmarkSetId: string | null;
  readonly setIndex: number | null;
  readonly replacesTrialId: string | null;
  readonly assessmentLevel: Level | null;
  readonly inputPath: 'native' | 'emulated';
}

export function setupSnapshot(setup: KeyboardSetup): SetupSnapshot {
  return {
    setupRevisionId: setup.id,
    setupRevision: setup.revision,
    geometryId: setup.geometryId,
    keyboardLabel: setup.keyboardLabel,
    modifierStrategy: setup.modifierStrategy,
    keyboardOffset: setup.keyboardOffset,
    chairDeskNotes: setup.chairDeskNotes,
    browser: setup.browser,
    os: setup.os,
  };
}

export function runningTrial(ctx: TrialContext): TrialRecord {
  const signature = comparisonSignature({
    protocol: ctx.protocol,
    mode: ctx.mode,
    layoutId: ctx.layout.id,
    layoutRevision: ctx.layout.revision,
    setup: ctx.setup,
    ledgerRevisionId: ctx.ledger?.id ?? null,
    exercise: ctx.exercise,
    inputPath: ctx.inputPath,
  });
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: ctx.id,
    sessionId: ctx.sessionId,
    blockId: ctx.blockId,
    mode: ctx.mode,
    kind: ctx.kind,
    protocolId: ctx.protocol.id,
    scorerVersion: SCORER_VERSION,
    appVersion: APP_VERSION,
    origin: 'native-run',
    reference: ctx.protocol.reference,
    verification: 'verified',
    inputPath: ctx.inputPath,
    setup: setupSnapshot(ctx.setup),
    layoutId: ctx.layout.id,
    layoutRevision: ctx.layout.revision,
    ledgerRevisionId: ctx.ledger?.id ?? null,
    ledgerRevision: ctx.ledger?.revision ?? null,
    calibrationId: ctx.calibrationId,
    exercise: exerciseRef(ctx.exercise),
    timing: ctx.protocol.timing,
    assistance: ctx.assistance,
    status: 'running',
    endReason: null,
    interruption: null,
    invalidity: [],
    startedAt: ctx.startedAt,
    endedAt: null,
    timeZone: ctx.timeZone,
    localDate: ctx.localDate,
    startAtMs: null,
    endAtMs: null,
    activeMs: null,
    counters: { attempts: 0, attemptsCorrect: 0, finalCorrect: 0, residualErrors: 0, corrections: 0, emptyBackspaces: 0, lateInputs: 0 },
    metrics: { wpm: null, rawWpm: null, accuracy: null },
    declarations: EMPTY_DECLARATIONS,
    signature,
    signatureHash: signatureHash(signature),
    benchmarkSetId: ctx.benchmarkSetId,
    setIndex: ctx.setIndex,
    replacesTrialId: ctx.replacesTrialId,
    eventCount: 0,
    eventsPruned: false,
    assessmentLevel: ctx.assessmentLevel,
    note: null,
  };
}

/** Unknown insertion provenance: no associated key press, or several characters at once. */
export function provenanceOf(events: readonly TrialEvent[]): 'verified' | 'unverified' {
  return events.some((e) => e.kind === 'insert' && (e.input.path === 'unassociated' || e.input.path === 'multi')) ? 'unverified' : 'verified';
}

/** The finished record, from the engine's frozen outcome. */
export function finalizedTrial(running: TrialRecord, outcome: TrialOutcome, endedAt: string, assistance: AssistanceRecord, eventCount: number, events: readonly TrialEvent[] = []): TrialRecord {
  return {
    ...running,
    verification: provenanceOf(events),
    status: outcome.status ?? 'interrupted',
    endReason: outcome.endReason,
    interruption: outcome.interruption,
    invalidity: outcome.invalidity,
    endedAt,
    startAtMs: outcome.startAtMs,
    endAtMs: outcome.endAtMs,
    activeMs: outcome.activeMs,
    counters: outcome.counters,
    metrics: outcome.metrics,
    assistance,
    eventCount,
  };
}

/** Snapshot of an engine as a running record (for live journal updates). */
export function liveTrial(running: TrialRecord, engine: TrialEngine, nowMs: number): TrialRecord {
  const outcome = engine.outcome(nowMs);
  return { ...running, startAtMs: outcome.startAtMs, counters: outcome.counters, metrics: outcome.metrics, eventCount: engine.events.length };
}
