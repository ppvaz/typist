// Level recommendations (docs/training-protocol.md, "Curriculum"). Levels 0–3
// are teaching recommendations the user may revisit or skip; the checks below
// explain when the recommended evidence exists. Levels 4+ move only with
// benchmark milestones, which evidence.ts evaluates.
import { LEVEL_ASSESSMENT, type Level } from './curriculum';
import { assistanceObserved, glanceCount } from './evidence';
import type { MilestoneRecord, ModeState, TrialRecord } from './records';
import { accuracyMeets, wpmMeets } from './scoring/rational';

export interface LevelCheck {
  readonly level: Level;
  readonly met: boolean;
  readonly pending: boolean;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
}

function assessments(trials: readonly TrialRecord[], level: Level, protocolId: string): TrialRecord[] {
  return trials.filter((t) => t.assessmentLevel === level && t.protocolId === protocolId && t.status === 'completed');
}

/** Level 0: all 26 letters found correctly twice each, no map assistance, zero glances. */
export function checkLevel0(trials: readonly TrialRecord[]): LevelCheck {
  const candidates = assessments(trials, 0, 'spatial-find-v1').filter(
    (t) => t.endReason === 'text-complete' && t.counters.attempts === t.exercise.length && t.counters.attemptsCorrect === t.counters.attempts,
  );
  const clean = candidates.filter((t) => !assistanceObserved(t) && t.declarations.unrecordedAssistance !== true);
  const passed = clean.find((t) => glanceCount(t.declarations.glances) === 0 && t.declarations.glances?.kind === 'exact');
  if (passed) return { level: 0, met: true, pending: false, summary: 'All letters found twice each with no map and no glances.', evidenceIds: [passed.id] };
  const pending = clean.find((t) => t.declarations.glances === null || t.declarations.glances.kind === 'unknown');
  if (pending) return { level: 0, met: false, pending: true, summary: 'Every letter was found; the glance count is still pending.', evidenceIds: [pending.id] };
  const attempted = assessments(trials, 0, 'spatial-find-v1').length;
  return {
    level: 0,
    met: false,
    pending: false,
    summary: attempted > 0 ? 'Not yet: every letter must be found on the first try, twice, with the map hidden.' : 'No assessment yet.',
    evidenceIds: [],
  };
}

function coverageCheck(level: 1 | 2, trials: readonly TrialRecord[]): TrialRecord | null {
  const need = LEVEL_ASSESSMENT[level];
  return (
    assessments(trials, level, 'coverage-assessment-v1').find(
      (t) => t.counters.attempts >= need.insertions && accuracyMeets(t.counters.attemptsCorrect, t.counters.attempts, need.accuracyPercent),
    ) ?? null
  );
}

/** Level 1: ≥95% over 100 insertions, plus the control-key exercise and a comfort confirmation. */
export function checkLevel1(trials: readonly TrialRecord[], state: Pick<ModeState, 'controlsCompletedAt' | 'comfortConfirmedAt'>): LevelCheck {
  const drill = coverageCheck(1, trials);
  const missing: string[] = [];
  if (!drill) missing.push('95% accuracy over 100 home-row insertions');
  if (!state.controlsCompletedAt) missing.push('the control-key exercise');
  if (!state.comfortConfirmedAt) missing.push('a comfort confirmation');
  return {
    level: 1,
    met: missing.length === 0,
    pending: false,
    summary: missing.length === 0 ? 'Home keys, control keys and comfort are all in place.' : `Still needed: ${missing.join(', ')}.`,
    evidenceIds: drill ? [drill.id] : [],
  };
}

/** Level 2: ≥95% over 100 insertions covering every newly introduced printable key at least twice. */
export function checkLevel2(trials: readonly TrialRecord[]): LevelCheck {
  const drill = coverageCheck(2, trials);
  return {
    level: 2,
    met: !!drill,
    pending: false,
    summary: drill ? 'Every row key was covered at 95% or better.' : 'Still needed: 95% over a 100+ insertion drill covering every new key twice.',
    evidenceIds: drill ? [drill.id] : [],
  };
}

/** Level 3: two 60-second word drills at ≥10 WPM and ≥96%. */
export function checkLevel3(trials: readonly TrialRecord[]): LevelCheck {
  const need = LEVEL_ASSESSMENT[3];
  const passing = assessments(trials, 3, 'word-drill-60-v1').filter(
    (t) =>
      t.activeMs === need.durationMs &&
      wpmMeets(t.counters.finalCorrect, t.activeMs, need.wpm) &&
      accuracyMeets(t.counters.attemptsCorrect, t.counters.attempts, need.accuracyPercent),
  );
  return {
    level: 3,
    met: passing.length >= need.drills,
    pending: false,
    summary:
      passing.length >= need.drills
        ? `Two word drills reached ${need.wpm} WPM at ${need.accuracyPercent}%.`
        : `${passing.length} of ${need.drills} word drills at ${need.wpm} WPM and ${need.accuracyPercent}%.`,
    evidenceIds: passing.slice(0, need.drills).map((t) => t.id),
  };
}

export function checkTeachingLevel(level: Level, trials: readonly TrialRecord[], state: ModeState): LevelCheck | null {
  switch (level) {
    case 0:
      return checkLevel0(trials);
    case 1:
      return checkLevel1(trials, state);
    case 2:
      return checkLevel2(trials);
    case 3:
      return checkLevel3(trials);
    default:
      return null;
  }
}

/** Milestones move levels 4+: advance → 5, acquired → 6, strong → 7. */
export function levelFromMilestones(current: Level, milestones: readonly MilestoneRecord[]): Level {
  const kinds = new Set(milestones.map((m) => m.kind));
  let level = current;
  if (level === 4 && kinds.has('advance')) level = 5;
  if (level === 5 && kinds.has('acquired')) level = 6;
  if (level === 6 && kinds.has('strong')) level = 7;
  return level;
}
