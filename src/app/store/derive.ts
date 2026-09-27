// Pure derived views over the loaded records. Nothing here is stored as
// truth: gates, maintenance and plans are recomputed from canonical records.
import { type Level, levelDefinition } from '../../domain/curriculum';
import {
  checkCoreCompletion,
  currentStability,
  evaluateMilestone,
  GATES,
  type Gate,
  milestoneFromAward,
  type MilestoneEvaluation,
  modeSetEvaluations,
  type SetEvaluation,
  showcaseGate,
  type StabilityResult,
} from '../../domain/evidence';
import { geometryById } from '../../domain/layouts/geometry';
import { type LayoutDefinition, type LayoutId, layoutById } from '../../domain/layouts/registry';
import { checkTeachingLevel, type LevelCheck, levelFromMilestones } from '../../domain/levels';
import { maintenanceStatus, type MaintenanceStatus } from '../../domain/maintenance';
import { CORE_MODES, EXPANSION_MODES, layoutForMode, type ModeId, modeById } from '../../domain/modes';
import type { ModePlanInfo } from '../../domain/planner';
import type {
  CalibrationRecord,
  CoreCompletionRecord,
  FingeringLedger,
  KeyboardSetup,
  MilestoneKind,
  MilestoneRecord,
  ModeState,
  Profile,
  TrialRecord,
} from '../../domain/records';
import { evidenceStage, recommendedPrimary, type ModeStanding } from '../../domain/roadmap';
import { switchingStage } from '../../domain/switching';
import { weekStart } from '../../domain/time';
import type { Snapshot } from '../../storage/repo';

export const CORE_IDS: readonly ModeId[] = CORE_MODES.map((m) => m.id);
export const EXPANSION_IDS: readonly ModeId[] = EXPANSION_MODES.map((m) => m.id);

/** The benchmark protocol whose sets are a mode's reference evidence. */
export function benchmarkProtocolFor(mode: ModeId): string {
  return modeById(mode).inputPath === 'emulated' ? 'emulated-half-qwerty-prose-60-v1' : 'english-prose-60-v1';
}

export function currentSetup(setups: readonly KeyboardSetup[]): KeyboardSetup | null {
  let best: KeyboardSetup | null = null;
  for (const s of setups) if (!best || s.createdAt > best.createdAt || (s.createdAt === best.createdAt && s.revision > best.revision)) best = s;
  return best;
}

export function currentLedger(ledgers: readonly FingeringLedger[], mode: ModeId, setupId: string | null): FingeringLedger | null {
  let best: FingeringLedger | null = null;
  for (const l of ledgers) {
    if (l.mode !== mode || (setupId !== null && l.setupId !== setupId)) continue;
    if (!best || l.revision > best.revision) best = l;
  }
  return best;
}

export function ledgerHistory(ledgers: readonly FingeringLedger[], mode: ModeId, setupId: string | null): FingeringLedger[] {
  return ledgers.filter((l) => l.mode === mode && (setupId === null || l.setupId === setupId)).sort((a, b) => b.revision - a.revision);
}

export function layoutFor(mode: ModeId, setup: KeyboardSetup | null): LayoutDefinition {
  return layoutById(layoutForMode(modeById(mode), setup?.qwertyLayoutId ?? 'qwerty-us-intl'));
}

export type CalibrationState =
  | { readonly status: 'none' }
  | { readonly status: 'failed'; readonly record: CalibrationRecord }
  | { readonly status: 'incomplete'; readonly record: CalibrationRecord }
  | { readonly status: 'probe-required'; readonly record: CalibrationRecord; readonly reason: string }
  | { readonly status: 'fresh'; readonly record: CalibrationRecord };

/**
 * Calibration freshness for a layout under the current setup revision. Full
 * calibration is needed once per setup revision (a setup edit creates one);
 * a browser restart or a detected mapping inconsistency needs the short probe.
 */
export function calibrationState(calibrations: readonly CalibrationRecord[], setup: KeyboardSetup | null, layoutId: LayoutId, browserSession: string): CalibrationState {
  if (!setup) return { status: 'none' };
  const mine = calibrations.filter((c) => c.setupRevisionId === setup.id && c.layoutId === layoutId).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const full = mine.filter((c) => c.kind === 'full');
  const lastFull = full.at(-1);
  if (!lastFull) return { status: 'none' };
  if (lastFull.status === 'failed') return { status: 'failed', record: lastFull };
  const passedFull = [...full].reverse().find((c) => c.status === 'passed');
  if (!passedFull) return { status: 'incomplete', record: lastFull };
  const after = mine.filter((c) => c.completedAt > passedFull.completedAt);
  const latest = after.at(-1) ?? passedFull;
  if (latest.kind === 'probe' && latest.status !== 'passed') return { status: 'probe-required', record: latest, reason: 'The last check found characters that disagreed with the map.' };
  if (latest.browserSessionId !== browserSession) return { status: 'probe-required', record: latest, reason: 'The browser restarted since the last check.' };
  return { status: 'fresh', record: latest };
}

function emulatedCalibration(setup: KeyboardSetup | null): CalibrationState {
  if (!setup) return { status: 'none' };
  const now = new Date(0).toISOString();
  return {
    status: 'fresh',
    record: { schemaVersion: 1, id: 'emulated', setupRevisionId: setup.id, layoutId: 'qwerty-us', layoutRevision: 1, geometryId: setup.geometryId, kind: 'probe', startedAt: now, completedAt: now, status: 'passed', checked: 0, matched: 0, results: [], identified: [], browserSessionId: '', browser: '', absent: [] },
  };
}

export function isCalibrated(state: CalibrationState): boolean {
  return state.status === 'fresh';
}

export interface ModeOverview {
  readonly mode: ModeId;
  readonly state: ModeState | null;
  readonly level: Level;
  readonly started: boolean;
  readonly layout: LayoutDefinition;
  readonly calibration: CalibrationState;
  readonly ledger: FingeringLedger | null;
  readonly evaluations: readonly SetEvaluation[];
  readonly milestones: readonly MilestoneRecord[];
  readonly gates: Readonly<Record<MilestoneKind, MilestoneEvaluation>>;
  readonly stability: StabilityResult;
  readonly lastPracticed: string | null;
  readonly latestSet: SetEvaluation | null;
  readonly teaching: LevelCheck | null;
  readonly trials: readonly TrialRecord[];
}

export function hasMilestone(milestones: readonly MilestoneRecord[], mode: ModeId, kind: MilestoneKind): MilestoneRecord | null {
  return milestones.find((m) => m.mode === mode && m.kind === kind) ?? null;
}

function sortEvals(list: readonly SetEvaluation[]): SetEvaluation[] {
  return [...list].sort((a, b) => (a.localDate === b.localDate ? a.createdAt.localeCompare(b.createdAt) : a.localDate.localeCompare(b.localDate)));
}

export function gateFor(kind: MilestoneKind, profile: Profile | null): Gate {
  return kind === 'showcase' ? showcaseGate(profile?.showcaseTarget ?? null) : GATES[kind];
}

export function modeOverview(data: Snapshot, mode: ModeId, today: string, browserSession: string): ModeOverview {
  const setup = currentSetup(data.setups);
  const layout = layoutFor(mode, setup);
  const trialsById = new Map(data.trials.map((t) => [t.id, t]));
  const evaluations = modeSetEvaluations(mode, data.sets, trialsById, benchmarkProtocolFor(mode));
  const trials = data.trials.filter((t) => t.mode === mode);
  const state = data.modeStates.find((s) => s.mode === mode) ?? null;
  let lastPracticed: string | null = null;
  for (const t of trials) if (t.status !== 'running' && t.status !== 'aborted' && (!lastPracticed || t.localDate > lastPracticed)) lastPracticed = t.localDate;
  const milestones = data.milestones.filter((m) => m.mode === mode);
  const kinds: MilestoneKind[] = ['advance', 'acquired', 'strong', 'showcase'];
  const gates = Object.fromEntries(kinds.map((k) => [k, evaluateMilestone(evaluations, gateFor(k, data.profile))])) as Record<MilestoneKind, MilestoneEvaluation>;
  const level = state?.level ?? 0;
  return {
    mode,
    state,
    level,
    started: !!state?.startedAt,
    layout,
    // The emulated path reads physical positions only; it needs no OS-layout calibration.
    calibration: modeById(mode).inputPath === 'emulated' ? emulatedCalibration(setup) : calibrationState(data.calibrations, setup, layout.id, browserSession),
    ledger: currentLedger(data.ledgers, mode, setup?.setupId ?? null),
    evaluations,
    milestones,
    gates,
    stability: currentStability(evaluations, today),
    lastPracticed,
    latestSet: sortEvals(evaluations.filter((e) => e.complete && !e.excluded)).at(-1) ?? null,
    teaching: state && level <= 3 ? checkTeachingLevel(level, trials, state) : null,
    trials,
  };
}

export function allOverviews(data: Snapshot, today: string, browserSession: string): Map<ModeId, ModeOverview> {
  const map = new Map<ModeId, ModeOverview>();
  const modes = data.core.length > 0 ? [...CORE_IDS, 'Q2' as ModeId, ...EXPANSION_IDS] : [...CORE_IDS, 'Q2' as ModeId];
  for (const mode of modes) map.set(mode, modeOverview(data, mode, today, browserSession));
  return map;
}

/** Maintenance slots completed this ISO week: maintenance blocks, or 5+ minutes of the mode in a session. */
export function maintenanceDone(data: Snapshot, mode: ModeId, today: string): number {
  const start = weekStart(today);
  const days = new Set<string>();
  for (const session of data.sessions) {
    if (session.localDate < start || session.localDate > today) continue;
    const minutes = session.blocks.filter((b) => b.mode === mode && b.status !== 'skipped').reduce((s, b) => s + b.activeMs / 60_000, 0);
    if (session.blocks.some((b) => b.mode === mode && b.kind === 'maintenance' && b.status !== 'skipped') || minutes >= 4.5) days.add(session.localDate);
  }
  return days.size;
}

export function maintenanceFor(data: Snapshot, overview: ModeOverview, primary: ModeId, today: string): MaintenanceStatus {
  const acquired = hasMilestone(data.milestones, overview.mode, 'acquired');
  return maintenanceStatus({
    mode: overview.mode,
    isPrimary: overview.mode === primary,
    advanced: !!hasMilestone(data.milestones, overview.mode, 'advance'),
    acquired,
    evaluations: overview.evaluations,
    lastPracticed: overview.lastPracticed,
    doneThisWeek: maintenanceDone(data, overview.mode, today),
    today,
    practiceWeekdays: data.profile?.practiceWeekdays ?? [1, 2, 3, 4, 5],
  });
}

export interface StageInfo {
  readonly stage: number;
  readonly evidenceStage: number;
  readonly override: boolean;
  readonly recommendedPrimary: ModeId;
  readonly coreComplete: CoreCompletionRecord | null;
}

export function stageInfo(data: Snapshot, overviews: ReadonlyMap<ModeId, ModeOverview>, today: string): StageInfo {
  const advanced = new Set<ModeId>(data.milestones.filter((m) => m.kind === 'advance').map((m) => m.mode));
  const core = data.core[0] ?? null;
  const fromEvidence = evidenceStage(advanced, !!core);
  const manual = data.planEvents.filter((e) => e.kind === 'stage-advance').map((e) => Number(e.to)).filter((n) => Number.isFinite(n));
  const overrideStage = manual.length > 0 ? Math.max(...manual) : 0;
  const stage = Math.max(fromEvidence, Math.min(overrideStage, 5));
  const standings: ModeStanding[] = CORE_IDS.map((mode) => {
    const o = overviews.get(mode);
    return {
      mode,
      acquired: !!hasMilestone(data.milestones, mode, 'acquired'),
      latestWpm: o?.latestSet?.medianWpm?.toNumber() ?? null,
      latestAccuracy: o?.latestSet?.medianAccuracy?.toNumber() ?? null,
      lastPracticed: o?.lastPracticed ?? null,
      stable: o?.stability.status === 'stable',
      latestSetDate: o?.latestSet?.localDate ?? null,
    };
  });
  const primary = recommendedPrimary({ stage, style: data.profile?.planStyle ?? 'sequential', startDate: data.profile?.startDate ?? today, today, advanced, standings });
  return { stage, evidenceStage: fromEvidence, override: stage > fromEvidence, recommendedPrimary: primary, coreComplete: core };
}

/** The level-0..3 assessment the plan should offer, if any. */
export function assessmentDue(overview: ModeOverview): Level | null {
  if (overview.level > 3 || !overview.started) return null;
  if (overview.teaching?.met) return null;
  // Level 1 needs its control-key exercise and comfort confirmation first.
  if (overview.level === 1 && overview.state && (!overview.state.controlsCompletedAt || !overview.state.comfortConfirmedAt)) return null;
  return overview.level;
}

export function planInfo(data: Snapshot, overview: ModeOverview, maintenance: MaintenanceStatus | null, weakTargets: readonly string[]): ModePlanInfo {
  return {
    mode: overview.mode,
    level: overview.level,
    started: overview.started,
    calibrated: isCalibrated(overview.calibration),
    acquired: !!hasMilestone(data.milestones, overview.mode, 'acquired'),
    advanced: !!hasMilestone(data.milestones, overview.mode, 'advance'),
    maintenance,
    weakTargets,
    assessmentDue: assessmentDue(overview),
  };
}

export function switchingFor(data: Snapshot, primary: ModeId): ReturnType<typeof switchingStage> {
  const acquired = CORE_IDS.filter((m) => hasMilestone(data.milestones, m, 'acquired'));
  const started = CORE_IDS.filter((m) => data.modeStates.some((s) => s.mode === m && s.startedAt));
  return switchingStage({ acquired, started, probes: data.probes }, primary);
}

export interface Awards {
  readonly milestones: MilestoneRecord[];
  readonly modeStates: ModeState[];
  readonly core: CoreCompletionRecord | null;
}

/**
 * New historical awards implied by the evidence and not yet stored. Awards
 * are never revoked: a later decline shows in stability and maintenance.
 */
export function pendingAwards(data: Snapshot, today: string, nowIso: string, newId: () => string): Awards {
  const milestones: MilestoneRecord[] = [];
  const modeStates: ModeState[] = [];
  const trialsById = new Map(data.trials.map((t) => [t.id, t]));
  const evaluationsByMode = new Map<ModeId, SetEvaluation[]>();
  const all = [...data.milestones];
  for (const mode of [...CORE_IDS, ...EXPANSION_IDS]) {
    const evaluations = modeSetEvaluations(mode, data.sets, trialsById, benchmarkProtocolFor(mode));
    evaluationsByMode.set(mode, evaluations);
    for (const kind of ['advance', 'acquired', 'strong', 'showcase'] as MilestoneKind[]) {
      if (hasMilestone(all, mode, kind)) continue;
      const evaluation = evaluateMilestone(evaluations, gateFor(kind, data.profile));
      const record = milestoneFromAward(newId(), mode, evaluation, nowIso);
      if (record) {
        milestones.push(record);
        all.push(record);
      }
    }
    const state = data.modeStates.find((s) => s.mode === mode);
    if (state) {
      const next = levelFromMilestones(state.level, all.filter((m) => m.mode === mode));
      if (next !== state.level) {
        modeStates.push({
          ...state,
          level: next,
          history: [...state.history, { level: next, from: state.level, at: nowIso, reason: 'gate', evidenceIds: all.filter((m) => m.mode === mode).map((m) => m.id), note: `${levelDefinition(state.level).name} gate met` }],
        });
      }
    }
  }
  let core: CoreCompletionRecord | null = null;
  if (data.core.length === 0) {
    const acquired = new Set(CORE_IDS.filter((m) => hasMilestone(all, m, 'acquired')));
    const check = checkCoreCompletion(CORE_IDS, acquired, evaluationsByMode, today);
    if (check.ready) {
      core = {
        schemaVersion: 1,
        id: newId(),
        awardedAt: nowIso,
        awardedLocalDate: today,
        milestoneIds: Object.fromEntries(CORE_IDS.map((m) => [m, hasMilestone(all, m, 'acquired')?.id ?? ''])),
        stabilitySetIds: Object.fromEntries(CORE_IDS.map((m) => [m, check.perMode[m]?.stability.latest?.set.id ?? ''])),
        origin: 'native-run',
      };
    }
  }
  return { milestones, modeStates, core };
}

export function geometryFor(setup: KeyboardSetup | null) {
  return geometryById(setup?.geometryId ?? 'ansi-us');
}
