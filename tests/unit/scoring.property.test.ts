import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { InputMeta } from '../../src/domain/input/types';
import { TrialEngine, type TrialSpec } from '../../src/domain/scoring/engine';

const KEY: InputMeta = { path: 'key', inputType: 'insertText', code: null, key: null };
const BACKSPACE: InputMeta = { path: 'backspace', inputType: 'deleteContentBackward', code: null, key: null };

type Action = { kind: 'insert'; g: string; dt: number } | { kind: 'delete'; dt: number } | { kind: 'pause'; dt: number } | { kind: 'resume'; dt: number };

const alphabet = ['a', 'b', ' ', 'c'];
const target = fc.array(fc.constantFrom(...alphabet), { minLength: 40, maxLength: 160 });
const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('insert' as const), g: fc.constantFrom(...alphabet, 'z'), dt: fc.integer({ min: 0, max: 900 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('delete' as const), dt: fc.integer({ min: 0, max: 900 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('pause' as const), dt: fc.integer({ min: 0, max: 3000 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('resume' as const), dt: fc.integer({ min: 0, max: 3000 }) }) },
);
const timing = fc.constantFrom<TrialSpec['timing']>({ mode: 'fixed', durationMs: 60_000 }, { mode: 'untimed' });

function run(spec: TrialSpec, actions: readonly Action[]): { engine: TrialEngine; t: number } {
  const engine = new TrialEngine(spec);
  let t = 0;
  for (const a of actions) {
    t += a.dt;
    if (a.kind === 'insert') engine.insert(t, a.g, KEY);
    else if (a.kind === 'delete') engine.deleteBackward(t, BACKSPACE);
    else if (a.kind === 'pause') engine.pause(t);
    else engine.resume(t);
  }
  return { engine, t };
}

describe('scoring invariants', () => {
  it('keeps counters consistent after every action', () => {
    fc.assert(
      fc.property(target, timing, fc.array(action, { maxLength: 300 }), (tgt, tm, actions) => {
        const engine = new TrialEngine({ kind: 'practice', timing: tm, target: tgt });
        let t = 0;
        let previous = engine.counters();
        for (const a of actions) {
          t += a.dt;
          if (a.kind === 'insert') engine.insert(t, a.g, KEY);
          else if (a.kind === 'delete') engine.deleteBackward(t, BACKSPACE);
          else if (a.kind === 'pause') engine.pause(t);
          else engine.resume(t);
          const c = engine.counters();
          expect(c.attemptsCorrect).toBeLessThanOrEqual(c.attempts);
          expect(c.finalCorrect + c.residualErrors).toBe(engine.bufferLength);
          expect(c.finalCorrect).toBeLessThanOrEqual(c.attemptsCorrect);
          // A correction never removes a historical attempt.
          expect(c.attempts).toBeGreaterThanOrEqual(previous.attempts);
          expect(c.attemptsCorrect).toBeGreaterThanOrEqual(previous.attemptsCorrect);
          expect(c.corrections).toBeGreaterThanOrEqual(previous.corrections);
          previous = c;
        }
        const { accuracy } = engine.outcome(t).metrics;
        if (accuracy !== null) {
          expect(accuracy).toBeGreaterThanOrEqual(0);
          expect(accuracy).toBeLessThanOrEqual(100);
        }
      }),
    );
  });

  it('replays its own event log to an identical record', () => {
    fc.assert(
      fc.property(target, timing, fc.array(action, { maxLength: 250 }), fc.boolean(), (tgt, tm, actions, finishAtDeadline) => {
        const spec: TrialSpec = { kind: 'benchmark', timing: tm, target: tgt };
        const { engine, t } = run(spec, actions);
        if (finishAtDeadline) engine.finish(t + 60_000, tm.mode === 'fixed' ? 'deadline' : 'user-ended');
        else engine.interrupt(t + 1, 'focus-lost');
        const replayed = TrialEngine.replay(spec, engine.events);
        expect(replayed.events).toEqual(engine.events);
        expect(replayed.outcome()).toEqual(engine.outcome());
      }),
    );
  });

  it('never lets input at or after the deadline change a completed reference result', () => {
    fc.assert(
      fc.property(
        target,
        fc.array(action, { minLength: 1, maxLength: 200 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 5000 }), fc.constantFrom(...alphabet, 'z', '⌫')), { maxLength: 30 }),
        (tgt, actions, late) => {
          const spec: TrialSpec = { kind: 'benchmark', timing: { mode: 'fixed', durationMs: 60_000 }, target: tgt };
          const inWindow = actions.map((a) => ({ ...a, dt: Math.min(a.dt, 200) }));
          const base = run(spec, inWindow).engine;
          const withLate = run(spec, inWindow).engine;
          const deadline = withLate.deadlineAtMs;
          for (const [offset, g] of late) {
            if (deadline === null) break;
            if (g === '⌫') withLate.deleteBackward(deadline + offset, BACKSPACE);
            else withLate.insert(deadline + offset, g, KEY);
          }
          base.finish(10_000_000, 'deadline');
          withLate.finish(10_000_000, 'deadline');
          const a = base.outcome();
          const b = withLate.outcome();
          expect({ ...b.counters, lateInputs: 0 }).toEqual({ ...a.counters, lateInputs: 0 });
          expect(b.metrics).toEqual(a.metrics);
          expect(b.status).toEqual(a.status);
        },
      ),
    );
  });

  it('cannot inflate correct-output WPM by deleting and retyping correct text', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 20 }), (typed, retypes) => {
        const text = 'the quiet hand returns to the ridge and waits for the word that follows it';
        const spec: TrialSpec = { kind: 'benchmark', timing: { mode: 'fixed', durationMs: 60_000 }, target: [...text] };
        const honest = new TrialEngine(spec);
        const padded = new TrialEngine(spec);
        let t = 0;
        for (let i = 0; i < typed; i += 1) {
          t += 100;
          honest.insert(t, text[i] ?? 'x', KEY);
          padded.insert(t, text[i] ?? 'x', KEY);
        }
        const last = text[typed - 1] ?? 'x';
        for (let i = 0; i < retypes; i += 1) {
          padded.deleteBackward((t += 50), BACKSPACE);
          padded.insert((t += 50), last, KEY);
        }
        honest.finish(t, 'deadline');
        padded.finish(t, 'deadline');
        const h = honest.outcome().metrics;
        const p = padded.outcome().metrics;
        expect(p.wpm).toBe(h.wpm);
        expect(p.rawWpm ?? 0).toBeGreaterThan(h.rawWpm ?? 0);
      }),
    );
  });
});
