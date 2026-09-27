// The trial engine applies committed input to a frozen prompt under the strict
// append / tail-Backspace model (docs/measurement.md) and keeps the append-only
// event log that is the canonical trial record. Times are monotonic
// milliseconds since the trial was armed; the engine never reads a clock.
import type { InputMeta, Observation } from '../input/types';
import { type Counters, computeMetrics, type Metrics } from './metrics';

export type TrialKind = 'benchmark' | 'practice';

export type Timing =
  | { readonly mode: 'fixed'; readonly durationMs: number }
  | { readonly mode: 'untimed' };

export interface TrialSpec {
  readonly kind: TrialKind;
  readonly timing: Timing;
  /** Frozen NFC grapheme sequence. */
  readonly target: readonly string[];
}

export type Phase = 'armed' | 'running' | 'paused' | 'ended';
export type EndReason = 'deadline' | 'text-complete' | 'user-ended';
export type TrialStatus = 'completed' | 'interrupted' | 'invalid' | 'aborted';

export type InterruptionReason =
  | 'focus-lost'
  | 'page-hidden'
  | 'page-closed'
  | 'escape'
  | 'setup-mismatch'
  | 'unobservable-interval'
  | 'writer-lost'
  | 'recovered-after-restart'
  /** The other machine stopped a coordinated two-machine run. */
  | 'peer-stopped';

export type InvalidityReason =
  | 'paste'
  | 'drop'
  | 'replacement'
  | 'undo-redo'
  | 'multi-character-insertion'
  | 'unexpected-composition'
  | 'unsupported-edit'
  | 'text-exhausted';

export type CharState = 'correct' | 'corrected' | 'wrong' | 'current' | 'upcoming';

interface EventBase {
  readonly seq: number;
  readonly atMs: number;
}

export type TrialEvent = EventBase &
  (
    | {
        readonly kind: 'insert';
        readonly grapheme: string;
        readonly index: number;
        readonly expected: string | null;
        readonly correct: boolean;
        readonly input: InputMeta;
      }
    | {
        readonly kind: 'delete';
        readonly index: number;
        readonly removed: string;
        readonly removedWasCorrect: boolean;
        readonly input: InputMeta;
      }
    | { readonly kind: 'delete-empty'; readonly input: InputMeta }
    | { readonly kind: 'late'; readonly action: 'insert' | 'delete'; readonly grapheme: string | null; readonly input: InputMeta }
    | { readonly kind: 'early'; readonly action: 'insert' | 'delete'; readonly grapheme: string | null; readonly input: InputMeta }
    | { readonly kind: 'anchor'; readonly startAtMs: number }
    | {
        readonly kind: 'ignored';
        readonly action: 'insert' | 'delete';
        readonly grapheme: string | null;
        readonly reason: 'paused';
        readonly input: InputMeta;
      }
    | { readonly kind: 'pause' }
    | { readonly kind: 'resume' }
    | { readonly kind: 'end'; readonly reason: EndReason }
    | { readonly kind: 'interrupt'; readonly reason: InterruptionReason; readonly detail?: string }
    | { readonly kind: 'invalidate'; readonly reason: InvalidityReason; readonly detail?: string }
    | { readonly kind: 'abort' }
    | { readonly kind: 'observe'; readonly observation: Observation }
  );

export interface EngineCounters extends Counters {
  readonly lateInputs: number;
}

export interface TrialOutcome {
  readonly status: TrialStatus | null;
  readonly endReason: EndReason | null;
  readonly interruption: InterruptionReason | null;
  readonly invalidity: readonly InvalidityReason[];
  readonly startAtMs: number | null;
  readonly endAtMs: number | null;
  readonly activeMs: number | null;
  readonly counters: EngineCounters;
  readonly metrics: Metrics;
}

interface BufferEntry {
  readonly grapheme: string;
  readonly correct: boolean;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewEvent = DistributiveOmit<TrialEvent, 'seq' | 'atMs'>;

export class TrialEngine {
  readonly spec: TrialSpec;
  private phaseValue: Phase = 'armed';
  private start: number | null = null;
  /** Cue-started timing: the clock began at a scheduled start, not at the first key. */
  private anchored = false;
  private end: number | null = null;
  private lastEdit: number | null = null;
  private endReasonValue: EndReason | null = null;
  private interruptionValue: InterruptionReason | null = null;
  private readonly invalidityValue: InvalidityReason[] = [];
  private aborted = false;
  private readonly pauses: { from: number; to: number | null }[] = [];
  private readonly buffer: BufferEntry[] = [];
  private readonly hadError: boolean[] = [];
  private attempts = 0;
  private attemptsCorrect = 0;
  private corrections = 0;
  private emptyBackspaces = 0;
  private lateInputs = 0;
  private readonly log: TrialEvent[] = [];

  constructor(spec: TrialSpec) {
    if (spec.target.length === 0) throw new Error('A trial needs a non-empty prompt.');
    this.spec = spec;
  }

  /** Rebuild an engine from its recorded events (recovery, audit, tests). */
  static replay(spec: TrialSpec, events: readonly TrialEvent[]): TrialEngine {
    const engine = new TrialEngine(spec);
    for (const event of events) engine.apply(event);
    return engine;
  }

  get phase(): Phase {
    return this.phaseValue;
  }

  get events(): readonly TrialEvent[] {
    return this.log;
  }

  get startAtMs(): number | null {
    return this.start;
  }

  get bufferLength(): number {
    return this.buffer.length;
  }

  /** Deadline in armed-relative milliseconds, once the clock has started. */
  get deadlineAtMs(): number | null {
    return this.spec.timing.mode === 'fixed' && this.start !== null ? this.start + this.spec.timing.durationMs : null;
  }

  insert(atMs: number, grapheme: string, input: InputMeta): TrialEvent[] {
    if (this.phaseValue === 'ended') return [];
    if (this.phaseValue === 'paused') {
      return [this.push(atMs, { kind: 'ignored', action: 'insert', grapheme, reason: 'paused', input })];
    }
    if (this.anchored && this.start !== null && atMs < this.start) {
      return [this.push(atMs, { kind: 'early', action: 'insert', grapheme, input })];
    }
    if (this.isLate(atMs)) {
      this.lateInputs += 1;
      return [this.push(atMs, { kind: 'late', action: 'insert', grapheme, input })];
    }
    if (this.phaseValue === 'armed') {
      this.phaseValue = 'running';
      if (!this.anchored) this.start = atMs;
    }
    const index = this.buffer.length;
    const expected = this.spec.target[index] ?? null;
    const correct = expected !== null && grapheme === expected;
    this.buffer.push({ grapheme, correct });
    this.attempts += 1;
    if (correct) this.attemptsCorrect += 1;
    else this.hadError[index] = true;
    this.lastEdit = atMs;
    const events = [this.push(atMs, { kind: 'insert', grapheme, index, expected, correct, input })];
    if (this.buffer.length >= this.spec.target.length) {
      events.push(
        ...(this.spec.timing.mode === 'fixed'
          ? this.invalidate(atMs, 'text-exhausted')
          : this.finish(atMs, 'text-complete')),
      );
    }
    return events;
  }

  deleteBackward(atMs: number, input: InputMeta): TrialEvent[] {
    if (this.phaseValue === 'ended') return [];
    if (this.anchored && this.start !== null && atMs < this.start) {
      return [this.push(atMs, { kind: 'early', action: 'delete', grapheme: null, input })];
    }
    if (this.phaseValue === 'paused') {
      return [this.push(atMs, { kind: 'ignored', action: 'delete', grapheme: null, reason: 'paused', input })];
    }
    if (this.isLate(atMs)) {
      this.lateInputs += 1;
      return [this.push(atMs, { kind: 'late', action: 'delete', grapheme: null, input })];
    }
    const removed = this.buffer.pop();
    if (!removed) {
      this.emptyBackspaces += 1;
      return [this.push(atMs, { kind: 'delete-empty', input })];
    }
    this.corrections += 1;
    if (this.phaseValue === 'running') this.lastEdit = atMs;
    return [
      this.push(atMs, {
        kind: 'delete',
        index: this.buffer.length,
        removed: removed.grapheme,
        removedWasCorrect: removed.correct,
        input,
      }),
    ];
  }

  /** Explicit pause: untimed practice only. */
  pause(atMs: number): TrialEvent[] {
    if (this.phaseValue !== 'running' || this.spec.timing.mode !== 'untimed') return [];
    this.phaseValue = 'paused';
    this.pauses.push({ from: atMs, to: null });
    return [this.push(atMs, { kind: 'pause' })];
  }

  resume(atMs: number): TrialEvent[] {
    if (this.phaseValue !== 'paused') return [];
    this.phaseValue = 'running';
    const open = this.pauses.at(-1);
    if (open) open.to = atMs;
    return [this.push(atMs, { kind: 'resume' })];
  }

  finish(atMs: number, reason: EndReason): TrialEvent[] {
    if (this.phaseValue === 'ended' || this.start === null) return [];
    if (reason === 'deadline') {
      const deadline = this.deadlineAtMs;
      if (deadline === null) return [];
      this.end = deadline;
    } else {
      this.closePause(atMs);
      this.end = atMs;
    }
    this.phaseValue = 'ended';
    this.endReasonValue = reason;
    return [this.push(this.end, { kind: 'end', reason })];
  }

  interrupt(atMs: number, reason: InterruptionReason, detail?: string): TrialEvent[] {
    if (this.phaseValue === 'ended') return [];
    if (this.phaseValue === 'armed' && !(this.anchored && this.start !== null && atMs >= this.start)) return this.abort(atMs);
    this.closePause(atMs);
    this.end = atMs;
    this.phaseValue = 'ended';
    this.interruptionValue = reason;
    return [this.push(atMs, detail === undefined ? { kind: 'interrupt', reason } : { kind: 'interrupt', reason, detail })];
  }

  invalidate(atMs: number, reason: InvalidityReason, detail?: string): TrialEvent[] {
    if (this.phaseValue === 'ended') return [];
    this.closePause(atMs);
    this.invalidityValue.push(reason);
    this.end = atMs;
    this.phaseValue = 'ended';
    return [this.push(atMs, detail === undefined ? { kind: 'invalidate', reason } : { kind: 'invalidate', reason, detail })];
  }

  /**
   * Cue-started timing (two-machine trials and their solo baselines): the
   * fixed interval starts at `startAtMs` whatever the first key does, idle
   * time counts, and input before the start is ignored as early.
   */
  anchorStart(startAtMs: number): TrialEvent[] {
    if (this.phaseValue !== 'armed' || this.anchored || this.spec.timing.mode !== 'fixed') return [];
    this.anchored = true;
    this.start = startAtMs;
    return [this.push(startAtMs, { kind: 'anchor', startAtMs })];
  }

  get isAnchored(): boolean {
    return this.anchored;
  }

  /** Cancel an armed trial before any insertion; no measurement exists. */
  abort(atMs: number): TrialEvent[] {
    if (this.phaseValue !== 'armed') return [];
    this.phaseValue = 'ended';
    this.aborted = true;
    this.end = atMs;
    return [this.push(atMs, { kind: 'abort' })];
  }

  /** Record a non-scoring observation. The log is frozen once the trial ends. */
  observe(atMs: number, observation: Observation): TrialEvent[] {
    if (this.phaseValue === 'ended') return [];
    return [this.push(atMs, { kind: 'observe', observation })];
  }

  charState(index: number): CharState {
    const entry = this.buffer[index];
    if (entry) {
      if (!entry.correct) return 'wrong';
      return this.hadError[index] ? 'corrected' : 'correct';
    }
    return index === this.buffer.length ? 'current' : 'upcoming';
  }

  /** The grapheme typed at a position, for rendering wrong characters. */
  typedAt(index: number): string | null {
    return this.buffer[index]?.grapheme ?? null;
  }

  counters(): EngineCounters {
    let finalCorrect = 0;
    for (const entry of this.buffer) if (entry.correct) finalCorrect += 1;
    return {
      attempts: this.attempts,
      attemptsCorrect: this.attemptsCorrect,
      finalCorrect,
      residualErrors: this.buffer.length - finalCorrect,
      corrections: this.corrections,
      emptyBackspaces: this.emptyBackspaces,
      lateInputs: this.lateInputs,
    };
  }

  /**
   * Active measured time. Fixed trials: exactly the duration when completed,
   * otherwise start to interruption. Untimed practice: first insertion to last
   * edit, excluding explicit pauses. `nowMs` gives a live value while running.
   */
  activeMs(nowMs?: number): number | null {
    if (this.start === null) return null;
    const timing = this.spec.timing;
    if (timing.mode === 'fixed') {
      if (this.endReasonValue === 'deadline') return timing.durationMs;
      const until = this.end ?? nowMs;
      if (until === undefined) return null;
      return Math.min(Math.max(until - this.start, 0), timing.durationMs);
    }
    const until = this.phaseValue === 'ended' || nowMs === undefined ? (this.lastEdit ?? this.start) : nowMs;
    return Math.max(until - this.start - this.pausedBetween(this.start, until), 0);
  }

  outcome(nowMs?: number): TrialOutcome {
    const counters = this.counters();
    const activeMs = this.activeMs(nowMs);
    return {
      status: this.status(),
      endReason: this.endReasonValue,
      interruption: this.interruptionValue,
      invalidity: [...this.invalidityValue],
      startAtMs: this.start,
      endAtMs: this.end,
      activeMs,
      counters,
      metrics: computeMetrics(counters, activeMs),
    };
  }

  status(): TrialStatus | null {
    if (this.phaseValue !== 'ended') return null;
    if (this.aborted) return 'aborted';
    if (this.invalidityValue.length > 0) return 'invalid';
    if (this.interruptionValue !== null) return 'interrupted';
    return 'completed';
  }

  private isLate(atMs: number): boolean {
    const deadline = this.deadlineAtMs;
    return deadline !== null && atMs >= deadline;
  }

  private closePause(atMs: number): void {
    if (this.phaseValue !== 'paused') return;
    const open = this.pauses.at(-1);
    if (open && open.to === null) open.to = atMs;
  }

  private pausedBetween(from: number, to: number): number {
    let total = 0;
    for (const pause of this.pauses) {
      const start = Math.max(pause.from, from);
      const stop = Math.min(pause.to ?? to, to);
      if (stop > start) total += stop - start;
    }
    return total;
  }

  private push(atMs: number, event: NewEvent): TrialEvent {
    const record = { ...event, seq: this.log.length, atMs } as TrialEvent;
    this.log.push(record);
    return record;
  }

  /** Re-apply a recorded event; derived fields are recomputed, not trusted. */
  private apply(event: TrialEvent): void {
    switch (event.kind) {
      case 'insert':
        this.insert(event.atMs, event.grapheme, event.input);
        return;
      case 'anchor':
        this.anchorStart(event.startAtMs);
        return;
      case 'early':
      case 'late':
      case 'ignored':
        if (event.action === 'insert') this.insert(event.atMs, event.grapheme ?? '', event.input);
        else this.deleteBackward(event.atMs, event.input);
        return;
      case 'delete':
      case 'delete-empty':
        this.deleteBackward(event.atMs, event.input);
        return;
      case 'pause':
        this.pause(event.atMs);
        return;
      case 'resume':
        this.resume(event.atMs);
        return;
      case 'end':
        this.finish(event.atMs, event.reason);
        return;
      case 'interrupt':
        this.interrupt(event.atMs, event.reason, event.detail);
        return;
      case 'invalidate':
        this.invalidate(event.atMs, event.reason, event.detail);
        return;
      case 'abort':
        this.abort(event.atMs);
        return;
      case 'observe':
        this.observe(event.atMs, event.observation);
        return;
    }
  }
}
