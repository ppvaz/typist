// Runs one trial against a real, focused textarea (docs/input-and-layouts.md,
// "Event pipeline"; docs/architecture.md, state transitions).
//
// * keydown/keyup give position and modifiers; committed text is scored.
// * Times are event timestamps relative to arming, on the page's monotonic clock.
// * A benchmark is interrupted by blur, hidden page, page close or an
//   unobservable interval; untimed practice pauses instead.
// * The journal is appended at least once per second; the final record and
//   its derived updates are committed in one transaction. "Saved" appears
//   only after that commit.
import { HalfQwertyInterpreter } from '../../domain/input/halfQwerty';
import { InputInterpreter, type InterpretedAction, type KeyObservation } from '../../domain/input/interpreter';
import type { AssistanceLevel } from '../../domain/input/types';
import type { LayoutDefinition } from '../../domain/layouts/registry';
import type { AssistanceRecord, EventChunk, TrialRecord } from '../../domain/records';
import { type InterruptionReason, type TrialEvent, TrialEngine, type TrialOutcome } from '../../domain/scoring/engine';
import { toGraphemes } from '../../domain/text/graphemes';
import { finalizedTrial, liveTrial, runningTrial, type TrialContext } from '../../domain/trial-record';
import type { Repository, TrialCommit } from '../../storage/repo';

export const JOURNAL_INTERVAL_MS = 1000;
/**
 * The field always holds one zero-width character with the caret after it:
 * browsers may not fire beforeinput for Backspace in an empty field, and every
 * other edit is prevented, so this keeps corrections observable.
 */
export const SENTINEL = '\u200b';

export function resetSurface(textarea: HTMLTextAreaElement): void {
  textarea.value = SENTINEL;
  textarea.setSelectionRange(1, 1);
}

export function committedText(textarea: HTMLTextAreaElement): string {
  return textarea.value.replace(/^\u200b/, '');
}
/** Pending events stamped before the deadline may still be delivered briefly after it. */
const DEADLINE_GRACE_MS = 120;
/** A gap this long between one-second heartbeats means the page was not observable. */
const HEARTBEAT_GAP_MS = 4000;

export type SavePhase = 'unsaved' | 'saving' | 'saved' | 'failed';

export interface TrialView {
  readonly version: number;
  readonly phase: TrialEngine['phase'];
  readonly outcome: TrialOutcome;
  readonly remainingMs: number | null;
  readonly bufferLength: number;
  readonly assistance: AssistanceLevel;
  readonly notice: string | null;
  readonly mappingAlert: boolean;
  readonly autoPaused: boolean;
  readonly save: SavePhase;
  readonly saveError: string | null;
  readonly record: TrialRecord;
}

export interface TrialRunOptions {
  readonly context: TrialContext;
  readonly layout: LayoutDefinition;
  readonly repo: Repository;
  /** Records written atomically with the final trial (set, session, milestones…). */
  readonly commitExtras?: (final: TrialRecord) => Omit<TrialCommit, 'trial' | 'chunk'>;
  readonly onEnded?: (final: TrialRecord, controller: TrialController) => void;
  readonly onSaved?: (final: TrialRecord) => void;
}

type Listener = () => void;

export class TrialController {
  readonly options: TrialRunOptions;
  readonly engine: TrialEngine;
  readonly interpreter: InputInterpreter | HalfQwertyInterpreter;
  readonly reference: boolean;
  readonly fixed: boolean;
  private record: TrialRecord;
  private armedAt = 0;
  private readonly listeners = new Set<Listener>();
  private version = 0;
  private frame: number | null = null;
  private notice: string | null = null;
  private mappingAlert = false;
  private autoPaused = false;
  private assistance: AssistanceRecord;
  private flushedEvents = 0;
  private chunkIndex = 0;
  private journal: Promise<void> = Promise.resolve();
  private journalTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBeat = { mono: 0, wall: 0 };
  private textarea: HTMLTextAreaElement | null = null;
  private save: SavePhase = 'unsaved';
  private saveError: string | null = null;
  private finalRecord: TrialRecord | null = null;
  private ended = false;
  private detachFns: (() => void)[] = [];

  private constructor(options: TrialRunOptions) {
    this.options = options;
    const protocol = options.context.protocol;
    this.reference = protocol.reference;
    this.fixed = protocol.timing.mode === 'fixed';
    this.engine = new TrialEngine({
      kind: options.context.kind === 'benchmark' ? 'benchmark' : 'practice',
      timing: protocol.timing,
      target: toGraphemes(options.context.exercise.text),
    });
    // The emulated Half-QWERTY path builds characters from physical keys; the
    // native path scores what the OS committed.
    this.interpreter =
      options.context.inputPath === 'emulated'
        ? new HalfQwertyInterpreter({ hand: options.context.mode.endsWith('L') ? 'left' : 'right', layout: options.layout, reference: this.reference, tapMaxMs: null })
        : new InputInterpreter(options.layout, { reference: this.reference });
    this.assistance = options.context.assistance;
    this.record = runningTrial(options.context);
    this.view = this.buildView();
  }

  /** Persist the running record and frozen prompt, then arm the trial. */
  static async start(options: TrialRunOptions): Promise<TrialController> {
    const controller = new TrialController(options);
    await options.repo.beginTrial(controller.record, options.context.exercise);
    controller.arm();
    return controller;
  }

  private arm(): void {
    this.armedAt = performance.now();
    this.lastBeat = { mono: performance.now(), wall: Date.now() };
    this.journalTimer = setInterval(() => this.flushJournal(), JOURNAL_INTERVAL_MS);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 1000);
  }

  // ---------------------------------------------------------------- viewing

  /** Bound: passed directly to useSyncExternalStore. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): TrialView => this.view;

  private view: TrialView;

  private buildView(): TrialView {
    const now = this.now();
    const outcome = this.engine.outcome(now);
    const deadline = this.engine.deadlineAtMs;
    return {
      version: this.version,
      phase: this.engine.phase,
      outcome,
      remainingMs: this.fixed ? (deadline === null ? (this.options.context.protocol.timing as { durationMs: number }).durationMs : Math.max(0, deadline - now)) : null,
      bufferLength: this.engine.bufferLength,
      assistance: this.currentAssistance(),
      notice: this.notice,
      mappingAlert: this.mappingAlert,
      autoPaused: this.autoPaused,
      save: this.save,
      saveError: this.saveError,
      record: this.finalRecord ?? this.record,
    };
  }

  private currentAssistance(): AssistanceLevel {
    return this.assistance.shown.at(-1) ?? this.assistance.initial;
  }

  /** Coalesce display updates to one per frame; scoring never waits for paint. */
  private changed(immediate = false): void {
    this.version += 1;
    if (immediate || typeof requestAnimationFrame !== 'function') {
      this.view = this.buildView();
      for (const l of this.listeners) l();
      return;
    }
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.view = this.buildView();
      for (const l of this.listeners) l();
    });
  }

  /**
   * Cue-started timing: the fixed interval begins at `perfMs` (performance.now
   * scale) whatever the first key does. Used by two-machine runs, whose start
   * is scheduled by the coordinator, and by their matched solo baselines.
   */
  anchorAt(perfMs: number): void {
    if (this.engine.anchorStart(perfMs - this.armedAt).length > 0) {
      this.scheduleDeadline();
      this.changed(true);
    }
  }

  /** Milliseconds since arming, on the page's monotonic clock. */
  relativeNow(): number {
    return this.now();
  }

  /** Refresh time-dependent values (remaining time) without a state change. */
  tick(): void {
    if (!this.ended) this.changed();
  }

  private now(): number {
    return performance.now() - this.armedAt;
  }

  private rel(timeStamp: number): number {
    // Event.timeStamp shares performance.now()'s origin in current browsers.
    return timeStamp > 0 ? timeStamp - this.armedAt : this.now();
  }

  // ------------------------------------------------------------ DOM wiring

  attach(textarea: HTMLTextAreaElement): () => void {
    this.textarea = textarea;
    resetSurface(textarea);
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      textarea.addEventListener(type, fn as EventListener);
      this.detachFns.push(() => textarea.removeEventListener(type, fn as EventListener));
    };
    on('keydown', (e) => this.onKeyDown(e));
    on('keyup', (e) => this.onKeyUp(e));
    on('beforeinput', (e) => this.onBeforeInput(e));
    on('compositionstart', () => this.onCompositionStart());
    on('compositionend', (e) => this.onCompositionEnd(e));
    on('blur', (e) => this.onBlur(e));
    on('focus', (e) => this.onFocus(e));
    on('paste', (e) => e.preventDefault());
    on('drop', (e) => e.preventDefault());
    // Keep the caret at the tail: pointer selection must not create arbitrary edits.
    const tail = () => {
      if (!this.interpreter.isComposing && (textarea.selectionStart !== textarea.value.length || textarea.selectionEnd !== textarea.value.length)) {
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    };
    on('select', tail);
    on('mouseup', tail);
    const visibility = () => this.onVisibility();
    const pagehide = () => this.onPageHide();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    this.detachFns.push(() => document.removeEventListener('visibilitychange', visibility));
    this.detachFns.push(() => window.removeEventListener('pagehide', pagehide));
    return () => this.detach();
  }

  detach(): void {
    for (const fn of this.detachFns.splice(0)) fn();
    this.textarea = null;
  }

  private observation(e: KeyboardEvent): KeyObservation {
    return {
      t: this.rel(e.timeStamp),
      code: e.code,
      key: e.key,
      shiftKey: e.shiftKey,
      altGraph: e.getModifierState?.('AltGraph') ?? false,
      capsLock: e.getModifierState?.('CapsLock') ?? false,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      repeat: e.repeat,
      isComposing: e.isComposing || e.keyCode === 229,
    };
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.ended) return;
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.escape(this.rel(e.timeStamp));
      return;
    }
    if (this.engine.phase === 'paused' && this.autoPaused && !['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) this.resume(this.rel(e.timeStamp));
    const decision = this.interpreter.keydown(this.observation(e));
    if (decision.preventDefault) e.preventDefault();
    this.apply(decision.actions);
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (this.ended) return;
    this.apply(this.interpreter.keyup(this.observation(e)));
  }

  private onBeforeInput(e: InputEvent): void {
    if (this.ended) {
      e.preventDefault();
      return;
    }
    const decision = this.interpreter.beforeInput({ t: this.rel(e.timeStamp), inputType: e.inputType, data: e.data, isComposing: e.isComposing });
    if (decision.preventDefault && e.cancelable) e.preventDefault();
    this.apply(decision.actions);
  }

  private onCompositionStart(): void {
    if (this.ended) return;
    this.interpreter.compositionStart();
  }

  private onCompositionEnd(e: CompositionEvent): void {
    if (this.ended) return;
    const t = this.rel(e.timeStamp);
    // The field is empty outside compositions, so its content is the commit.
    // Firefox may deliver the final input event after compositionend.
    setTimeout(() => {
      const committed = this.textarea ? committedText(this.textarea) : (e.data ?? '');
      if (this.textarea) resetSurface(this.textarea);
      if (!this.ended) this.apply(this.interpreter.compositionEnd(t, committed));
    }, 0);
  }

  private onBlur(e: FocusEvent): void {
    if (this.ended) return;
    const t = this.rel(e.timeStamp);
    this.interpreter.reset();
    this.engine.observe(t, { type: 'focus', state: 'lost' });
    if (this.inInterval(t)) {
      if (this.reference || this.fixed) this.interrupt(t, 'focus-lost');
      else this.autoPause(t, 'Paused while the typing area was not focused. Type to resume.');
    }
    this.changed();
  }

  private onFocus(e: FocusEvent): void {
    if (this.textarea && !this.interpreter.isComposing) resetSurface(this.textarea);
    if (this.ended) return;
    this.engine.observe(this.rel(e.timeStamp), { type: 'focus', state: 'regained' });
  }

  private onVisibility(): void {
    if (this.ended) return;
    const t = this.now();
    const hidden = document.visibilityState === 'hidden';
    this.engine.observe(t, { type: 'visibility', state: hidden ? 'hidden' : 'visible' });
    if (hidden && this.inInterval(t)) {
      if (this.reference || this.fixed) this.interrupt(t, 'page-hidden');
      else this.autoPause(t, 'Paused while the page was hidden. Type to resume.');
    }
    if (hidden) void this.flushJournal();
  }

  private onPageHide(): void {
    if (this.ended) return;
    const t = this.now();
    if (this.engine.phase === 'running' || this.engine.phase === 'paused') this.interrupt(t, 'page-closed');
    else void this.flushJournal();
  }

  private heartbeat(): void {
    if (this.ended) return;
    const mono = performance.now();
    const wall = Date.now();
    const gapMono = mono - this.lastBeat.mono;
    const gapWall = wall - this.lastBeat.wall;
    this.lastBeat = { mono, wall };
    if (Math.max(gapMono, gapWall) > HEARTBEAT_GAP_MS) {
      const t = this.now();
      this.engine.observe(t, { type: 'heartbeat-gap', gapMs: Math.round(gapMono), wallGapMs: Math.round(gapWall) });
      if (this.inInterval(t)) {
        if (this.reference || this.fixed) this.interrupt(t, 'unobservable-interval');
        else this.autoPause(t, 'Paused after a gap the page could not observe (sleep or a frozen tab).');
      }
    }
    this.changed();
  }

  // --------------------------------------------------------------- actions

  private apply(actions: readonly InterpretedAction[]): void {
    let touched = false;
    for (const action of actions) {
      switch (action.type) {
        case 'insert': {
          const wasArmed = this.engine.phase === 'armed';
          this.engine.insert(action.t, action.grapheme, action.input);
          if (wasArmed && this.engine.phase !== 'armed') this.scheduleDeadline();
          break;
        }
        case 'delete':
          this.engine.deleteBackward(action.t, action.input);
          break;
        case 'observe':
          this.engine.observe(action.t, action.observation);
          if (action.observation.type === 'rejected-edit') {
            this.notice =
              action.observation.inputType.includes('Paste') || action.observation.inputType.includes('Drop')
                ? this.reference
                  ? 'Pasted text was refused, and this trial is invalid: pasting is never a reference result.'
                  : 'Pasted text was refused.'
                : action.observation.reason === 'editing-policy'
                  ? 'Only Backspace at the end of the text is supported here.'
                  : `That edit (${action.observation.inputType}) is not supported and was refused.`;
          }
          break;
        case 'invalidate':
          this.engine.invalidate(action.t, action.reason, action.detail);
          break;
        case 'mapping-alert':
          this.mappingAlert = true;
          this.notice = 'Three characters disagreed with the configured map. This looks like the OS layout, not you. Recalibrate before measuring.';
          if (this.reference) this.engine.interrupt(action.t, 'setup-mismatch', 'three consecutive mapping disagreements');
          else if (this.engine.phase === 'running') this.autoPause(action.t, this.notice);
          break;
      }
      touched = true;
    }
    if (touched) {
      this.changed();
      if (this.engine.phase === 'ended') void this.end();
    }
  }

  private scheduleDeadline(): void {
    const deadline = this.engine.deadlineAtMs;
    if (deadline === null) return;
    const delay = Math.max(0, deadline - this.now());
    this.deadlineTimer = setTimeout(() => {
      // Late events are rejected by timestamp inside the engine; the grace
      // only lets already-stamped earlier events arrive.
      this.deadlineTimer = setTimeout(() => {
        if (this.engine.phase === 'running' || (this.engine.isAnchored && this.engine.phase === 'armed')) {
          this.engine.finish(this.now(), 'deadline');
          this.changed(true);
          void this.end();
        }
      }, DEADLINE_GRACE_MS);
      this.changed();
    }, delay);
  }

  /** Running, or inside an anchored interval that has begun without input yet. */
  private inInterval(t: number): boolean {
    if (this.engine.phase === 'running') return true;
    const start = this.engine.startAtMs;
    return this.engine.isAnchored && this.engine.phase === 'armed' && start !== null && t >= start;
  }

  private autoPause(t: number, message: string): void {
    if (this.engine.pause(t).length > 0) {
      this.autoPaused = true;
      this.notice = message;
    }
  }

  pause(): void {
    if (this.engine.pause(this.now()).length > 0) {
      this.autoPaused = false;
      this.notice = 'Paused. Resume when ready; paused time is not counted.';
      this.changed(true);
    }
  }

  resume(at = this.now()): void {
    if (this.engine.resume(at).length > 0) {
      this.autoPaused = false;
      this.notice = null;
      this.changed(true);
    }
  }

  /** Escape: ends practice; interrupts (or cancels, before input) a benchmark. */
  escape(at = this.now()): void {
    // Before input a trial is cancelled, unless an anchored interval has already begun.
    if (this.engine.phase === 'armed' && !this.inInterval(at)) this.engine.abort(at);
    else if (this.reference || this.fixed) this.engine.interrupt(at, 'escape');
    else this.engine.finish(at, 'user-ended');
    this.changed(true);
    void this.end();
  }

  /** The user ends the block or trial from a button. */
  endByUser(): void {
    this.escape();
  }

  /** Interrupt from outside (writer lease lost, navigation). */
  interrupt(at: number, reason: InterruptionReason): void {
    // The engine cancels an unstarted trial and interrupts a begun (or anchored) one.
    this.engine.interrupt(at, reason);
    this.changed(true);
    void this.end();
  }

  externalInterrupt(reason: InterruptionReason): void {
    if (!this.ended) this.interrupt(this.now(), reason);
  }

  setAssistance(level: AssistanceLevel): void {
    const previous = this.currentAssistance();
    if (previous === level) return;
    const started = this.engine.phase !== 'armed';
    this.assistance = {
      ...this.assistance,
      shown: [...this.assistance.shown, level],
      revealed: this.assistance.revealed || (level !== 'none' && (started || this.assistance.initial === 'none')),
    };
    this.engine.observe(this.now(), { type: 'assistance', level, previous });
    this.changed(true);
  }

  dismissNotice(): void {
    this.notice = null;
    this.changed();
  }

  // --------------------------------------------------------- persistence

  private flushJournal(): Promise<void> {
    const events = this.engine.events;
    if (events.length === this.flushedEvents || this.ended) return this.journal;
    const batch = events.slice(this.flushedEvents);
    this.flushedEvents = events.length;
    const chunk: EventChunk = { trialId: this.record.id, chunk: this.chunkIndex, events: batch };
    this.chunkIndex += 1;
    const live = liveTrial(this.record, this.engine, this.now());
    this.journal = this.journal
      .then(() => this.options.repo.appendChunk(chunk, live))
      .catch((error: unknown) => {
        this.saveError = error instanceof Error ? error.message : String(error);
        this.save = 'failed';
        this.changed();
      });
    return this.journal;
  }

  private stopTimers(): void {
    if (this.journalTimer) clearInterval(this.journalTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.journalTimer = null;
    this.heartbeatTimer = null;
    this.deadlineTimer = null;
  }

  private async end(): Promise<void> {
    if (this.ended || this.engine.phase !== 'ended') return;
    this.ended = true;
    this.stopTimers();
    const outcome = this.engine.outcome();
    const final = finalizedTrial(this.record, outcome, new Date().toISOString(), this.assistance, this.engine.events.length, this.engine.events);
    this.finalRecord = final;
    this.changed(true);
    this.options.onEnded?.(final, this);
    await this.persistFinal();
  }

  /** Commit the final record; safe to call again after a failure (retry). */
  async persistFinal(): Promise<boolean> {
    const final = this.finalRecord;
    if (!final) return false;
    await this.journal.catch(() => undefined);
    const events = this.engine.events;
    const chunk: EventChunk | null = events.length > this.flushedEvents ? { trialId: final.id, chunk: this.chunkIndex, events: events.slice(this.flushedEvents) } : null;
    this.save = 'saving';
    this.saveError = null;
    this.changed(true);
    try {
      const extras = this.options.commitExtras?.(final) ?? {};
      await this.options.repo.commitTrial({ ...extras, trial: final, chunk });
      if (chunk) {
        this.flushedEvents = events.length;
        this.chunkIndex += 1;
      }
      this.save = 'saved';
      this.changed(true);
      this.options.onSaved?.(final);
      return true;
    } catch (error) {
      this.save = 'failed';
      this.saveError = error instanceof Error ? error.message : String(error);
      this.changed(true);
      return false;
    }
  }

  /** Everything needed to rebuild this trial if it could not be saved. */
  recoveryPayload(): { trial: TrialRecord; events: readonly TrialEvent[]; exercise: TrialContext['exercise'] } {
    return { trial: this.finalRecord ?? liveTrial(this.record, this.engine, this.now()), events: this.engine.events, exercise: this.options.context.exercise };
  }

  get finished(): TrialRecord | null {
    return this.finalRecord;
  }

  dispose(): void {
    this.stopTimers();
    this.detach();
    if (this.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.listeners.clear();
  }
}
