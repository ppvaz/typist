import { describe, expect, it } from 'vitest';
import {
  checkCoreCompletion,
  currentStability,
  dailyReferenceSets,
  evaluateMilestone,
  evaluateSet,
  GATES,
  milestoneFromAward,
  modeSetEvaluations,
  qualify,
} from '../../src/domain/evidence';
import type { ModeId } from '../../src/domain/modes';
import { acc, index, passingSet, set, trial } from './fixtures';

function evaluate(bundles: Parameters<typeof index>[0], mode: ModeId = 'QL') {
  const { sets, trials } = index(bundles);
  return modeSetEvaluations(mode, sets, trials);
}

describe('set qualification', () => {
  it('A09: medians of 31 WPM / 98% still fail because only one trial jointly reaches 30 / 98', () => {
    const bundle = set([trial({ wpm: 32, ...acc(96) }), trial({ wpm: 31, ...acc(99) }), trial({ wpm: 29, ...acc(98) })]);
    const [e] = evaluate([bundle]);
    expect(e?.medianWpm?.format(1)).toBe('31.0');
    expect(e?.medianAccuracy?.format(2)).toBe('98.00');
    const result = qualify(e!, GATES.acquired);
    expect(result.jointPasses).toBe(1);
    expect(result.status).toBe('fail');
    expect(result.reasons.map((r) => r.code)).toContain('joint');
  });

  it('passes with two of three trials meeting both thresholds', () => {
    const bundle = set([trial({ wpm: 30, ...acc(98) }), trial({ wpm: 29.8, ...acc(99) }), trial({ wpm: 31, ...acc(98.5) })]);
    expect(qualify(evaluate([bundle])[0]!, GATES.acquired)).toMatchObject({ status: 'pass', jointPasses: 2 });
  });

  it('keeps 30 WPM / 99% with unknown glances pending, never an inferred zero', () => {
    const bundle = set([0, 1, 2].map(() => trial({ wpm: 30, ...acc(99), glances: { kind: 'unknown' } })));
    const result = qualify(evaluate([bundle])[0]!, GATES.acquired);
    expect(result.status).toBe('pending');
    expect(result.reasons.map((r) => r.code)).toContain('glances-unknown');
  });

  it('leaves unanswered declarations pending', () => {
    const bundle = set([0, 1, 2].map(() => trial({ wpm: 30, ...acc(99), glances: null, hand: null, unrecordedAssistance: null })));
    const e = evaluate([bundle])[0]!;
    expect(e.declarationsAnswered).toBe(false);
    expect(qualify(e, GATES.acquired).status).toBe('pending');
  });

  it('A07: a hidden map revealed mid-test is a measurable result with no no-look pass', () => {
    const bundle = set([trial({ wpm: 35, ...acc(99), revealed: true }), trial({ wpm: 35, ...acc(99) }), trial({ wpm: 35, ...acc(99) })]);
    const e = evaluate([bundle])[0]!;
    expect(e.medianWpm?.format(1)).toBe('35.0');
    const result = qualify(e, GATES.acquired);
    expect(result.status).toBe('fail');
    expect(result.reasons.map((r) => r.code)).toContain('assistance');
  });

  it('fails no-look on any positive or bounded glance count', () => {
    const exact = set([trial({ wpm: 35, ...acc(99), glances: { kind: 'exact', count: 1 } }), trial({ wpm: 35, ...acc(99) }), trial({ wpm: 35, ...acc(99) })]);
    const bounded = set([trial({ wpm: 35, ...acc(99), glances: { kind: 'at-least', count: 3 } }), trial({ wpm: 35, ...acc(99) }), trial({ wpm: 35, ...acc(99) })]);
    expect(qualify(evaluate([exact])[0]!, GATES.acquired).status).toBe('fail');
    expect(qualify(evaluate([bounded])[0]!, GATES.acquired).status).toBe('fail');
  });

  it('excludes a set reported with the other hand from the mode evidence', () => {
    const bundle = set([trial({ wpm: 35, ...acc(99), hand: 'other' }), trial({ wpm: 35, ...acc(99) }), trial({ wpm: 35, ...acc(99) })]);
    const e = evaluate([bundle])[0]!;
    expect(e.excluded).toBe(true);
    expect(qualify(e, GATES.acquired).reasons[0]?.code).toBe('wrong-hand');
    expect(dailyReferenceSets([e])).toEqual([]);
  });

  it('forms the set from the first three valid trials; an interrupted one is kept but skipped', () => {
    const interrupted = trial({ wpm: 10, status: 'interrupted', activeMs: 20_000 });
    const bundle = set([interrupted, trial({ wpm: 31, ...acc(99) }), trial({ wpm: 20, ...acc(90) }), trial({ wpm: 31, ...acc(99) }), trial({ wpm: 40, ...acc(100) })]);
    const e = evaluate([bundle])[0]!;
    expect(e.attempts).toHaveLength(5);
    expect(e.contributing.map((t) => t.metrics.wpm)).toEqual([31, 20, 31]);
  });

  it('A19: a trial with unknown insertion provenance cannot earn a reference result', () => {
    const bundle = set([trial({ wpm: 40, ...acc(99), verification: 'unverified' }), trial({ wpm: 40, ...acc(99) }), trial({ wpm: 40, ...acc(99) })]);
    const e = evaluate([bundle])[0]!;
    expect(e.complete).toBe(false);
    expect(qualify(e, GATES.acquired).status).toBe('fail');
  });

  it('A06: an interrupted trial cannot produce reference evidence', () => {
    const bundle = set([trial({ wpm: 40, status: 'interrupted', activeMs: 30_000 }), trial({ wpm: 40, ...acc(99) }), trial({ wpm: 40, ...acc(99) })]);
    const e = evaluate([bundle])[0]!;
    expect(e.complete).toBe(false);
    expect(qualify(e, GATES.acquired).status).toBe('fail');
  });
});

describe('acquisition across dates', () => {
  it('A08: three passing tests on one date are one qualifying set, not acquisition', () => {
    const evals = evaluate([passingSet('2026-09-01'), passingSet('2026-09-01'), passingSet('2026-09-01')]);
    expect(dailyReferenceSets(evals)).toHaveLength(1);
    const m = evaluateMilestone(evals, GATES.acquired);
    expect(m.award).toBeNull();
    expect(m.progress).toBe(1);
  });

  it('awards acquisition after qualifying sets on three distinct dates', () => {
    const evals = evaluate([passingSet('2026-09-01'), passingSet('2026-09-03'), passingSet('2026-09-05')]);
    const m = evaluateMilestone(evals, GATES.acquired);
    expect(m.award?.localDate).toBe('2026-09-05');
    expect(m.award?.sets.map((s) => s.localDate)).toEqual(['2026-09-01', '2026-09-03', '2026-09-05']);
    const record = milestoneFromAward('m1', 'QL', m, '2026-09-05T12:00:00Z');
    expect(record?.setIds).toHaveLength(3);
    expect(record?.trialIds).toHaveLength(9);
  });

  it('uses the first complete set of each date, so a later better set cannot replace a failing one', () => {
    const failingFirst = set([0, 1, 2].map(() => trial({ wpm: 25, ...acc(99), date: '2026-09-03' })), { date: '2026-09-03', createdAt: '2026-09-03T09:00:00Z' });
    const passingLater = passingSet('2026-09-03');
    const lateBundle = { ...passingLater, set: { ...passingLater.set, createdAt: '2026-09-03T18:00:00Z' } };
    const evals = evaluate([passingSet('2026-09-01'), failingFirst, lateBundle, passingSet('2026-09-05')]);
    expect(evaluateMilestone(evals, GATES.acquired).award).toBeNull();
  });

  it('a known no-look failure still occupies that date', () => {
    const glanced = passingSet('2026-09-03', 'QL', 32, 99, { glances: { kind: 'exact', count: 2 } });
    const clean = passingSet('2026-09-03');
    const later = { ...clean, set: { ...clean.set, createdAt: '2026-09-03T20:00:00Z' } };
    const evals = evaluate([passingSet('2026-09-01'), glanced, later, passingSet('2026-09-05')]);
    expect(evaluateMilestone(evals, GATES.acquired).award).toBeNull();
  });

  it('A01: acquiring QL leaves QR, DL and DR independent', () => {
    const bundles = [passingSet('2026-09-01'), passingSet('2026-09-02'), passingSet('2026-09-03')];
    const { sets, trials } = index(bundles);
    for (const mode of ['QR', 'DL', 'DR'] as const) {
      expect(evaluateMilestone(modeSetEvaluations(mode, sets, trials), GATES.acquired).award).toBeNull();
    }
    expect(evaluateMilestone(modeSetEvaluations('QL', sets, trials), GATES.acquired).award).not.toBeNull();
  });

  it('A10/A15: a setup change starts a new series; dates from two series never combine', () => {
    const a = passingSet('2026-09-01');
    const b = passingSet('2026-09-02');
    const c = passingSet('2026-09-03', 'QL', 32, 99, { setupRevisionId: 'setup-rev-2' });
    const evals = evaluate([a, b, c]);
    expect(new Set(evals.map((e) => e.signatureHash)).size).toBe(2);
    expect(evaluateMilestone(evals, GATES.acquired).award).toBeNull();
  });

  it('a monthly fixed-passage set does not feed the rotating-corpus acquisition gate', () => {
    const bundles = [passingSet('2026-09-01'), passingSet('2026-09-02'), passingSet('2026-09-03')].map((b) => ({
      ...b,
      set: { ...b.set, protocolId: 'monthly-fixed-passage-60-v1' },
    }));
    const { sets, trials } = index(bundles);
    expect(modeSetEvaluations('QL', sets, trials)).toEqual([]);
  });

  it('advance needs one qualifying set at 20 WPM / 97%', () => {
    const evals = evaluate([set([trial({ wpm: 20, ...acc(97) }), trial({ wpm: 21, ...acc(97.5) }), trial({ wpm: 18, ...acc(99) })])]);
    expect(evaluateMilestone(evals, GATES.advance).award?.sets).toHaveLength(1);
  });

  it('reports progress and a pending latest set', () => {
    const pending = passingSet('2026-09-02', 'QL', 32, 99, { glances: { kind: 'unknown' } });
    const m = evaluateMilestone(evaluate([passingSet('2026-09-01'), pending]), GATES.acquired);
    expect(m.pending).toBe(true);
    expect(m.progress).toBe(0);
  });
});

describe('stability and core completion', () => {
  const modes: ModeId[] = ['QL', 'QR', 'DL', 'DR'];

  it('A16: all four acquired but one current set older than 14 days needs stability evidence first', () => {
    const byMode = new Map<ModeId, ReturnType<typeof evaluate>>();
    for (const mode of modes) {
      const dates = mode === 'DR' ? ['2026-08-01', '2026-08-02', '2026-08-03'] : ['2026-09-10', '2026-09-11', '2026-09-12'];
      byMode.set(mode, evaluate(dates.map((d) => passingSet(d, mode)), mode));
    }
    const check = checkCoreCompletion(modes, new Set(modes), byMode, '2026-09-20');
    expect(check.ready).toBe(false);
    expect(check.perMode.DR?.stability.status).toBe('not-stable');
    expect(check.missing).toEqual(['DR needs a current passing set (within 14 days).']);
    byMode.set('DR', evaluate(['2026-08-01', '2026-08-02', '2026-08-03', '2026-09-19'].map((d) => passingSet(d, 'DR')), 'DR'));
    expect(checkCoreCompletion(modes, new Set(modes), byMode, '2026-09-20').ready).toBe(true);
  });

  it('stability uses the latest eligible set, exactly 14 days is still current', () => {
    const evals = evaluate([passingSet('2026-09-01')]);
    expect(currentStability(evals, '2026-09-15').status).toBe('stable');
    expect(currentStability(evals, '2026-09-16').status).toBe('not-stable');
    expect(currentStability([], '2026-09-16').status).toBe('no-evidence');
  });

  it('a later weak set makes the mode currently unstable without touching history', () => {
    const weak = set([0, 1, 2].map(() => trial({ wpm: 22, ...acc(96), date: '2026-09-10' })), { date: '2026-09-10' });
    const evals = evaluate([passingSet('2026-09-01'), passingSet('2026-09-02'), passingSet('2026-09-03'), weak]);
    expect(evaluateMilestone(evals, GATES.acquired).award?.localDate).toBe('2026-09-03');
    expect(currentStability(evals, '2026-09-11').status).toBe('not-stable');
  });

  it('evaluates a set without its trials as incomplete', () => {
    const bundle = passingSet('2026-09-01');
    const e = evaluateSet(bundle.set, new Map());
    expect(e.complete).toBe(false);
  });
});
