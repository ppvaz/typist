import { describe, expect, it } from 'vitest';
import type { InputMeta } from '../../src/domain/input/types';
import { TrialEngine, type TrialSpec } from '../../src/domain/scoring/engine';
import { computeMetrics, formatAccuracy, formatWpm } from '../../src/domain/scoring/metrics';
import { accuracyMeets, formatRatio, parseDecimal, wpmMeets } from '../../src/domain/scoring/rational';
import { toGraphemes } from '../../src/domain/text/graphemes';

const KEY: InputMeta = { path: 'key', inputType: 'insertText', code: null, key: null };
const BACKSPACE: InputMeta = { path: 'backspace', inputType: 'deleteContentBackward', code: null, key: null };

function fixed(target: string): TrialSpec {
  return { kind: 'benchmark', timing: { mode: 'fixed', durationMs: 60_000 }, target: toGraphemes(target) };
}

function untimed(target: string): TrialSpec {
  return { kind: 'practice', timing: { mode: 'untimed' }, target: toGraphemes(target) };
}

/** Type a script: characters insert, "⌫" deletes; one event every `stepMs`. */
function type(engine: TrialEngine, script: string, startMs = 1000, stepMs = 100): number {
  let t = startMs;
  for (const g of toGraphemes(script)) {
    if (g === '⌫') engine.deleteBackward(t, BACKSPACE);
    else engine.insert(t, g, KEY);
    t += stepMs;
  }
  return t;
}

describe('measurement worked examples (docs/measurement.md)', () => {
  it('60 s, A=200, C_attempt=196, C_final=190 gives WPM 38, raw 40, accuracy 98%', () => {
    const engine = new TrialEngine(fixed('x'.repeat(600)));
    let t = 0;
    for (let i = 0; i < 196; i += 1) engine.insert((t += 50), 'x', KEY);
    for (let i = 0; i < 6; i += 1) engine.deleteBackward((t += 50), BACKSPACE);
    for (let i = 0; i < 4; i += 1) engine.insert((t += 50), 'y', KEY);
    engine.finish(90_000, 'deadline');
    const outcome = engine.outcome();
    expect(outcome.status).toBe('completed');
    expect(outcome.activeMs).toBe(60_000);
    expect(outcome.counters).toMatchObject({ attempts: 200, attemptsCorrect: 196, finalCorrect: 190, residualErrors: 4 });
    expect(outcome.metrics.wpm).toBe(38);
    expect(outcome.metrics.rawWpm).toBe(40);
    expect(outcome.metrics.accuracy).toBe(98);
  });

  it('target "cat", events c x ⌫ a t, T=60: A=4, C_attempt=3, C_final=3, WPM 0.6, raw 0.8, accuracy 75%, one correction', () => {
    const engine = new TrialEngine(fixed('cat and a long enough tail of text'));
    type(engine, 'cx⌫at');
    engine.finish(70_000, 'deadline');
    const { counters, metrics, status } = engine.outcome();
    expect(status).toBe('completed');
    expect(counters).toMatchObject({ attempts: 4, attemptsCorrect: 3, finalCorrect: 3, corrections: 1, residualErrors: 0 });
    expect(metrics.wpm).toBeCloseTo(0.6, 12);
    expect(metrics.rawWpm).toBeCloseTo(0.8, 12);
    expect(metrics.accuracy).toBe(75);
    expect(formatWpm(counters.finalCorrect, 60_000)).toBe('0.6');
  });

  it('A04: typing c, x, Backspace, a, t against exactly "cat" is 75% attempt accuracy, not 100%', () => {
    const engine = new TrialEngine(untimed('cat'));
    type(engine, 'cx⌫at');
    const outcome = engine.outcome();
    expect(outcome.status).toBe('completed');
    expect(outcome.endReason).toBe('text-complete');
    expect(outcome.metrics.accuracy).toBe(75);
    expect(formatAccuracy(outcome.counters.attemptsCorrect, outcome.counters.attempts)).toBe('75.00');
  });

  it('target "abc…", events a a: A=2, C_attempt=1, C_final=1, WPM 0.2, accuracy 50%, one residual error', () => {
    const engine = new TrialEngine(fixed('abc and more'));
    type(engine, 'aa');
    engine.finish(61_500, 'deadline');
    const { counters, metrics } = engine.outcome();
    expect(counters).toMatchObject({ attempts: 2, attemptsCorrect: 1, finalCorrect: 1, residualErrors: 1 });
    expect(metrics.wpm).toBeCloseTo(0.2, 12);
    expect(metrics.accuracy).toBe(50);
  });

  it('repeatedly typing and deleting "a" and ending empty scores WPM 0 whatever the raw WPM', () => {
    const engine = new TrialEngine(fixed('a and more text'));
    let t = 0;
    for (let i = 0; i < 40; i += 1) {
      engine.insert((t += 100), 'a', KEY);
      engine.deleteBackward((t += 100), BACKSPACE);
    }
    engine.finish(60_000, 'deadline');
    const { counters, metrics } = engine.outcome();
    expect(counters.finalCorrect).toBe(0);
    expect(metrics.wpm).toBe(0);
    expect(metrics.rawWpm).toBe(8);
    expect(counters.corrections).toBe(40);
  });

  it('97.995% displays as 98.00% yet fails a 98% gate because gates use the unrounded value', () => {
    expect(formatAccuracy(19_599, 20_000)).toBe('98.00');
    expect(accuracyMeets(19_599, 20_000, 98)).toBe(false);
    expect(accuracyMeets(19_600, 20_000, 98)).toBe(true);
  });
});

describe('null and zero semantics', () => {
  it('reports null WPM and accuracy before any insertion, never 100% for no work', () => {
    const engine = new TrialEngine(fixed('abc'));
    expect(engine.outcome().metrics).toEqual({ wpm: null, rawWpm: null, accuracy: null });
    engine.deleteBackward(10, BACKSPACE);
    expect(engine.outcome().metrics.accuracy).toBeNull();
    expect(engine.outcome().counters.emptyBackspaces).toBe(1);
    expect(engine.phase).toBe('armed');
  });

  it('counts wrong first insertions: they start the clock like any other', () => {
    const engine = new TrialEngine(fixed('abc and more'));
    engine.insert(2500, 'z', KEY);
    expect(engine.startAtMs).toBe(2500);
    expect(engine.deadlineAtMs).toBe(62_500);
  });

  it('keeps corrected positions distinct from never-wrong positions', () => {
    const engine = new TrialEngine(untimed('abcd'));
    type(engine, 'ax⌫b');
    expect([0, 1, 2, 3].map((i) => engine.charState(i))).toEqual(['correct', 'corrected', 'current', 'upcoming']);
    engine.insert(5000, 'q', KEY);
    expect(engine.charState(2)).toBe('wrong');
    expect(engine.typedAt(2)).toBe('q');
  });
});

describe('timing boundary', () => {
  it('admits events strictly before t0 + 60000 ms and rejects events at or after it', () => {
    const engine = new TrialEngine(fixed('abcdef and more'));
    engine.insert(1000, 'a', KEY);
    engine.insert(60_999.999, 'b', KEY);
    engine.insert(61_000, 'c', KEY);
    engine.insert(61_000.001, 'c', KEY);
    engine.deleteBackward(61_500, BACKSPACE);
    engine.finish(62_000, 'deadline');
    const outcome = engine.outcome();
    expect(outcome.counters).toMatchObject({ attempts: 2, finalCorrect: 2, lateInputs: 3, corrections: 0 });
    expect(outcome.endAtMs).toBe(61_000);
    expect(outcome.activeMs).toBe(60_000);
  });

  it('A05: a delayed deadline callback cannot admit late input into the frozen result', () => {
    const engine = new TrialEngine(fixed('abcdef and more'));
    engine.insert(0, 'a', KEY);
    engine.insert(59_990, 'b', KEY);
    engine.insert(60_010, 'c', KEY); // delivered while the timer callback was delayed
    engine.finish(60_750, 'deadline');
    const frozen = engine.outcome();
    engine.insert(60_800, 'c', KEY);
    engine.deleteBackward(60_900, BACKSPACE);
    expect(frozen.counters).toMatchObject({ attempts: 2, finalCorrect: 2, lateInputs: 1 });
    expect(engine.outcome()).toEqual(frozen);
  });

  it('lets inactivity after the first insertion consume benchmark time', () => {
    const engine = new TrialEngine(fixed('ab and more'));
    engine.insert(0, 'a', KEY);
    engine.insert(59_000, 'b', KEY);
    engine.finish(60_000, 'deadline');
    expect(engine.outcome().metrics.wpm).toBeCloseTo(0.4, 12);
  });

  it('excludes explicit pauses from untimed practice time and measures to the last edit', () => {
    const engine = new TrialEngine(untimed('abcdefgh'));
    engine.insert(0, 'a', KEY);
    engine.insert(10_000, 'b', KEY);
    engine.pause(12_000);
    engine.insert(15_000, 'c', KEY); // ignored while paused
    engine.resume(40_000);
    engine.insert(42_000, 'c', KEY);
    engine.finish(90_000, 'user-ended');
    const outcome = engine.outcome();
    expect(outcome.activeMs).toBe(14_000);
    expect(outcome.counters.attempts).toBe(3);
    expect(engine.events.some((e) => e.kind === 'ignored')).toBe(true);
  });

  it('refuses to pause a fixed benchmark', () => {
    const engine = new TrialEngine(fixed('abc and more'));
    engine.insert(0, 'a', KEY);
    expect(engine.pause(100)).toEqual([]);
    expect(engine.phase).toBe('running');
  });

  it('marks premature exhaustion of a fixed prompt as invalid, never as a fast completion', () => {
    const engine = new TrialEngine(fixed('abc'));
    type(engine, 'abc');
    const outcome = engine.outcome();
    expect(outcome.status).toBe('invalid');
    expect(outcome.invalidity).toEqual(['text-exhausted']);
  });
});

describe('interruption and abort', () => {
  it('A06: interrupting a running benchmark keeps the partial record as interrupted', () => {
    const engine = new TrialEngine(fixed('abcdef and more'));
    type(engine, 'abc', 0, 1000);
    engine.interrupt(20_000, 'focus-lost');
    const outcome = engine.outcome();
    expect(outcome.status).toBe('interrupted');
    expect(outcome.interruption).toBe('focus-lost');
    expect(outcome.activeMs).toBe(20_000);
    expect(outcome.counters.attempts).toBe(3);
    expect(engine.insert(21_000, 'd', KEY)).toEqual([]);
  });

  it('aborts, rather than interrupts, a trial that never received input', () => {
    const engine = new TrialEngine(fixed('abc and more'));
    engine.interrupt(5000, 'escape');
    expect(engine.outcome().status).toBe('aborted');
  });

  it('invalidation ends the trial immediately and is never upgraded to completed', () => {
    const engine = new TrialEngine(fixed('abc and more'));
    type(engine, 'ab');
    engine.invalidate(5000, 'paste');
    engine.finish(70_000, 'deadline');
    expect(engine.outcome().status).toBe('invalid');
    expect(engine.outcome().invalidity).toEqual(['paste']);
  });
});

describe('exact threshold arithmetic', () => {
  it('parses decimal thresholds exactly', () => {
    expect(parseDecimal('98.5')).toEqual({ num: 985n, den: 10n });
    expect(parseDecimal(97)).toEqual({ num: 97n, den: 1n });
    expect(() => parseDecimal('-1')).toThrow();
  });

  it('compares WPM thresholds with integers', () => {
    expect(wpmMeets(150, 60_000, 30)).toBe(true);
    expect(wpmMeets(149, 60_000, 30)).toBe(false);
    expect(wpmMeets(225, 60_000, '45')).toBe(true);
    expect(wpmMeets(10, 0, 1)).toBe(false);
  });

  it('rounds halves away from zero for display', () => {
    expect(formatRatio(1n, 8n, 2)).toBe('0.13');
    expect(formatRatio(5n, 2n, 0)).toBe('3');
    expect(formatRatio(-5n, 2n, 0)).toBe('-3');
    expect(formatRatio(0n, 7n, 1)).toBe('0.0');
  });

  it('keeps metric formulas unrounded', () => {
    const metrics = computeMetrics(
      { attempts: 3, attemptsCorrect: 2, finalCorrect: 2, residualErrors: 0, corrections: 0, emptyBackspaces: 0 },
      60_000,
    );
    expect(metrics.accuracy).toBeCloseTo(66.666_666_666, 8);
    expect(metrics.wpm).toBeCloseTo(0.4, 12);
  });
});

describe('cue-started timing (two-machine trials and solo baselines)', () => {
  it('starts the fixed interval at the scheduled start, counts idle time, and ignores early input', () => {
    const engine = new TrialEngine(fixed('the quiet hand returns'));
    engine.anchorStart(10_000);
    expect(engine.deadlineAtMs).toBe(70_000);
    engine.insert(9_500, 't', KEY); // before the cue: early, ignored
    engine.insert(13_000, 't', KEY);
    engine.insert(13_200, 'h', KEY);
    engine.insert(70_000, 'e', KEY); // at the deadline: late
    engine.finish(71_000, 'deadline');
    const outcome = engine.outcome();
    expect(outcome.startAtMs).toBe(10_000);
    expect(outcome.activeMs).toBe(60_000);
    expect(outcome.counters).toMatchObject({ attempts: 2, finalCorrect: 2, lateInputs: 1 });
    expect(engine.events.filter((e) => e.kind === 'early')).toHaveLength(1);
    expect(TrialEngine.replay(engine.spec, engine.events).outcome()).toEqual(outcome);
  });

  it('a side that typed nothing still completes the shared interval', () => {
    const engine = new TrialEngine(fixed('abc and more'));
    engine.anchorStart(0);
    engine.finish(60_500, 'deadline');
    expect(engine.outcome()).toMatchObject({ status: 'completed', activeMs: 60_000, counters: { attempts: 0 } });
  });

  it('interrupts, rather than aborts, once the scheduled interval has begun', () => {
    const engine = new TrialEngine(fixed('abc and more'));
    engine.anchorStart(1_000);
    engine.interrupt(500, 'focus-lost');
    expect(engine.outcome().status).toBe('aborted');
    const running = new TrialEngine(fixed('abc and more'));
    running.anchorStart(1_000);
    running.interrupt(5_000, 'focus-lost');
    expect(running.outcome()).toMatchObject({ status: 'interrupted', activeMs: 4_000 });
  });
});
