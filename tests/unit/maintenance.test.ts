import { describe, expect, it } from 'vitest';
import { modeSetEvaluations } from '../../src/domain/evidence';
import {
  acquisitionBaseline,
  lossExceeds,
  maintenancePriority,
  maintenanceStatus,
  retentionChecks,
  slotDays,
} from '../../src/domain/maintenance';
import { Fraction } from '../../src/domain/scoring/fraction';
import { acc, index, milestone, passingSet, set, trial } from './fixtures';

describe('A13: maintenance thresholds use exact arithmetic', () => {
  it('baseline 40 / current 34 is exactly 15% loss and does not trigger; 33.9 does', () => {
    expect(lossExceeds(Fraction.of(34), Fraction.of(40))).toBe(false);
    expect(lossExceeds(Fraction.decimal('33.9'), Fraction.of(40))).toBe(true);
    // Binary floating point would get this wrong: 1 - 34/40 = 0.15000000000000002.
    expect(1 - 34 / 40 > 0.15).toBe(true);
  });

  it('computes baseline and current from set medians and raises slots on a real decline', () => {
    const acquiredSets = ['2026-08-01', '2026-08-02', '2026-08-03'].map((d) => passingSet(d, 'QL', 40, 99));
    const recent = ['2026-09-01', '2026-09-02', '2026-09-03'].map((d) => passingSet(d, 'QL', 34, 99));
    const { sets, trials } = index([...acquiredSets, ...recent]);
    const evals = modeSetEvaluations('QL', sets, trials);
    const m = milestone('QL', acquiredSets.map((b) => b.set.id), acquiredSets[0]!.set.signatureHash, '2026-08-03');
    expect(acquisitionBaseline(m, evals)?.value.format(1)).toBe('40.0');
    const status = maintenanceStatus({ mode: 'QL', isPrimary: false, advanced: true, acquired: m, evaluations: evals, lastPracticed: '2026-09-03', doneThisWeek: 0, today: '2026-09-09', practiceWeekdays: [1, 2, 3, 4, 5] });
    expect(status.current?.value.format(1)).toBe('34.0');
    expect(status.kind).toBe('acquired');
    expect(status.slotsPerWeek).toBe(1);

    const lower = ['2026-09-04', '2026-09-05', '2026-09-06'].map((d) => passingSet(d, 'QL', 33.8, 99));
    const all = index([...acquiredSets, ...recent, ...lower]);
    const evals2 = modeSetEvaluations('QL', all.sets, all.trials);
    const status2 = maintenanceStatus({ mode: 'QL', isPrimary: false, advanced: true, acquired: m, evaluations: evals2, lastPracticed: '2026-09-06', doneThisWeek: 0, today: '2026-09-09', practiceWeekdays: [1, 2, 3, 4, 5] });
    expect(status2.kind).toBe('increased');
    expect(status2.triggers).toEqual(['speed-loss']);
    expect(status2.slotsPerWeek).toBe(2);
  });

  it('low accuracy on the latest eligible set triggers extra maintenance independently', () => {
    const acquiredSets = ['2026-08-01', '2026-08-02', '2026-08-03'].map((d) => passingSet(d, 'QL', 40, 99));
    const sloppy = set([0, 1, 2].map(() => trial({ wpm: 41, ...acc(97), date: '2026-09-01' })), { date: '2026-09-01' });
    const { sets, trials } = index([...acquiredSets, sloppy]);
    const evals = modeSetEvaluations('QL', sets, trials);
    const m = milestone('QL', acquiredSets.map((b) => b.set.id), acquiredSets[0]!.set.signatureHash, '2026-08-03');
    const status = maintenanceStatus({ mode: 'QL', isPrimary: false, advanced: true, acquired: m, evaluations: evals, lastPracticed: '2026-09-01', doneThisWeek: 0, today: '2026-09-02', practiceWeekdays: [1, 2, 3, 4, 5] });
    expect(status.kind).toBe('increased');
    expect(status.triggers).toContain('accuracy');
  });

  it('shows insufficient evidence with fewer than three comparable sets', () => {
    const acquiredSets = ['2026-08-01', '2026-08-02', '2026-08-03'].map((d) => passingSet(d, 'QL', 40, 99));
    const { sets, trials } = index(acquiredSets);
    const evals = modeSetEvaluations('QL', sets, trials);
    const m = milestone('QL', acquiredSets.map((b) => b.set.id), acquiredSets[0]!.set.signatureHash, '2026-08-03');
    // The three acquisition sets are themselves comparable, so add a new series instead.
    const other = milestone('QL', acquiredSets.map((b) => b.set.id), 'different-series', '2026-08-03');
    expect(maintenanceStatus({ mode: 'QL', isPrimary: false, advanced: true, acquired: m, evaluations: evals, lastPracticed: null, doneThisWeek: 0, today: '2026-09-02', practiceWeekdays: [1, 2, 3, 4, 5] }).evidence).toBe('sufficient');
    expect(maintenanceStatus({ mode: 'QL', isPrimary: false, advanced: true, acquired: other, evaluations: [], lastPracticed: null, doneThisWeek: 0, today: '2026-09-02', practiceWeekdays: [1, 2, 3, 4, 5] }).evidence).toBe('insufficient');
  });

  it('gives advanced but unacquired modes two five-minute slots; primary modes none', () => {
    const base = { acquired: null, evaluations: [], lastPracticed: null, doneThisWeek: 0, today: '2026-09-09', practiceWeekdays: [1, 2, 3, 4, 5] };
    expect(maintenanceStatus({ ...base, mode: 'QL', isPrimary: false, advanced: true })).toMatchObject({ kind: 'pre-acquisition', slotsPerWeek: 2, slotMinutes: 5 });
    expect(maintenanceStatus({ ...base, mode: 'QR', isPrimary: true, advanced: false })).toMatchObject({ kind: 'primary', slotsPerWeek: 0 });
    expect(maintenanceStatus({ ...base, mode: 'DL', isPrimary: false, advanced: false })).toMatchObject({ kind: 'none', due: false });
  });

  it('places slots on Wednesday first and marks them due and overdue', () => {
    expect(slotDays(1, [1, 2, 3, 4, 5])).toEqual([3]);
    expect(slotDays(2, [1, 2, 3, 4, 5])).toEqual([3, 5]);
    expect(slotDays(2, [2, 4, 6])).toEqual([2, 4]);
    const base = { mode: 'QL' as const, isPrimary: false, advanced: true, acquired: null, evaluations: [], lastPracticed: null, practiceWeekdays: [1, 2, 3, 4, 5] };
    // 2026-09-09 is a Wednesday; 2026-09-11 a Friday.
    expect(maintenanceStatus({ ...base, doneThisWeek: 0, today: '2026-09-08' }).due).toBe(false);
    expect(maintenanceStatus({ ...base, doneThisWeek: 0, today: '2026-09-09' })).toMatchObject({ due: true, overdueDays: 0 });
    expect(maintenanceStatus({ ...base, doneThisWeek: 0, today: '2026-09-11' })).toMatchObject({ due: true, overdueDays: 2 });
    expect(maintenanceStatus({ ...base, doneThisWeek: 1, today: '2026-09-11' })).toMatchObject({ due: true, overdueDays: 0 });
    expect(maintenanceStatus({ ...base, doneThisWeek: 2, today: '2026-09-11' }).due).toBe(false);
  });

  it('prioritizes regressing, then overdue, then least recently practised modes', () => {
    const base = { acquired: null, evaluations: [], doneThisWeek: 0, today: '2026-09-11', practiceWeekdays: [1, 2, 3, 4, 5], isPrimary: false, advanced: true };
    const a = { ...maintenanceStatus({ ...base, mode: 'QL', lastPracticed: '2026-09-01' }) };
    const b = { ...maintenanceStatus({ ...base, mode: 'QR', lastPracticed: '2026-08-01' }) };
    const c = { ...maintenanceStatus({ ...base, mode: 'DL', lastPracticed: '2026-09-10' }), kind: 'increased' as const };
    expect([a, b, c].sort(maintenancePriority).map((s) => s.mode)).toEqual(['DL', 'QR', 'QL']);
  });
});

describe('retention', () => {
  const acquiredSets = ['2026-08-01', '2026-08-02', '2026-08-03'].map((d) => passingSet(d, 'QL', 40, 99));

  function check(retentionWpm: number, gapEnd: string) {
    const retention = passingSet(gapEnd, 'QL', retentionWpm, 99);
    const { sets, trials } = index([...acquiredSets, retention]);
    const evals = modeSetEvaluations('QL', sets, trials);
    const m = milestone('QL', acquiredSets.map((b) => b.set.id), acquiredSets[0]!.set.signatureHash, '2026-08-03');
    const baseline = acquisitionBaseline(m, evals);
    const practice = [
      ...acquiredSets.map((b) => ({ localDate: b.set.localDate, at: `${b.set.localDate}T10:00:00Z`, setId: b.set.id })),
      { localDate: gapEnd, at: `${gapEnd}T10:00:00Z`, setId: retention.set.id },
    ];
    return retentionChecks(m, baseline, evals, practice);
  }

  it('fails the stricter roadmap target at exactly 15% loss', () => {
    const [r] = check(34, '2026-08-12');
    expect(r?.status).toBe('fail');
    expect(r?.loss?.format(2)).toBe('0.15');
  });

  it('passes below 15% loss with accuracy of at least 98%', () => {
    expect(check(34.2, '2026-08-12')[0]?.status).toBe('pass');
  });

  it('needs at least seven full days without practice', () => {
    expect(check(40, '2026-08-10')).toHaveLength(0);
    expect(check(40, '2026-08-11')).toHaveLength(1);
  });
});
