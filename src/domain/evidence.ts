// Evidence rules (docs/training-protocol.md "Gates and evidence",
// docs/measurement.md "Benchmark sets and eligibility").
//
// * A set is formed by the first three technically valid trials of a
//   benchmark set attempt; the user cannot pick the best three afterwards.
// * Medians are reported per metric, but a gate needs at least two of the
//   three trials to pass speed AND accuracy jointly.
// * No-look qualification needs zero declared glances on every trial, no
//   keymap/finger assistance observed, no unrecorded assistance, and the
//   designated hand. Unknown or unanswered declarations leave it pending.
// * Acquisition-type gates use the first complete set per local date within
//   one comparison series; the latest three daily sets must all pass.
import defaults from '../../config/training-defaults.json';
import type { ModeId } from './modes';
import type { BenchmarkSetRecord, GlanceDeclaration, MilestoneKind, MilestoneRecord, TrialRecord } from './records';
import { Fraction, median } from './scoring/fraction';
import { accuracyMeets, wpmMeets } from './scoring/rational';
import { daysBetween } from './time';
import { BENCHMARK_DURATION_MS, protocolById } from './versions';

export interface Gate {
  readonly kind: MilestoneKind;
  readonly wpm: string;
  readonly accuracyPercent: string;
  /** Distinct local dates (daily reference sets) required. */
  readonly dates: number;
  readonly label: string | null;
}

export const GATES: Readonly<Record<MilestoneKind, Gate>> = {
  advance: { kind: 'advance', wpm: String(defaults.gates.advance.wpm), accuracyPercent: String(defaults.gates.advance.accuracyPercent), dates: defaults.gates.advance.distinctLocalDates, label: null },
  acquired: { kind: 'acquired', wpm: String(defaults.gates.acquired.wpm), accuracyPercent: String(defaults.gates.acquired.accuracyPercent), dates: defaults.gates.acquired.distinctLocalDates, label: null },
  strong: { kind: 'strong', wpm: String(defaults.gates.strong.wpm), accuracyPercent: String(defaults.gates.strong.accuracyPercent), dates: defaults.gates.strong.distinctLocalDates, label: null },
  showcase: { kind: 'showcase', wpm: String(defaults.gates.showcase.wpm), accuracyPercent: String(defaults.gates.showcase.accuracyPercent), dates: defaults.gates.showcase.distinctLocalDates, label: null },
};

export const STABILITY_MAX_AGE_DAYS = defaults.gates.coreCompletion.latestSetMaxAgeDays;
export const JOINT_PASSES_REQUIRED = defaults.benchmark.jointPassingTrialsRequired;
export const TRIALS_PER_SET = defaults.benchmark.trialsPerSet;

export function showcaseGate(target: { wpm: number; accuracyPercent: number; label: string } | null): Gate {
  if (!target) return GATES.showcase;
  return { kind: 'showcase', wpm: String(target.wpm), accuracyPercent: String(target.accuracyPercent), dates: GATES.showcase.dates, label: target.label };
}

// ---------------------------------------------------------------- trials

/** Completed, full-length, reference-protocol, native, with no invalidity. */
export function isTechnicallyValid(trial: TrialRecord): boolean {
  const protocol = protocolById(trial.protocolId);
  return (
    !!protocol &&
    protocol.reference &&
    trial.reference &&
    trial.verification !== 'unverified' &&
    trial.status === 'completed' &&
    trial.invalidity.length === 0 &&
    trial.timing.mode === 'fixed' &&
    trial.activeMs === trial.timing.durationMs &&
    trial.counters.attempts > 0
  );
}

export function trialWpm(trial: Pick<TrialRecord, 'counters' | 'activeMs'>): Fraction | null {
  if (trial.activeMs === null || trial.activeMs <= 0 || !Number.isInteger(trial.activeMs)) return null;
  return Fraction.wpm(trial.counters.finalCorrect, trial.activeMs);
}

export function trialRawWpm(trial: Pick<TrialRecord, 'counters' | 'activeMs'>): Fraction | null {
  if (trial.activeMs === null || trial.activeMs <= 0 || !Number.isInteger(trial.activeMs)) return null;
  return Fraction.wpm(trial.counters.attempts, trial.activeMs);
}

export function trialAccuracy(trial: Pick<TrialRecord, 'counters'>): Fraction | null {
  return trial.counters.attempts > 0 ? Fraction.accuracy(trial.counters.attemptsCorrect, trial.counters.attempts) : null;
}

export function jointPass(trial: TrialRecord, gate: Pick<Gate, 'wpm' | 'accuracyPercent'>): boolean {
  const ms = trial.activeMs ?? 0;
  return wpmMeets(trial.counters.finalCorrect, ms, gate.wpm) && accuracyMeets(trial.counters.attemptsCorrect, trial.counters.attempts, gate.accuracyPercent);
}

export type ReasonCode =
  | 'incomplete-set'
  | 'wrong-hand'
  | 'declarations-unanswered'
  | 'glances-unknown'
  | 'glances'
  | 'assistance'
  | 'unrecorded-assistance'
  | 'speed'
  | 'accuracy'
  | 'joint';

export interface Reason {
  readonly code: ReasonCode;
  readonly message: string;
}

export function glanceCount(g: GlanceDeclaration | null): number | null {
  if (!g || g.kind === 'unknown') return null;
  return g.count;
}

/** Keymap/finger assistance observed automatically during the trial. */
export function assistanceObserved(trial: TrialRecord): boolean {
  const a = trial.assistance;
  return a.initial !== 'none' || a.revealed || a.shown.some((level) => level !== 'none');
}

export type Tri = 'pass' | 'fail' | 'pending';

export interface NoLookResult {
  readonly status: Tri;
  readonly reasons: readonly Reason[];
}

export function trialNoLook(trial: TrialRecord): NoLookResult {
  const reasons: Reason[] = [];
  let pending = false;
  const d = trial.declarations;
  if (assistanceObserved(trial)) reasons.push({ code: 'assistance', message: 'Keymap assistance was shown during the trial.' });
  if (d.unrecordedAssistance === true) reasons.push({ code: 'unrecorded-assistance', message: 'Other assistance was reported.' });
  if (d.glances === null) pending = true;
  else if (d.glances.kind === 'unknown') pending = true;
  else if (d.glances.count > 0) reasons.push({ code: 'glances', message: `${d.glances.kind === 'at-least' ? 'At least ' : ''}${d.glances.count} physical glance${d.glances.count === 1 ? '' : 's'} declared.` });
  else if (d.glances.kind === 'at-least') pending = true;
  if (d.unrecordedAssistance === null || d.hand === null) pending = true;
  if (reasons.length > 0) return { status: 'fail', reasons };
  return { status: pending ? 'pending' : 'pass', reasons };
}

// ------------------------------------------------------------------ sets

export interface SetEvaluation {
  readonly set: BenchmarkSetRecord;
  readonly attempts: readonly TrialRecord[];
  readonly contributing: readonly TrialRecord[];
  readonly complete: boolean;
  /** A trial reported with the other hand: not reference evidence for this mode. */
  readonly excluded: boolean;
  /** Every contributing trial has answered declarations (unknown counts as answered). */
  readonly declarationsAnswered: boolean;
  readonly medianWpm: Fraction | null;
  readonly medianRawWpm: Fraction | null;
  readonly medianAccuracy: Fraction | null;
  readonly noLook: NoLookResult;
  readonly localDate: string;
  readonly signatureHash: string;
  readonly createdAt: string;
}

export function evaluateSet(set: BenchmarkSetRecord, trialsById: ReadonlyMap<string, TrialRecord>): SetEvaluation {
  const attempts = set.trialIds.map((id) => trialsById.get(id)).filter((t): t is TrialRecord => !!t);
  const contributing = attempts.filter(isTechnicallyValid).slice(0, TRIALS_PER_SET);
  const complete = contributing.length === TRIALS_PER_SET;
  const excluded = contributing.some((t) => t.declarations.hand === 'other');
  const declarationsAnswered = contributing.every(
    (t) => t.declarations.glances !== null && t.declarations.hand !== null && t.declarations.unrecordedAssistance !== null,
  );
  const wpms = contributing.map(trialWpm).filter((f): f is Fraction => f !== null);
  const raws = contributing.map(trialRawWpm).filter((f): f is Fraction => f !== null);
  const accs = contributing.map(trialAccuracy).filter((f): f is Fraction => f !== null);
  const reasons: Reason[] = [];
  let pending = false;
  for (const trial of contributing) {
    const r = trialNoLook(trial);
    if (r.status === 'pending') pending = true;
    for (const reason of r.reasons) if (!reasons.some((x) => x.code === reason.code)) reasons.push(reason);
  }
  const noLook: NoLookResult = reasons.length > 0 ? { status: 'fail', reasons } : { status: pending || !complete ? 'pending' : 'pass', reasons };
  return {
    set,
    attempts,
    contributing,
    complete,
    excluded,
    declarationsAnswered,
    medianWpm: complete ? median(wpms) : null,
    medianRawWpm: complete ? median(raws) : null,
    medianAccuracy: complete ? median(accs) : null,
    noLook,
    localDate: set.localDate,
    signatureHash: set.signatureHash,
    createdAt: set.createdAt,
  };
}

export interface GateResult {
  readonly status: Tri;
  readonly jointPasses: number;
  readonly reasons: readonly Reason[];
  /** Per-trial joint pass, in contributing order. */
  readonly perTrial: readonly boolean[];
}

/** Whether a set meets a gate: joint two-of-three pass plus no-look. */
export function qualify(evaluation: SetEvaluation, gate: Pick<Gate, 'wpm' | 'accuracyPercent'>): GateResult {
  if (!evaluation.complete) {
    return { status: 'fail', jointPasses: 0, perTrial: [], reasons: [{ code: 'incomplete-set', message: `Only ${evaluation.contributing.length} of ${TRIALS_PER_SET} trials are valid.` }] };
  }
  if (evaluation.excluded) {
    return { status: 'fail', jointPasses: 0, perTrial: [], reasons: [{ code: 'wrong-hand', message: 'A trial was reported with the other hand; the set is not evidence for this mode.' }] };
  }
  const perTrial = evaluation.contributing.map((t) => jointPass(t, gate));
  const jointPasses = perTrial.filter(Boolean).length;
  const reasons: Reason[] = [];
  if (jointPasses < JOINT_PASSES_REQUIRED) {
    const speedShort = evaluation.contributing.filter((t) => !wpmMeets(t.counters.finalCorrect, t.activeMs ?? 0, gate.wpm)).length;
    const accShort = evaluation.contributing.filter((t) => !accuracyMeets(t.counters.attemptsCorrect, t.counters.attempts, gate.accuracyPercent)).length;
    if (speedShort > TRIALS_PER_SET - JOINT_PASSES_REQUIRED) reasons.push({ code: 'speed', message: `Speed was below ${gate.wpm} WPM on ${speedShort} of ${TRIALS_PER_SET} trials.` });
    if (accShort > TRIALS_PER_SET - JOINT_PASSES_REQUIRED) reasons.push({ code: 'accuracy', message: `Accuracy was below ${gate.accuracyPercent}% on ${accShort} of ${TRIALS_PER_SET} trials.` });
    reasons.push({ code: 'joint', message: `${jointPasses} of ${TRIALS_PER_SET} trials passed both thresholds; ${JOINT_PASSES_REQUIRED} are needed.` });
  }
  reasons.push(...evaluation.noLook.reasons);
  if (!evaluation.declarationsAnswered) reasons.push({ code: 'declarations-unanswered', message: 'Declarations are still pending.' });
  else if (evaluation.noLook.status === 'pending') reasons.push({ code: 'glances-unknown', message: 'The glance count is unknown, so no-look qualification is pending.' });
  const measurableFail = jointPasses < JOINT_PASSES_REQUIRED || evaluation.noLook.status === 'fail';
  const status: Tri = measurableFail ? 'fail' : evaluation.noLook.status === 'pending' ? 'pending' : 'pass';
  return { status, jointPasses, perTrial, reasons };
}

/**
 * The first complete set on each local date, within one series. Sets with a
 * wrong-hand report are not evidence for the mode and are skipped. Later sets
 * on the same date stay in history but never replace the day's reference set.
 */
export function dailyReferenceSets(evaluations: readonly SetEvaluation[]): SetEvaluation[] {
  const sorted = [...evaluations]
    .filter((e) => e.complete && !e.excluded)
    .sort((a, b) => (a.localDate === b.localDate ? a.createdAt.localeCompare(b.createdAt) : a.localDate.localeCompare(b.localDate)));
  const byDate = new Map<string, SetEvaluation>();
  for (const e of sorted) if (!byDate.has(e.localDate)) byDate.set(e.localDate, e);
  return [...byDate.values()];
}

function groupBySeries(evaluations: readonly SetEvaluation[]): Map<string, SetEvaluation[]> {
  const series = new Map<string, SetEvaluation[]>();
  for (const e of evaluations) {
    const list = series.get(e.signatureHash) ?? [];
    list.push(e);
    series.set(e.signatureHash, list);
  }
  return series;
}

export interface MilestoneEvaluation {
  readonly kind: MilestoneKind;
  readonly gate: Gate;
  /** First point in history where the rule held, if ever. */
  readonly award: { readonly sets: readonly SetEvaluation[]; readonly localDate: string; readonly signatureHash: string } | null;
  /** Latest series: trailing consecutive passing daily sets (capped at the requirement). */
  readonly progress: number;
  readonly required: number;
  /** A pending daily set is blocking progress. */
  readonly pending: boolean;
  readonly latest: { readonly evaluation: SetEvaluation; readonly result: GateResult } | null;
}

/** Evaluate a milestone gate over one mode's reference-protocol sets. */
export function evaluateMilestone(evaluations: readonly SetEvaluation[], gate: Gate): MilestoneEvaluation {
  let award: MilestoneEvaluation['award'] = null;
  let latestSeries: SetEvaluation[] = [];
  let latestAt = '';
  for (const [hash, list] of groupBySeries(evaluations)) {
    const daily = dailyReferenceSets(list);
    const last = daily.at(-1);
    if (last && `${last.localDate}|${last.createdAt}` > latestAt) {
      latestAt = `${last.localDate}|${last.createdAt}`;
      latestSeries = daily;
    }
    for (let i = gate.dates - 1; i < daily.length; i += 1) {
      const window = daily.slice(i - gate.dates + 1, i + 1);
      if (window.every((e) => qualify(e, gate).status === 'pass')) {
        const candidate = { sets: window, localDate: (daily[i] as SetEvaluation).localDate, signatureHash: hash };
        if (!award || candidate.localDate < award.localDate) award = candidate;
        break;
      }
    }
  }
  let progress = 0;
  let pending = false;
  for (let i = latestSeries.length - 1; i >= 0 && progress < gate.dates; i -= 1) {
    const status = qualify(latestSeries[i] as SetEvaluation, gate).status;
    if (status === 'pass') progress += 1;
    else {
      if (status === 'pending' && i === latestSeries.length - 1) pending = true;
      break;
    }
  }
  const lastEval = latestSeries.at(-1);
  return {
    kind: gate.kind,
    gate,
    award,
    progress,
    required: gate.dates,
    pending,
    latest: lastEval ? { evaluation: lastEval, result: qualify(lastEval, gate) } : null,
  };
}

/** Build the immutable milestone record for an award. */
export function milestoneFromAward(
  id: string,
  mode: ModeId,
  evaluation: MilestoneEvaluation,
  awardedAt: string,
): MilestoneRecord | null {
  const award = evaluation.award;
  if (!award) return null;
  return {
    schemaVersion: 1,
    id,
    mode,
    kind: evaluation.kind,
    target: { wpm: evaluation.gate.wpm, accuracyPercent: evaluation.gate.accuracyPercent, label: evaluation.gate.label },
    protocolId: award.sets[0]?.set.protocolId ?? '',
    gateRules: `first set per local date; latest ${evaluation.gate.dates} pass; ${JOINT_PASSES_REQUIRED} of ${TRIALS_PER_SET} joint; no looking`,
    awardedAt,
    awardedLocalDate: award.localDate,
    signatureHash: award.signatureHash,
    setIds: award.sets.map((s) => s.set.id),
    trialIds: award.sets.flatMap((s) => s.contributing.map((t) => t.id)),
    evaluation: award.sets.map((s) => ({
      setId: s.set.id,
      localDate: s.localDate,
      medianWpm: s.medianWpm?.format(2) ?? 'null',
      medianAccuracy: s.medianAccuracy?.format(4) ?? 'null',
      jointPasses: qualify(s, evaluation.gate).jointPasses,
    })),
    origin: 'native-run',
  };
}

// ------------------------------------------------------------- stability

export interface StabilityResult {
  readonly status: 'stable' | 'not-stable' | 'no-evidence';
  readonly latest: SetEvaluation | null;
  readonly ageDays: number | null;
  readonly reasons: readonly Reason[];
  readonly result: GateResult | null;
}

/** The latest eligible set must pass 30/98 with no looking and be at most 14 days old. */
export function currentStability(evaluations: readonly SetEvaluation[], today: string): StabilityResult {
  const eligible = evaluations
    .filter((e) => e.complete && !e.excluded && e.declarationsAnswered)
    .sort((a, b) => (a.localDate === b.localDate ? a.createdAt.localeCompare(b.createdAt) : a.localDate.localeCompare(b.localDate)));
  const latest = eligible.at(-1) ?? null;
  if (!latest) return { status: 'no-evidence', latest: null, ageDays: null, reasons: [], result: null };
  const ageDays = daysBetween(latest.localDate, today);
  const result = qualify(latest, GATES.acquired);
  const reasons: Reason[] = [...(result.status === 'pass' ? [] : result.reasons)];
  if (ageDays > STABILITY_MAX_AGE_DAYS) reasons.push({ code: 'incomplete-set', message: `The latest eligible set is ${ageDays} days old; stability needs one within ${STABILITY_MAX_AGE_DAYS} days.` });
  return { status: result.status === 'pass' && ageDays <= STABILITY_MAX_AGE_DAYS ? 'stable' : 'not-stable', latest, ageDays, reasons, result };
}

/** Reference-protocol sets for one mode, evaluated. */
export function modeSetEvaluations(
  mode: ModeId,
  sets: readonly BenchmarkSetRecord[],
  trialsById: ReadonlyMap<string, TrialRecord>,
  protocolId = 'english-prose-60-v1',
): SetEvaluation[] {
  return sets.filter((s) => s.mode === mode && s.protocolId === protocolId).map((s) => evaluateSet(s, trialsById));
}

export interface CoreCompletionCheck {
  readonly ready: boolean;
  readonly perMode: Readonly<Record<string, { readonly acquired: boolean; readonly stability: StabilityResult }>>;
  readonly missing: readonly string[];
}

export function checkCoreCompletion(
  coreModes: readonly ModeId[],
  acquiredModes: ReadonlySet<ModeId>,
  evaluationsByMode: ReadonlyMap<ModeId, readonly SetEvaluation[]>,
  today: string,
): CoreCompletionCheck {
  const perMode: Record<string, { acquired: boolean; stability: StabilityResult }> = {};
  const missing: string[] = [];
  for (const mode of coreModes) {
    const stability = currentStability(evaluationsByMode.get(mode) ?? [], today);
    const acquired = acquiredModes.has(mode);
    perMode[mode] = { acquired, stability };
    if (!acquired) missing.push(`${mode} is not acquired yet.`);
    else if (stability.status !== 'stable') missing.push(`${mode} needs a current passing set (within ${STABILITY_MAX_AGE_DAYS} days).`);
  }
  return { ready: missing.length === 0, perMode, missing };
}

/** A 60-second reference duration check used by UI summaries. */
export const REFERENCE_DURATION_MS = BENCHMARK_DURATION_MS;
