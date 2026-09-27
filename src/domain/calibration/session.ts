// A calibration run: prompts one step at a time, watches what the OS commits
// for the physical key the user pressed, and compares it with the layout
// table. Pressing a different key is not an error; it is simply not the step.
import type { KeyObservation } from '../input/interpreter';
import type { GeometryDefinition } from '../layouts/geometry';
import { GEOMETRIES } from '../layouts/geometry';
import type { LayoutDefinition } from '../layouts/registry';
import { type CalibrationStep, type Expected, expectedAt, isRequired } from './plan';

export type Observed =
  | { readonly type: 'char'; readonly char: string }
  | { readonly type: 'dead'; readonly thenSpace: string | null }
  | { readonly type: 'none' }
  | { readonly type: 'line-break' }
  | { readonly type: 'deletion' }
  | { readonly type: 'committed'; readonly text: string }
  | { readonly type: 'absent' }
  | { readonly type: 'skipped' };

export type StepOutcome = 'match' | 'mismatch' | 'absent' | 'skipped' | 'info';

export interface StepResult {
  readonly stepId: string;
  readonly step: CalibrationStep;
  readonly observed: Observed;
  readonly outcome: StepOutcome;
}

export type Feedback =
  | { readonly type: 'none' }
  | { readonly type: 'recorded'; readonly result: StepResult }
  | { readonly type: 'wrong-key'; readonly pressed: string }
  | { readonly type: 'hold-shift' }
  | { readonly type: 'release-shift' }
  | { readonly type: 'use-shift'; readonly side: 'left' | 'right' }
  | { readonly type: 'turn-caps-lock-on' }
  | { readonly type: 'turn-caps-lock-off' }
  | { readonly type: 'press-space-after-dead' }
  | { readonly type: 'dead-key-detected' }
  | { readonly type: 'geometry-hint'; readonly code: string };

interface Awaiting {
  readonly code: string;
  readonly shift: boolean;
  readonly incidental: boolean;
  /** Plain position presses feed layout identification; Caps Lock checks do not. */
  readonly store: boolean;
  dead: boolean;
  /** Code of the key that followed a dead key. */
  completer: string | null;
  released: boolean;
}

/** Output a position produced, keyed by "base:KeyF" / "shift:KeyF". */
export type ObservationMap = ReadonlyMap<string, Observed>;

export class CalibrationSession {
  readonly steps: readonly CalibrationStep[];
  private readonly geometry: GeometryDefinition;
  private readonly resultsValue: StepResult[] = [];
  private readonly seen = new Map<string, Observed>();
  private awaiting: Awaiting | null = null;
  private infoKeys: string[] = [];
  private readonly shiftHeld = { left: false, right: false };
  private lastShiftSide: 'left' | 'right' | null = null;

  constructor(steps: readonly CalibrationStep[], geometry: GeometryDefinition) {
    this.steps = steps;
    this.geometry = geometry;
  }

  get current(): CalibrationStep | null {
    return this.steps[this.resultsValue.length] ?? null;
  }

  get results(): readonly StepResult[] {
    return this.resultsValue;
  }

  get done(): boolean {
    return this.current === null;
  }

  /** Every position/layer output observed so far, including incidental presses. */
  get observations(): ObservationMap {
    return this.seen;
  }

  keydown(obs: KeyObservation): Feedback {
    if (obs.key === 'Shift') {
      const side = obs.code === 'ShiftRight' ? 'right' : 'left';
      this.shiftHeld[side] = true;
      this.lastShiftSide = side;
      return { type: 'none' };
    }
    if (['Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'OS'].includes(obs.key)) return { type: 'none' };

    const settled = this.settle();
    if (settled.type === 'recorded' && this.done) return settled;
    const step = this.current;
    if (!step) return { type: 'none' };

    const awaiting = this.awaiting;
    if (awaiting?.dead && !awaiting.completer) {
      awaiting.completer = obs.code;
      return { type: 'none' };
    }

    if (step.kind === 'info') return this.infoKeydown(step, obs);

    const target = this.targetCode(step);
    if (obs.code !== target) {
      this.awaiting = { code: obs.code, shift: obs.shiftKey, incidental: true, store: !obs.capsLock, dead: isDeadLike(obs.key), completer: null, released: false };
      const foreign = Object.values(GEOMETRIES).some((g) => g.distinguishingCodes.includes(obs.code)) && !this.geometry.keys.some((k) => k.code === obs.code);
      return foreign ? { type: 'geometry-hint', code: obs.code } : { type: 'wrong-key', pressed: obs.code };
    }

    if (step.kind === 'caps-lock') {
      if (!obs.capsLock) return { type: 'turn-caps-lock-on' };
      if (obs.shiftKey) return { type: 'release-shift' };
    } else {
      if (obs.capsLock && step.kind === 'position') return { type: 'turn-caps-lock-off' };
      if (step.kind === 'position') {
        if (step.layer === 'shift' && !obs.shiftKey) return { type: 'hold-shift' };
        if (step.layer === 'base' && obs.shiftKey) return { type: 'release-shift' };
      }
      if (step.kind === 'shift-side') {
        const held = this.shiftHeld[step.side] || (obs.shiftKey && this.lastShiftSide === step.side);
        if (!held) return { type: 'use-shift', side: step.side };
      }
    }
    this.awaiting = {
      code: obs.code,
      shift: obs.shiftKey,
      incidental: false,
      store: step.kind === 'position',
      dead: isDeadLike(obs.key),
      completer: null,
      released: false,
    };
    return isDeadLike(obs.key) ? { type: 'dead-key-detected' } : { type: 'none' };
  }

  /** A committed edit: beforeinput data, or text a composition appended. */
  input(inputType: string, data: string | null): Feedback {
    const step = this.current;
    if (step?.kind === 'info' && this.infoKeys.length > 0) {
      if (this.infoKeys.length >= step.keys.length) return this.record(step, { type: 'committed', text: data ?? '' });
      return { type: 'none' };
    }
    const awaiting = this.awaiting;
    if (!awaiting) return { type: 'none' };
    // Some browsers end a dead-key composition with an empty commit and deliver
    // the character in a later insertText; keep waiting for it (settle() still
    // records a truly discarded sequence after the key is released).
    if (awaiting.dead && (data ?? '') === '' && inputType === 'insertText') return { type: 'none' };
    this.awaiting = null;
    let observed: Observed;
    if (awaiting.dead) {
      if (awaiting.completer !== 'Space') {
        return awaiting.incidental ? { type: 'none' } : { type: 'press-space-after-dead' };
      }
      observed = { type: 'dead', thenSpace: data ?? '' };
    } else if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
      observed = { type: 'line-break' };
    } else if (inputType === 'deleteContentBackward') {
      observed = { type: 'deletion' };
    } else {
      observed = { type: 'char', char: data ?? '' };
    }
    return this.observe(awaiting, observed);
  }

  keyup(obs: KeyObservation): Feedback {
    if (obs.key === 'Shift') {
      this.shiftHeld[obs.code === 'ShiftRight' ? 'right' : 'left'] = false;
      return { type: 'none' };
    }
    const awaiting = this.awaiting;
    if (awaiting && !awaiting.dead && awaiting.code === obs.code) awaiting.released = true;
    if (awaiting?.dead && awaiting.completer === obs.code) awaiting.released = true;
    return { type: 'none' };
  }

  /**
   * Finish a key that was pressed and released without committing anything.
   * Call shortly after keyup (input methods may commit asynchronously).
   */
  settle(): Feedback {
    const step = this.current;
    if (step?.kind === 'info' && this.infoKeys.length >= step.keys.length) {
      return this.record(step, { type: 'committed', text: '' });
    }
    const awaiting = this.awaiting;
    if (!awaiting?.released) return { type: 'none' };
    this.awaiting = null;
    if (awaiting.dead) {
      // Only Space completes a dead key for calibration; anything else re-prompts.
      if (awaiting.completer !== 'Space') return awaiting.incidental ? { type: 'none' } : { type: 'press-space-after-dead' };
      return this.observe(awaiting, { type: 'dead', thenSpace: '' });
    }
    return this.observe(awaiting, { type: 'none' });
  }

  /** The user reports that a geometry-specific key does not exist on the keyboard. */
  markAbsent(): Feedback {
    const step = this.current;
    if (step?.kind !== 'position' || !step.geometrySpecific) return { type: 'none' };
    return this.record(step, { type: 'absent' });
  }

  skip(): Feedback {
    const step = this.current;
    if (!step) return { type: 'none' };
    return this.record(step, { type: 'skipped' });
  }

  private infoKeydown(step: Extract<CalibrationStep, { kind: 'info' }>, obs: KeyObservation): Feedback {
    const expected = step.keys[this.infoKeys.length];
    if (!expected || obs.code !== expected.code) {
      this.infoKeys = [];
      return { type: 'wrong-key', pressed: obs.code };
    }
    if (expected.altGraph && !obs.altGraph) return { type: 'none' };
    this.infoKeys.push(obs.code);
    if (step.prompt === 'dead-then-letter' && this.infoKeys.length === 1 && obs.key !== 'Dead') {
      // The first key did not act as a dead key; record what it committed.
      this.infoKeys.push('(not dead)');
    }
    return { type: 'none' };
  }

  private targetCode(step: CalibrationStep): string {
    switch (step.kind) {
      case 'position':
      case 'shift-side':
      case 'caps-lock':
        return step.code;
      case 'space':
        return 'Space';
      case 'enter':
        return 'Enter';
      case 'backspace':
        return 'Backspace';
      case 'info':
        return step.keys[0]?.code ?? '';
    }
  }

  private observe(awaiting: Awaiting, observed: Observed): Feedback {
    const layer = awaiting.shift ? 'shift' : 'base';
    if (awaiting.store && observed.type !== 'deletion' && observed.type !== 'line-break') {
      this.seen.set(`${layer}:${awaiting.code}`, observed);
    }
    const step = this.current;
    if (awaiting.incidental || !step) return { type: 'none' };
    return this.record(step, observed);
  }

  private record(step: CalibrationStep, observed: Observed): Feedback {
    this.awaiting = null;
    this.infoKeys = [];
    const result: StepResult = { stepId: step.id, step, observed, outcome: evaluate(step, observed) };
    this.resultsValue.push(result);
    return { type: 'recorded', result };
  }
}

/**
 * Dead keys are reported as "Dead", or as "Process" when an input method
 * handles them (Chromium with a GTK input method on X11).
 */
function isDeadLike(key: string): boolean {
  return key === 'Dead' || key === 'Process';
}

export function evaluate(step: CalibrationStep, observed: Observed): StepOutcome {
  if (observed.type === 'skipped') return 'skipped';
  if (observed.type === 'absent') return 'absent';
  switch (step.kind) {
    case 'info':
      return 'info';
    case 'position':
      return matchesExpected(step.expected, observed) ? 'match' : 'mismatch';
    case 'space':
      return observed.type === 'char' && observed.char === ' ' ? 'match' : 'mismatch';
    case 'enter':
      return observed.type === 'line-break' || (observed.type === 'char' && observed.char === '\n') ? 'match' : 'mismatch';
    case 'backspace':
      return observed.type === 'deletion' ? 'match' : 'mismatch';
    case 'shift-side':
    case 'caps-lock':
      return observed.type === 'char' && observed.char === step.expected ? 'match' : 'mismatch';
  }
}

function matchesExpected(expected: Expected, observed: Observed): boolean {
  switch (expected.type) {
    case 'char':
      return observed.type === 'char' && observed.char === expected.char;
    case 'dead':
      return observed.type === 'dead' && observed.thenSpace === expected.thenSpace;
    case 'none':
      return observed.type === 'none';
  }
}

export type CalibrationStatus = 'passed' | 'failed' | 'incomplete';

export interface CalibrationSummary {
  readonly status: CalibrationStatus;
  readonly checked: number;
  readonly matched: number;
  readonly mismatches: readonly StepResult[];
  readonly absent: readonly string[];
  readonly skipped: number;
}

export function summarize(steps: readonly CalibrationStep[], results: readonly StepResult[]): CalibrationSummary {
  const required = results.filter((r) => isRequired(r.step));
  const mismatches = required.filter((r) => r.outcome === 'mismatch');
  const absent = required.filter((r) => r.outcome === 'absent').map((r) => (r.step.kind === 'position' ? r.step.code : r.stepId));
  const skipped = required.filter((r) => r.outcome === 'skipped').length;
  const allRequiredDone = steps.filter(isRequired).every((s) => results.some((r) => r.stepId === s.id));
  let status: CalibrationStatus = 'passed';
  if (mismatches.length > 0) status = 'failed';
  else if (!allRequiredDone || skipped > 0 || absent.length > 0) status = 'incomplete';
  return {
    status,
    checked: required.length,
    matched: required.filter((r) => r.outcome === 'match').length,
    mismatches,
    absent,
    skipped,
  };
}

export interface LayoutMatch {
  readonly layoutId: string;
  readonly agreements: number;
  readonly comparisons: number;
}

/** Rank candidate layouts by how many observed position outputs they explain. */
export function identifyLayout(
  observations: ObservationMap,
  candidates: readonly LayoutDefinition[],
): LayoutMatch[] {
  return candidates
    .map((layout) => {
      let agreements = 0;
      let comparisons = 0;
      for (const [key, observed] of observations) {
        const [layer, code] = key.split(':') as ['base' | 'shift', string];
        if (!layout.keys[code] || observed.type === 'absent' || observed.type === 'skipped') continue;
        comparisons += 1;
        if (matchesExpected(expectedAt(layout, code, layer), observed)) agreements += 1;
      }
      return { layoutId: layout.id, agreements, comparisons };
    })
    .sort((a, b) => b.agreements - a.agreements);
}
