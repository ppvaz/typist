// Switching (docs/training-protocol.md "Switching", docs/measurement.md
// "Switch latency").
//
// Latency runs from the painted cue to the tenth consecutive correct target
// insertion. Wrong insertions and Backspace reset the streak, never the clock.
// OS layout switching and hand movement stay inside the interval. A timeout
// at 30 s is recorded as a lower bound, never as a successful latency.
import defaults from '../../config/training-defaults.json';
import { modeById, type ModeId } from './modes';
import type { GlanceDeclaration, ProbeOutcome, SwitchProbeRecord, SwitchStage } from './records';
import { numericMedian } from './scoring/fraction';
import { createRandom } from './random';

const SW = defaults.switching;
export const STREAK_LENGTH = SW.correctStreakLength;
export const PROBE_TIMEOUT_MS = SW.probeTimeoutSeconds * 1000;
export const PRELIMINARY_BELOW = 5;
export const READINESS_PROBES = SW.randomReadinessSuccessfulProbesPerDirection;
export const FAMILIAR_TARGET_MS = SW.familiarTargetSecondsLessThan * 1000;
export const ADVANCED_TARGET_MS = SW.advancedTargetSecondsLessThan * 1000;

export type ProbePhase = 'preparing' | 'typing-streak' | 'complete' | 'timeout' | 'interrupted' | 'invalid';

export interface ProbeEvent {
  readonly atMs: number;
  readonly kind: 'insert' | 'delete' | 'focus-lost' | 'focus-regained' | 'hidden' | 'timeout' | 'complete' | 'interrupt';
  readonly grapheme?: string;
  readonly correct?: boolean;
}

/**
 * One latency probe. Times are milliseconds on one monotonic clock; the cue
 * time is when the new mode cue was painted.
 */
export class SwitchProbeEngine {
  readonly target: readonly string[];
  readonly cueAtMs: number;
  private phaseValue: ProbePhase = 'preparing';
  private readonly buffer: boolean[] = [];
  private streak = 0;
  private resetsValue = 0;
  private firstInsert: number | null = null;
  private end: number | null = null;
  private interruption: string | null = null;
  private readonly log: ProbeEvent[] = [];

  constructor(target: readonly string[], cueAtMs: number) {
    if (target.length < STREAK_LENGTH) throw new Error('A probe prompt needs at least ten characters.');
    this.target = target;
    this.cueAtMs = cueAtMs;
  }

  get phase(): ProbePhase {
    return this.phaseValue;
  }

  get events(): readonly ProbeEvent[] {
    return this.log;
  }

  get currentStreak(): number {
    return this.streak;
  }

  get resets(): number {
    return this.resetsValue;
  }

  get bufferLength(): number {
    return this.buffer.length;
  }

  get deadlineMs(): number {
    return this.cueAtMs + PROBE_TIMEOUT_MS;
  }

  isCorrectAt(index: number): boolean | null {
    return this.buffer[index] ?? null;
  }

  private done(): boolean {
    return this.phaseValue === 'complete' || this.phaseValue === 'timeout' || this.phaseValue === 'interrupted' || this.phaseValue === 'invalid';
  }

  /** Checks the deadline first so late events can never complete a probe. */
  private expire(atMs: number): boolean {
    if (this.done()) return true;
    if (atMs - this.cueAtMs >= PROBE_TIMEOUT_MS) {
      this.phaseValue = 'timeout';
      this.end = this.deadlineMs;
      this.log.push({ atMs: this.deadlineMs, kind: 'timeout' });
      return true;
    }
    return false;
  }

  insert(atMs: number, grapheme: string): void {
    if (this.expire(atMs)) return;
    if (this.firstInsert === null) this.firstInsert = atMs;
    this.phaseValue = 'typing-streak';
    const index = this.buffer.length;
    const correct = this.target[index] === grapheme;
    this.buffer.push(correct);
    this.log.push({ atMs, kind: 'insert', grapheme, correct });
    if (correct) {
      this.streak += 1;
      if (this.streak >= STREAK_LENGTH) {
        this.phaseValue = 'complete';
        this.end = atMs;
        this.log.push({ atMs, kind: 'complete' });
      }
    } else {
      if (this.streak > 0) this.resetsValue += 1;
      this.streak = 0;
    }
  }

  deleteBackward(atMs: number): void {
    if (this.expire(atMs)) return;
    this.buffer.pop();
    if (this.streak > 0) this.resetsValue += 1;
    this.streak = 0;
    this.log.push({ atMs, kind: 'delete' });
  }

  /** Focus loss: allowed while preparing (OS input menus), interrupts once typing began. */
  blur(atMs: number): void {
    if (this.expire(atMs)) return;
    this.log.push({ atMs, kind: 'focus-lost' });
    if (this.phaseValue === 'typing-streak') this.stop(atMs, 'interrupted', 'focus-lost');
  }

  focus(atMs: number): void {
    if (this.expire(atMs)) return;
    this.log.push({ atMs, kind: 'focus-regained' });
  }

  /** Hidden page, sleep or an unobservable interval invalidates at any phase. */
  hidden(atMs: number, reason = 'page-hidden'): void {
    if (this.done()) return;
    this.log.push({ atMs, kind: 'hidden' });
    this.stop(atMs, 'invalid', reason);
  }

  interrupt(atMs: number, reason: string): void {
    if (this.expire(atMs)) return;
    this.stop(atMs, 'interrupted', reason);
  }

  /** Called by a timer; also settles timeouts when no event arrives. */
  tick(atMs: number): void {
    this.expire(atMs);
  }

  private stop(atMs: number, phase: 'interrupted' | 'invalid', reason: string): void {
    this.phaseValue = phase;
    this.end = atMs;
    this.interruption = reason;
    this.log.push({ atMs, kind: 'interrupt' });
  }

  outcome(): { outcome: ProbeOutcome | null; latencyMs: number | null; lowerBoundMs: number | null; firstInsertMs: number | null; interruption: string | null } {
    const firstInsertMs = this.firstInsert === null ? null : this.firstInsert - this.cueAtMs;
    switch (this.phaseValue) {
      case 'complete':
        return { outcome: 'complete', latencyMs: (this.end as number) - this.cueAtMs, lowerBoundMs: null, firstInsertMs, interruption: null };
      case 'timeout':
        return { outcome: 'timeout', latencyMs: null, lowerBoundMs: PROBE_TIMEOUT_MS, firstInsertMs, interruption: null };
      case 'interrupted':
      case 'invalid':
        return { outcome: this.phaseValue, latencyMs: null, lowerBoundMs: null, firstInsertMs, interruption: this.interruption };
      default:
        return { outcome: null, latencyMs: null, lowerBoundMs: null, firstInsertMs, interruption: null };
    }
  }
}

export type PairKind = 'hand-only' | 'layout-only' | 'hand-and-layout';

export function pairKind(from: ModeId, to: ModeId): PairKind {
  const a = modeById(from);
  const b = modeById(to);
  if (a.family === b.family) return 'hand-only';
  if (a.hand === b.hand) return 'layout-only';
  return 'hand-and-layout';
}

export const PAIR_KIND_LABEL: Readonly<Record<PairKind, string>> = {
  'hand-only': 'changes hand only',
  'layout-only': 'changes layout only',
  'hand-and-layout': 'changes hand and layout',
};

export interface PairSummary {
  readonly from: ModeId;
  readonly to: ModeId;
  readonly kind: PairKind;
  readonly attempts: number;
  readonly successes: number;
  readonly timeouts: number;
  readonly interruptions: number;
  readonly medianMs: number | null;
  readonly preliminary: boolean;
  readonly glancesReported: number;
}

export function summarizePair(probes: readonly SwitchProbeRecord[], from: ModeId, to: ModeId): PairSummary {
  const list = probes.filter((p) => p.from === from && p.to === to);
  const successes = list.filter((p) => p.outcome === 'complete' && p.latencyMs !== null);
  const median = numericMedian(successes.map((p) => p.latencyMs as number));
  return {
    from,
    to,
    kind: pairKind(from, to),
    attempts: list.length,
    successes: successes.length,
    timeouts: list.filter((p) => p.outcome === 'timeout').length,
    interruptions: list.filter((p) => p.outcome === 'interrupted' || p.outcome === 'invalid').length,
    medianMs: median,
    preliminary: successes.length < PRELIMINARY_BELOW,
    glancesReported: list.filter((p) => glancesPositive(p.declarations.glances)).length,
  };
}

function glancesPositive(g: GlanceDeclaration | null): boolean {
  return !!g && g.kind !== 'unknown' && g.count > 0;
}

/** Directional matrix over the given modes; untested pairs have zero attempts. */
export function switchMatrix(probes: readonly SwitchProbeRecord[], modes: readonly ModeId[]): PairSummary[] {
  const out: PairSummary[] = [];
  for (const from of modes) for (const to of modes) if (from !== to) out.push(summarizePair(probes, from, to));
  return out;
}

/** Suggested readiness for randomized practice: 5 paired successes each way, median < 10 s, no glances. */
export function randomReady(probes: readonly SwitchProbeRecord[], a: ModeId, b: ModeId): boolean {
  const paired = probes.filter((p) => p.stage === 'paired');
  return [summarizePair(paired, a, b), summarizePair(paired, b, a)].every(
    (s) => s.successes >= READINESS_PROBES && s.medianMs !== null && s.medianMs < FAMILIAR_TARGET_MS && s.glancesReported === 0,
  );
}

/**
 * Randomized cue order: uniform over the eligible pool, never repeating the
 * immediately previous mode. The seed and resulting order are stored.
 */
export function randomizedOrder(pool: readonly ModeId[], count: number, seed: number, previous: ModeId | null = null): ModeId[] {
  if (pool.length < 2) throw new Error('Randomized switching needs at least two modes.');
  const rng = createRandom(seed);
  const order: ModeId[] = [];
  let last = previous;
  for (let i = 0; i < count; i += 1) {
    const choices = pool.filter((m) => m !== last);
    const next = choices[Math.floor(rng() * choices.length)] as ModeId;
    order.push(next);
    last = next;
  }
  return order;
}

export interface SwitchingContext {
  readonly acquired: readonly ModeId[];
  readonly started: readonly ModeId[];
  readonly probes: readonly SwitchProbeRecord[];
}

/** Which switching stage fits today, and between which modes. */
export function switchingStage(ctx: SwitchingContext, primary: ModeId): { stage: SwitchStage; pair: [ModeId, ModeId] } | null {
  if (ctx.acquired.length >= 2) {
    const [a, b] = ctx.acquired as [ModeId, ModeId];
    const allReady = ctx.acquired.every((x, i) => ctx.acquired.slice(i + 1).every((y) => randomReady(ctx.probes, x, y)));
    return { stage: allReady ? 'randomized' : 'paired', pair: [a, b] };
  }
  const other = ctx.started.find((m) => m !== primary);
  if (other) return { stage: 'blocked', pair: [primary, other] };
  return null;
}

export const SWITCH_TIMINGS = {
  blockedMinutes: SW.blockedMinutesRange as [number, number],
  resetSeconds: SW.resetSecondsRange as [number, number],
  pairedMinutes: SW.pairedMinutesRange as [number, number],
  randomizedSeconds: SW.randomizedTrialSecondsRange as [number, number],
};
