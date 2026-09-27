import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Level } from '../../src/domain/curriculum';
import { maintenanceStatus, type MaintenanceStatus } from '../../src/domain/maintenance';
import type { ModeId } from '../../src/domain/modes';
import { type ModePlanInfo, planDay, removeBlock, resizeBlock } from '../../src/domain/planner';

function overdue(mode: ModeId, lastPracticed: string, increased = false): MaintenanceStatus {
  const s = maintenanceStatus({ mode, isPrimary: false, advanced: true, acquired: null, evaluations: [], lastPracticed, doneThisWeek: 0, today: '2026-09-11', practiceWeekdays: [1, 2, 3, 4, 5] });
  return increased ? { ...s, kind: 'increased' } : s;
}

function info(mode: ModeId, level: Level = 4, maintenance: MaintenanceStatus | null = null, extra: Partial<ModePlanInfo> = {}): ModePlanInfo {
  return { mode, level, started: true, calibrated: true, acquired: false, advanced: level >= 5, maintenance, weakTargets: [], assessmentDue: null, ...extra };
}

const ids = (i: number) => `block-${i}`;

describe('daily plan', () => {
  it('builds the standard 30-minute template on a Monday', () => {
    const plan = planDay({ date: '2026-09-07', budgetMinutes: 30, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR'), others: [], switching: { appropriate: false, pair: null, stage: null }, lastFatigue: null, idFor: ids });
    expect(plan.template).toBe('standard');
    expect(plan.blocks.map((b) => [b.kind, b.minutes])).toEqual([
      ['warmup', 3],
      ['weak-keys', 7],
      ['words', 10],
      ['timed-text', 7],
      ['log', 3],
    ]);
    expect(plan.totalMinutes).toBe(30);
  });

  it('moves the benchmark after the warm-up on Friday and replaces switching with light practice when not appropriate', () => {
    const plan = planDay({ date: '2026-09-11', budgetMinutes: 30, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR'), others: [], switching: { appropriate: false, pair: null, stage: null }, lastFatigue: null, idFor: ids });
    expect(plan.template).toBe('friday');
    expect(plan.blocks.map((b) => b.kind)).toEqual(['warmup', 'benchmark', 'weak-keys', 'light-words', 'light-words', 'log']);
    expect(plan.totalMinutes).toBe(30);
  });

  it('A12: three overdue modes and a 30-minute budget schedule at most two modes and disclose the rest', () => {
    const others = [info('QL', 5, overdue('QL', '2026-09-01')), info('DL', 5, overdue('DL', '2026-08-20')), info('DR', 5, overdue('DR', '2026-09-05'))];
    const plan = planDay({ date: '2026-09-10', budgetMinutes: 30, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR'), others, switching: { appropriate: false, pair: null, stage: null }, lastFatigue: null, idFor: ids });
    const modes = new Set(plan.blocks.map((b) => b.mode).filter(Boolean));
    expect(modes.size).toBeLessThanOrEqual(2);
    expect(plan.blocks[0]?.kind).toBe('warmup');
    expect(plan.blocks.at(-1)?.kind).toBe('log');
    expect(plan.totalMinutes).toBeLessThanOrEqual(30);
    expect(plan.blocks.find((b) => b.kind === 'maintenance')?.mode).toBe('DL');
    expect(plan.deferred.map((d) => d.what)).toEqual(['QL maintenance', 'DR maintenance']);
    expect(plan.notes.join(' ')).toMatch(/Nothing was added beyond it/);
  });

  it('prefers a regressing mode over an overdue one', () => {
    const others = [info('QL', 5, overdue('QL', '2026-08-01')), info('DL', 6, overdue('DL', '2026-09-09', true), { acquired: true })];
    const plan = planDay({ date: '2026-09-10', budgetMinutes: 30, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR'), others, switching: { appropriate: false, pair: null, stage: null }, lastFatigue: null, idFor: ids });
    expect(plan.blocks.find((b) => b.kind === 'maintenance')?.mode).toBe('DL');
  });

  it('never schedules practice for an uncalibrated maintenance mode', () => {
    const others = [info('QL', 5, overdue('QL', '2026-09-01'), { calibrated: false })];
    const plan = planDay({ date: '2026-09-10', budgetMinutes: 30, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR'), others, switching: { appropriate: false, pair: null, stage: null }, lastFatigue: null, idFor: ids });
    expect(plan.blocks.some((b) => b.kind === 'maintenance')).toBe(false);
    expect(plan.deferred[0]?.why).toMatch(/calibration/);
  });

  it('offers rest on a non-practice day without creating catch-up debt', () => {
    const plan = planDay({ date: '2026-09-13', budgetMinutes: 30, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR'), others: [info('QL', 5, overdue('QL', '2026-09-01'))], switching: { appropriate: false, pair: null, stage: null }, lastFatigue: null, idFor: ids });
    expect(plan.practiceDay).toBe(false);
    expect(plan.blocks).toEqual([]);
  });

  it('uses the deep template for 45 minutes and keeps notes outside the benchmark block', () => {
    const plan = planDay({ date: '2026-09-08', budgetMinutes: 45, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR'), others: [], switching: { appropriate: true, pair: ['QR', 'QL'], stage: 'blocked' }, lastFatigue: null, idFor: ids });
    expect(plan.template).toBe('deep');
    expect(plan.totalMinutes).toBe(45);
    expect(plan.blocks.map((b) => b.kind)).toContain('switching');
    expect(plan.blocks.find((b) => b.kind === 'benchmark')?.minutes).toBe(5);
    expect(plan.blocks.find((b) => b.kind === 'log')?.minutes).toBeGreaterThan(0);
  });

  it('turns the benchmark into a level assessment for levels below 4', () => {
    const plan = planDay({ date: '2026-09-11', budgetMinutes: 30, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('DL', 1, null, { assessmentDue: 1 }), others: [], switching: { appropriate: false, pair: null, stage: null }, lastFatigue: null, idFor: ids });
    expect(plan.blocks.find((b) => b.kind === 'assessment')?.assessmentLevel).toBe(1);
    expect(plan.blocks.some((b) => b.kind === 'benchmark')).toBe(false);
  });

  it('never exceeds the budget, always keeps warm-up and logging', () => {
    const modes: ModeId[] = ['QL', 'DL', 'DR'];
    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 90 }),
        fc.integer({ min: 0, max: 20 }),
        fc.subarray(modes),
        fc.constantFrom<Level>(0, 1, 2, 3, 4, 5, 6),
        fc.boolean(),
        (budget, dayOffset, overdueModes, level, switching) => {
          const day = new Date(Date.UTC(2026, 8, 7 + dayOffset)).toISOString().slice(0, 10);
          const others = overdueModes.map((m, i) => info(m, 5, overdue(m, `2026-08-0${i + 1}`, i === 0)));
          const plan = planDay({ date: day, budgetMinutes: budget, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR', level), others, switching: { appropriate: switching, pair: ['QR', 'QL'], stage: 'paired' }, lastFatigue: null, idFor: ids });
          expect(plan.totalMinutes).toBeLessThanOrEqual(budget);
          if (plan.practiceDay) {
            expect(plan.blocks[0]?.kind).toBe('warmup');
            expect(plan.blocks.some((b) => b.kind === 'log')).toBe(true);
            expect(plan.blocks.every((b) => b.minutes > 0)).toBe(true);
            const scheduledModes = new Set(plan.blocks.map((b) => b.mode).filter(Boolean));
            expect(scheduledModes.size).toBeLessThanOrEqual(budget >= 45 ? 3 : 2);
          }
        },
      ),
    );
  });

  it('keeps edited plans within budget', () => {
    const plan = planDay({ date: '2026-09-07', budgetMinutes: 30, practiceWeekdays: [1, 2, 3, 4, 5], primary: info('QR'), others: [], switching: { appropriate: false, pair: null, stage: null }, lastFatigue: null, idFor: ids });
    const bigger = resizeBlock(plan, 'block-1', 60);
    expect(bigger.totalMinutes).toBe(30);
    const smaller = removeBlock(plan, 'block-2');
    expect(smaller.totalMinutes).toBe(20);
    expect(removeBlock(plan, 'block-4').blocks.some((b) => b.kind === 'log')).toBe(true);
  });
});
