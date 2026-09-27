// Maintenance and retention (docs/training-protocol.md, "Maintenance";
// docs/measurement.md reference examples).
//
// Baseline: mean of the three set-median WPM values that supported the
// acquisition milestone, in its comparison series; frozen once awarded.
// Current: mean of the latest three comparable set medians.
// Two weekly slots when 1 − current/baseline > 0.15 (compared exactly as
// 100·current < 85·baseline) or when recent accuracy is below 98%.
import defaults from '../../config/training-defaults.json';
import type { SetEvaluation } from './evidence';
import type { ModeId } from './modes';
import type { MilestoneRecord } from './records';
import { Fraction, mean } from './scoring/fraction';
import { daysBetween, isoWeekday } from './time';

const M = defaults.maintenance;
export const ROLLING_SETS = M.rollingComparableSets;
export const ACCURACY_FLOOR = Fraction.decimal(M.accuracyFloorPercent);
const LOSS_LIMIT = Fraction.decimal(String(M.increaseWhenSpeedLossFractionGreaterThan));
const RETENTION_LIMIT = Fraction.decimal(String(M.retentionPassSpeedLossFractionLessThan));
export const RETENTION_BREAK_DAYS = M.retentionBreakMinimumDays;

export type MaintenanceKind = 'primary' | 'none' | 'pre-acquisition' | 'acquired' | 'increased';

export interface Baseline {
  readonly value: Fraction;
  readonly setIds: readonly string[];
  readonly signatureHash: string;
}

export interface MaintenanceStatus {
  readonly mode: ModeId;
  readonly kind: MaintenanceKind;
  readonly slotsPerWeek: number;
  readonly slotMinutes: number;
  readonly baseline: Baseline | null;
  readonly current: { readonly value: Fraction; readonly setIds: readonly string[] } | null;
  /** 1 − current / baseline; null without sufficient evidence. */
  readonly loss: Fraction | null;
  readonly evidence: 'sufficient' | 'insufficient' | 'not-applicable';
  readonly triggers: readonly ('speed-loss' | 'accuracy')[];
  readonly doneThisWeek: number;
  readonly due: boolean;
  readonly overdueDays: number;
  readonly remainingThisWeek: number;
  readonly lastPracticed: string | null;
  readonly daysSincePractice: number | null;
  readonly slotDays: readonly number[];
  readonly message: string;
}

/** Frozen acquisition baseline from the milestone's own sets. */
export function acquisitionBaseline(milestone: MilestoneRecord, evaluations: readonly SetEvaluation[]): Baseline | null {
  const byId = new Map(evaluations.map((e) => [e.set.id, e]));
  const medians = milestone.setIds.map((id) => byId.get(id)?.medianWpm ?? null);
  if (medians.some((m) => m === null) || medians.length === 0) return null;
  const value = mean(medians as Fraction[]);
  return value ? { value, setIds: milestone.setIds, signatureHash: milestone.signatureHash } : null;
}

function sortSets(list: readonly SetEvaluation[]): SetEvaluation[] {
  return [...list].sort((a, b) => (a.localDate === b.localDate ? a.createdAt.localeCompare(b.createdAt) : a.localDate.localeCompare(b.localDate)));
}

/** Latest three complete, same-series sets (their medians are measurements, whatever the declarations). */
export function latestComparable(evaluations: readonly SetEvaluation[], signatureHash: string, count = ROLLING_SETS): SetEvaluation[] {
  return sortSets(evaluations.filter((e) => e.complete && !e.excluded && e.signatureHash === signatureHash && e.medianWpm !== null)).slice(-count);
}

/** Exact comparison: is the loss strictly greater than the limit? 100·current < 85·baseline for 15%. */
export function lossExceeds(current: Fraction, baseline: Fraction, limit: Fraction = LOSS_LIMIT): boolean {
  return current.lt(baseline.mul(Fraction.of(1).sub(limit)));
}

export function lossFraction(current: Fraction, baseline: Fraction): Fraction | null {
  if (baseline.isZero()) return null;
  return Fraction.of(1).sub(current.div(baseline));
}

/** Weekday slots for n maintenance slots, preferring Wednesday, then Friday, Monday, Thursday, Tuesday. */
export function slotDays(slots: number, practiceWeekdays: readonly number[]): number[] {
  const preference = [3, 5, 1, 4, 2, 6, 7];
  const days = preference.filter((d) => practiceWeekdays.includes(d)).slice(0, slots);
  return days.sort((a, b) => a - b);
}

export interface MaintenanceInput {
  readonly mode: ModeId;
  readonly isPrimary: boolean;
  readonly advanced: boolean;
  readonly acquired: MilestoneRecord | null;
  readonly evaluations: readonly SetEvaluation[];
  readonly lastPracticed: string | null;
  /** Maintenance slots already completed in the current ISO week. */
  readonly doneThisWeek: number;
  readonly today: string;
  readonly practiceWeekdays: readonly number[];
}

export function maintenanceStatus(input: MaintenanceInput): MaintenanceStatus {
  const daysSincePractice = input.lastPracticed ? daysBetween(input.lastPracticed, input.today) : null;
  const common = { mode: input.mode, lastPracticed: input.lastPracticed, daysSincePractice, doneThisWeek: input.doneThisWeek };
  if (input.isPrimary && !input.acquired) {
    return { ...common, kind: 'primary', slotsPerWeek: 0, slotMinutes: 0, baseline: null, current: null, loss: null, evidence: 'not-applicable', triggers: [], due: false, overdueDays: 0, remainingThisWeek: 0, slotDays: [], message: 'Primary mode — practised every session, not maintained.' };
  }
  if (!input.acquired && !input.advanced) {
    return { ...common, kind: 'none', slotsPerWeek: 0, slotMinutes: 0, baseline: null, current: null, loss: null, evidence: 'not-applicable', triggers: [], due: false, overdueDays: 0, remainingThisWeek: 0, slotDays: [], message: 'Nothing to maintain yet.' };
  }
  let kind: MaintenanceKind;
  let slots: number;
  let baseline: Baseline | null = null;
  let current: MaintenanceStatus['current'] = null;
  let loss: Fraction | null = null;
  let evidence: MaintenanceStatus['evidence'] = 'not-applicable';
  const triggers: ('speed-loss' | 'accuracy')[] = [];
  let message: string;
  if (!input.acquired) {
    kind = 'pre-acquisition';
    slots = M.unacquiredAdvancedSlotsPerWeek;
    message = `${slots} five-minute slots weekly until acquired.`;
  } else {
    baseline = acquisitionBaseline(input.acquired, input.evaluations);
    const recent = baseline ? latestComparable(input.evaluations, baseline.signatureHash) : [];
    if (baseline && !baseline.value.isZero() && recent.length >= ROLLING_SETS) {
      evidence = 'sufficient';
      const value = mean(recent.map((e) => e.medianWpm as Fraction)) as Fraction;
      current = { value, setIds: recent.map((e) => e.set.id) };
      loss = lossFraction(value, baseline.value);
      if (lossExceeds(value, baseline.value)) triggers.push('speed-loss');
      if (recent.some((e) => e.medianAccuracy !== null && e.medianAccuracy.lt(ACCURACY_FLOOR))) triggers.push('accuracy');
    } else {
      evidence = 'insufficient';
    }
    // The latest eligible set's accuracy triggers extra maintenance on its own.
    const latestEligible = sortSets(input.evaluations.filter((e) => e.complete && !e.excluded)).at(-1);
    if (latestEligible?.medianAccuracy && latestEligible.medianAccuracy.lt(ACCURACY_FLOOR) && !triggers.includes('accuracy')) triggers.push('accuracy');
    if (triggers.length > 0) {
      kind = 'increased';
      slots = M.increasedSlotsPerWeek;
      message = triggers.includes('speed-loss')
        ? `Speed is more than ${LOSS_LIMIT.mul(100).format(0)}% below the acquisition baseline; two slots weekly until it recovers.`
        : 'Recent accuracy is below 98%; two slots weekly until the latest three sets are back at 98%.';
    } else {
      kind = 'acquired';
      slots = M.acquiredSlotsPerWeek;
      message = evidence === 'insufficient' ? 'One slot weekly. Insufficient evidence for a decline check yet.' : 'One slot weekly; the latest sets are within 15% of baseline.';
    }
  }
  const days = slotDays(slots, input.practiceWeekdays);
  const weekday = isoWeekday(input.today);
  const dueByToday = days.filter((d) => d <= weekday).length;
  const due = dueByToday > input.doneThisWeek;
  const nextUnmet = days[input.doneThisWeek];
  const overdueDays = due && nextUnmet !== undefined ? weekday - nextUnmet : 0;
  return {
    ...common,
    kind,
    slotsPerWeek: slots,
    slotMinutes: input.acquired ? M.preferredBenchmarkSlotMinutes : (M.slotMinutesRange[0] as number),
    baseline,
    current,
    loss,
    evidence,
    triggers,
    due,
    overdueDays,
    remainingThisWeek: Math.max(0, slots - input.doneThisWeek),
    slotDays: days,
    message,
  };
}

/** Regressing modes first, then most overdue, then least recently practised. */
export function maintenancePriority(a: MaintenanceStatus, b: MaintenanceStatus): number {
  const reg = Number(b.kind === 'increased') - Number(a.kind === 'increased');
  if (reg !== 0) return reg;
  if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
  const la = a.lastPracticed ?? '';
  const lb = b.lastPracticed ?? '';
  return la.localeCompare(lb);
}

export interface RetentionResult {
  readonly status: 'pass' | 'fail' | 'pending';
  readonly breakFrom: string;
  readonly breakDays: number;
  readonly set: SetEvaluation;
  readonly loss: Fraction | null;
  readonly accuracy: Fraction | null;
  readonly reasons: readonly string[];
}

/**
 * Retention checks after acquisition: the first eligible benchmark set after
 * at least seven full days without any practice in the mode, compared with
 * the frozen baseline. It passes with loss < 15% and median accuracy ≥ 98%.
 * `practice` lists every practised instant (local date + ISO time) of the mode.
 */
export function retentionChecks(
  acquired: MilestoneRecord,
  baseline: Baseline | null,
  evaluations: readonly SetEvaluation[],
  practice: readonly { readonly localDate: string; readonly at: string; readonly setId: string | null }[],
): RetentionResult[] {
  const results: RetentionResult[] = [];
  const sessions = [...practice].sort((a, b) => a.at.localeCompare(b.at));
  const byId = new Map(evaluations.map((e) => [e.set.id, e]));
  for (let i = 1; i < sessions.length; i += 1) {
    const prev = sessions[i - 1] as (typeof sessions)[number];
    const next = sessions[i] as (typeof sessions)[number];
    if (prev.localDate < acquired.awardedLocalDate) continue;
    const idleDays = daysBetween(prev.localDate, next.localDate) - 1;
    if (idleDays < RETENTION_BREAK_DAYS) continue;
    // The first activity after the break must itself be the benchmark set.
    const set = next.setId ? byId.get(next.setId) : undefined;
    if (!set || !set.complete || set.excluded) continue;
    const reasons: string[] = [];
    let status: RetentionResult['status'] = 'pass';
    let loss: Fraction | null = null;
    if (!baseline || set.medianWpm === null) {
      status = 'pending';
      reasons.push('No acquisition baseline to compare with.');
    } else {
      loss = lossFraction(set.medianWpm, baseline.value);
      // "Less than 15% loss": current / baseline must exceed 0.85 strictly.
      if (!set.medianWpm.gt(baseline.value.mul(Fraction.of(1).sub(RETENTION_LIMIT)))) {
        status = 'fail';
        reasons.push('Speed loss is 15% or more.');
      }
    }
    if (set.medianAccuracy === null || set.medianAccuracy.lt(ACCURACY_FLOOR)) {
      status = 'fail';
      reasons.push('Median accuracy is below 98%.');
    }
    if (status === 'pass' && set.noLook.status === 'pending') status = 'pending';
    results.push({ status, breakFrom: prev.localDate, breakDays: idleDays, set, loss, accuracy: set.medianAccuracy, reasons });
  }
  return results;
}

