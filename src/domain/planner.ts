// Today's plan (docs/training-protocol.md, "Sessions and scheduling").
//
// The planner reserves warm-up and logging first, then inserts due
// maintenance by shortening the primary word/prose blocks. It never appends
// work beyond the budget: whatever does not fit is deferred and disclosed.
// Missed days never accumulate catch-up debt; each day is planned fresh.
import defaults from '../../config/training-defaults.json';
import type { Level } from './curriculum';
import type { MaintenanceStatus } from './maintenance';
import { maintenancePriority } from './maintenance';
import type { ModeId } from './modes';
import type { BlockKind, PlannedBlock, SwitchStage } from './records';
import { isoWeekday, weekdayName } from './time';

const S = defaults.schedule;

export type Template = 'standard' | 'deep' | 'friday' | 'rest';

export interface ModePlanInfo {
  readonly mode: ModeId;
  readonly level: Level;
  readonly started: boolean;
  readonly calibrated: boolean;
  readonly acquired: boolean;
  readonly advanced: boolean;
  readonly maintenance: MaintenanceStatus | null;
  /** Up to three weak positions for the weak-keys label. */
  readonly weakTargets: readonly string[];
  /** The pending level assessment, if any (levels 0–3). */
  readonly assessmentDue: Level | null;
}

export interface PlanInput {
  readonly date: string;
  readonly budgetMinutes: number;
  readonly practiceWeekdays: readonly number[];
  readonly primary: ModePlanInfo;
  readonly others: readonly ModePlanInfo[];
  readonly switching: { readonly appropriate: boolean; readonly pair: readonly [ModeId, ModeId] | null; readonly stage: SwitchStage | null };
  readonly lastFatigue: number | null;
  readonly idFor: (index: number) => string;
}

export interface DailyPlan {
  readonly date: string;
  readonly weekday: number;
  readonly practiceDay: boolean;
  readonly template: Template;
  readonly focus: string;
  readonly blocks: readonly PlannedBlock[];
  readonly totalMinutes: number;
  readonly budget: number;
  readonly deferred: readonly { readonly what: string; readonly why: string }[];
  readonly notes: readonly string[];
}

const FOCUS: Readonly<Record<number, string>> = {
  1: 'Accuracy day',
  2: 'Weak-keys day',
  3: 'Primary and maintenance day',
  4: 'Prose and code day',
  5: 'Benchmark and switching day',
  6: 'Optional practice',
  7: 'Rest or easy maintenance',
};

const MIN_BLOCK = 3;

interface Draft {
  kind: BlockKind;
  mode: ModeId | null;
  minutes: number;
  shortenedBy: number;
  benchmark: boolean;
  title: string;
  detail: string;
  switchPair?: readonly [ModeId, ModeId];
  assessmentLevel?: Level;
  /** Primary word/prose blocks may shrink to fit maintenance. */
  reducible: boolean;
}

function templateFor(budget: number, weekday: number): Template {
  if (budget >= 45) return 'deep';
  if (weekday === 5) return 'friday';
  return 'standard';
}

function baseBlocks(template: Template): [BlockKind, number][] {
  switch (template) {
    case 'deep': {
      const d = S.deepBlocksMinutes;
      // Notes move outside the five-minute benchmark block by reducing words.
      return [['warmup', d.warmup], ['weak-keys', d.weakKeys], ['words', d.words - 2], ['timed-text', d.proseOrCode], ['switching', d.switching], ['benchmark', d.benchmarkAndNotes], ['log', 2]];
    }
    case 'friday': {
      const f = S.fridayBlocksMinutes;
      return [['warmup', f.warmup], ['benchmark', f.benchmark], ['weak-keys', f.weakKeys], ['light-words', f.lightWords], ['switching', f.switching], ['log', f.log]];
    }
    default: {
      const s = S.standardBlocksMinutes;
      return [['warmup', s.warmup], ['weak-keys', s.weakKeys], ['words', s.words], ['timed-text', s.timedText], ['log', s.log]];
    }
  }
}

/** Scale a template to a non-default budget, keeping warm-up and log intact. */
function scale(blocks: [BlockKind, number][], budget: number): [BlockKind, number][] {
  const total = blocks.reduce((sum, [, m]) => sum + m, 0);
  if (total === budget) return blocks;
  const fixed = blocks.filter(([k]) => k === 'warmup' || k === 'log' || k === 'benchmark').reduce((sum, [, m]) => sum + m, 0);
  const flexible = total - fixed;
  const available = Math.max(0, budget - fixed);
  const scaled = blocks.map(([k, m]): [BlockKind, number] => (k === 'warmup' || k === 'log' || k === 'benchmark' ? [k, m] : [k, Math.floor((m * available) / flexible)]));
  let sum = scaled.reduce((s, [, m]) => s + m, 0);
  for (let i = 0; sum < budget && i < scaled.length; i += 1) {
    const entry = scaled[i] as [BlockKind, number];
    if (entry[0] !== 'warmup' && entry[0] !== 'log' && entry[0] !== 'benchmark') {
      entry[1] += 1;
      sum += 1;
    }
  }
  const out = scaled.filter(([, m]) => m > 0);
  // A budget below the fixed blocks keeps warm-up and log, then trims the rest.
  while (out.reduce((s, [, m]) => s + m, 0) > budget && out.length > 2) {
    const idx = out.findIndex(([k]) => k === 'benchmark');
    out.splice(idx >= 0 ? idx : out.length - 2, 1);
  }
  return out;
}

function primaryTitle(kind: BlockKind, info: ModePlanInfo): { title: string; detail: string; kind: BlockKind; assessmentLevel?: Level } {
  const level = info.level;
  switch (kind) {
    case 'warmup':
      return { kind, title: 'Warm-up and relocation', detail: level === 0 ? 'anchors and zones' : 'anchor returns between zones' };
    case 'weak-keys':
      if (level === 0) return { kind, title: 'Find the letters', detail: 'spatial map, one letter at a time' };
      if (level <= 2) return { kind, title: 'New keys', detail: level === 1 ? 'home positions, Space, Shift' : 'row keys by physical row' };
      return { kind, title: 'Weak keys and zones', detail: info.weakTargets.length > 0 ? info.weakTargets.join(', ') : 'learning your weak spots' };
    case 'words':
    case 'light-words':
      if (level === 0) return { kind, title: 'Relocation between zones', detail: 'whole-hand moves' };
      if (level <= 2) return { kind, title: kind === 'light-words' ? 'Light words' : 'Words from learned keys', detail: 'real words where possible' };
      return { kind, title: kind === 'light-words' ? 'Light words' : 'Words and bigrams', detail: 'untimed' };
    case 'timed-text':
      if (level === 0) return { kind, title: 'Letter finding, second pass', detail: 'untimed' };
      if (level <= 2) return { kind, title: 'Coverage drill', detail: 'every learned key' };
      if (level === 3) return { kind, title: 'Timed words', detail: '60-second word drills' };
      return { kind, title: 'Timed prose', detail: '60-second practice runs' };
    case 'benchmark':
      if (info.assessmentDue !== null) return { kind: 'assessment', title: `Level ${info.assessmentDue} assessment`, detail: 'recommended evidence for the next level', assessmentLevel: info.assessmentDue };
      if (level < 4) return { kind: 'words', title: 'Light practice', detail: 'benchmarks begin at level 4' };
      return { kind, title: 'Benchmark set', detail: '3 trials + 2 rests' };
    default:
      return { kind, title: kind, detail: '' };
  }
}

export function planDay(input: PlanInput): DailyPlan {
  const weekday = isoWeekday(input.date);
  const practiceDay = input.practiceWeekdays.includes(weekday);
  const notes: string[] = [];
  const deferred: { what: string; why: string }[] = [];
  const focus = FOCUS[weekday] ?? '';
  if (!practiceDay) {
    const due = input.others.filter((o) => o.maintenance?.due);
    for (const o of due) deferred.push({ what: `${o.mode} maintenance`, why: `${weekdayName(weekday)} is not one of your practice days.` });
    notes.push('Not a practice day. Rest is a legitimate outcome; you can still start a free session.');
    return { date: input.date, weekday, practiceDay, template: 'rest', focus, blocks: [], totalMinutes: 0, budget: input.budgetMinutes, deferred, notes };
  }
  const template = templateFor(input.budgetMinutes, weekday);
  const drafts: Draft[] = scale(baseBlocks(template), input.budgetMinutes).map(([kind, minutes]) => {
    if (kind === 'log') return { kind, mode: null, minutes, shortenedBy: 0, benchmark: false, title: 'Log and notes', detail: 'fatigue, effort, one sentence', reducible: false };
    if (kind === 'switching') {
      if (input.switching.appropriate && input.switching.pair) {
        const [a, b] = input.switching.pair;
        return { kind, mode: a, minutes, shortenedBy: 0, benchmark: false, title: 'Switching', detail: `${input.switching.stage ?? 'blocked'} · ${a} ↔ ${b}`, switchPair: input.switching.pair, reducible: false };
      }
      return { kind: 'light-words', title: 'Light practice', mode: input.primary.mode, minutes, shortenedBy: 0, benchmark: false, detail: 'in place of switching, which needs a second started mode', reducible: true };
    }
    const t = primaryTitle(kind, input.primary);
    return {
      kind: t.kind,
      mode: input.primary.mode,
      minutes,
      shortenedBy: 0,
      benchmark: t.kind === 'benchmark',
      title: t.title,
      detail: t.detail,
      ...(t.assessmentLevel !== undefined ? { assessmentLevel: t.assessmentLevel } : {}),
      reducible: t.kind === 'words' || t.kind === 'light-words' || t.kind === 'timed-text',
    };
  });

  // An assessment due on a non-benchmark day replaces the timed block.
  if (input.primary.assessmentDue !== null && !drafts.some((d) => d.kind === 'assessment')) {
    const timed = drafts.find((d) => d.kind === 'timed-text' || d.kind === 'light-words');
    if (timed) {
      timed.kind = 'assessment';
      timed.title = `Level ${input.primary.assessmentDue} assessment`;
      timed.detail = 'recommended evidence for the next level';
      timed.assessmentLevel = input.primary.assessmentDue;
      timed.reducible = false;
    }
  }

  if (input.lastFatigue !== null && input.lastFatigue >= 3) {
    notes.push('You reported fatigue of 3 or more last time. A shorter session is a good choice; stopping early costs nothing.');
    if (template === 'friday') notes.push('If fatigue is already high, a fresh benchmark on another day is better than a tired one.');
  }

  // Maintenance: regressing, then overdue, then least recently practised.
  const due = input.others.filter((o) => o.maintenance?.due && o.mode !== input.primary.mode).sort((a, b) => maintenancePriority(a.maintenance as MaintenanceStatus, b.maintenance as MaintenanceStatus));
  const capacity = template === 'deep' ? 2 : 1;
  const maxModes = template === 'deep' ? 3 : defaults.schedule.maxModesPerStandardSession;
  let scheduled = 0;
  for (const other of due) {
    const status = other.maintenance as MaintenanceStatus;
    const label = `${other.mode} maintenance`;
    if (scheduled >= capacity || 1 + scheduled >= maxModes) {
      deferred.push({ what: label, why: `At most ${maxModes} modes fit a ${template === 'deep' ? 'deep' : 'standard'} session; moved to your next practice day.` });
      continue;
    }
    if (!other.calibrated) {
      deferred.push({ what: label, why: `${other.mode}'s layout needs calibration before it can be practised.` });
      continue;
    }
    const withBenchmark = other.acquired;
    const minutes = withBenchmark ? status.slotMinutes : 5;
    const reducible = drafts.filter((d) => d.reducible);
    const room = reducible.reduce((sum, d) => sum + Math.max(0, d.minutes - MIN_BLOCK), 0);
    if (room < minutes) {
      deferred.push({ what: label, why: `Only ${room} minutes could be taken from words and prose without dropping below ${MIN_BLOCK} minutes each.` });
      continue;
    }
    let remaining = minutes;
    // Take from the largest reducible block first, one minute at a time.
    while (remaining > 0) {
      const largest = [...reducible].sort((a, b) => b.minutes - a.minutes)[0];
      if (!largest || largest.minutes <= MIN_BLOCK) break;
      largest.minutes -= 1;
      largest.shortenedBy += 1;
      remaining -= 1;
    }
    const logIndex = drafts.findIndex((d) => d.kind === 'log');
    drafts.splice(logIndex >= 0 ? logIndex : drafts.length, 0, {
      kind: 'maintenance',
      mode: other.mode,
      minutes,
      shortenedBy: 0,
      benchmark: withBenchmark,
      title: label,
      detail: withBenchmark ? 'light warm-up and one benchmark set, 3 trials + 2 rests' : `practice slot ${status.doneThisWeek + 1} of ${status.slotsPerWeek} this week`,
      reducible: false,
    });
    scheduled += 1;
  }
  if (scheduled > 0) notes.push(`Words and prose were shortened to fit maintenance inside the ${input.budgetMinutes}-minute budget. Nothing was added beyond it.`);

  const blocks: PlannedBlock[] = drafts.map((d, i) => ({
    id: input.idFor(i),
    kind: d.kind,
    mode: d.mode,
    minutes: d.minutes,
    title: d.title,
    detail: d.shortenedBy > 0 ? `${d.detail} · shortened by ${d.shortenedBy} min` : d.detail,
    shortenedBy: d.shortenedBy,
    benchmark: d.benchmark,
    ...(d.switchPair ? { switchPair: d.switchPair } : {}),
    ...(d.assessmentLevel !== undefined ? { assessmentLevel: d.assessmentLevel } : {}),
  }));
  const totalMinutes = blocks.reduce((sum, b) => sum + b.minutes, 0);
  return { date: input.date, weekday, practiceDay, template, focus, blocks, totalMinutes, budget: input.budgetMinutes, deferred, notes };
}

/** Remove a block from an editable plan; the minutes are simply not practised. */
export function removeBlock(plan: DailyPlan, blockId: string): DailyPlan {
  const blocks = plan.blocks.filter((b) => b.id !== blockId || b.kind === 'log');
  return { ...plan, blocks, totalMinutes: blocks.reduce((s, b) => s + b.minutes, 0) };
}

/** Change a block's minutes without letting the plan exceed its budget. */
export function resizeBlock(plan: DailyPlan, blockId: string, minutes: number): DailyPlan {
  const others = plan.blocks.filter((b) => b.id !== blockId).reduce((s, b) => s + b.minutes, 0);
  const allowed = Math.max(1, Math.min(minutes, plan.budget - others));
  const blocks = plan.blocks.map((b) => (b.id === blockId ? { ...b, minutes: allowed } : b));
  return { ...plan, blocks, totalMinutes: blocks.reduce((s, b) => s + b.minutes, 0) };
}
