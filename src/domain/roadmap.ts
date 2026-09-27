// The suggested 20-week roadmap. Dates are forecasts; stages advance on
// evidence (a mode's advance gate), or by a logged manual override that
// confers no skill milestone.
import defaults from '../../config/training-defaults.json';
import type { ModeId } from './modes';
import { daysBetween } from './time';

export interface RoadmapStage {
  readonly stage: number;
  readonly weeks: readonly [number, number];
  readonly primary: ModeId | null;
  readonly gate: 'advance' | 'core-completion';
}

export const ROADMAP: readonly RoadmapStage[] = defaults.roadmap.map((r) => ({
  stage: r.stage,
  weeks: [r.suggestedWeeks[0] as number, r.suggestedWeeks[1] as number] as const,
  primary: r.primaryMode as ModeId | null,
  gate: r.gate as RoadmapStage['gate'],
}));

export const PROGRAM_WEEKS = (ROADMAP.at(-1)?.weeks[1] ?? 20) as number;
export const CORE_ORDER: readonly ModeId[] = ['QL', 'QR', 'DL', 'DR'];

/** 1-based week of the program for a local date. */
export function programWeek(startDate: string, today: string): number {
  return Math.max(1, Math.floor(daysBetween(startDate, today) / 7) + 1);
}

/** The stage the calendar suggests (a forecast, never a trigger). */
export function suggestedStage(week: number): number {
  return ROADMAP.find((s) => week >= s.weeks[0] && week <= s.weeks[1])?.stage ?? (ROADMAP.at(-1)?.stage ?? 5);
}

/**
 * Stage from evidence: stage n (1–4) lasts until its mode meets the advance
 * gate; stage 5 is integration until core completion; 6 means complete.
 * A manual override can move the stage forward and is reported as such.
 */
export function evidenceStage(advanced: ReadonlySet<ModeId>, coreComplete: boolean): number {
  if (coreComplete) return 6;
  for (const s of ROADMAP) if (s.primary && !advanced.has(s.primary)) return s.stage;
  return 5;
}

export interface ModeStanding {
  readonly mode: ModeId;
  readonly acquired: boolean;
  /** Latest comparable median WPM, when measured. */
  readonly latestWpm: number | null;
  readonly latestAccuracy: number | null;
  readonly lastPracticed: string | null;
  readonly stable: boolean;
  readonly latestSetDate: string | null;
}

/**
 * Integration primary: the unacquired mode furthest below its acquisition
 * target, ties by least recent practice; if all are acquired, the mode with
 * the oldest outstanding stability check.
 */
export function integrationPrimary(standings: readonly ModeStanding[], targetWpm = 30): ModeId {
  const unacquired = standings.filter((s) => !s.acquired);
  if (unacquired.length > 0) {
    const gap = (s: ModeStanding) => targetWpm - (s.latestWpm ?? 0);
    return [...unacquired].sort((a, b) => gap(b) - gap(a) || (a.lastPracticed ?? '').localeCompare(b.lastPracticed ?? ''))[0]?.mode ?? 'QL';
  }
  const unstable = standings.filter((s) => !s.stable);
  const pool = unstable.length > 0 ? unstable : standings;
  return [...pool].sort((a, b) => (a.latestSetDate ?? '').localeCompare(b.latestSetDate ?? ''))[0]?.mode ?? 'QL';
}

export interface PrimaryInput {
  readonly stage: number;
  readonly style: 'sequential' | 'paired-hands';
  readonly startDate: string;
  readonly today: string;
  readonly advanced: ReadonlySet<ModeId>;
  readonly standings: readonly ModeStanding[];
}

/** Recommended primary mode for the day. */
export function recommendedPrimary(input: PrimaryInput): ModeId {
  if (input.stage >= 5) return integrationPrimary(input.standings);
  if (input.style === 'paired-hands') {
    const pair: [ModeId, ModeId] = input.stage <= 2 ? ['QL', 'QR'] : ['DL', 'DR'];
    const open = pair.filter((m) => !input.advanced.has(m));
    if (open.length === 1) return open[0] as ModeId;
    const day = Math.max(0, daysBetween(input.startDate, input.today));
    return pair[day % 2] as ModeId;
  }
  return ROADMAP.find((s) => s.stage === input.stage)?.primary ?? 'QL';
}

export function stageLabel(stage: number): string {
  if (stage >= 6) return 'Core complete';
  const s = ROADMAP.find((r) => r.stage === stage);
  if (!s) return `Stage ${stage}`;
  return s.primary ? `Stage ${stage} · ${s.primary}` : `Stage ${stage} · integration`;
}
