// Optional two-machine endgame (docs/dual-machine.md). Pure rules only: the
// coordination transport lives in server/ and src/dual/.
//
// Two machines type at once, one hand per keyboard, inside one shared 60 s
// interval scheduled by the coordinator. Clock offsets come from the
// minimum-round-trip ping sample; a run whose clock uncertainty or start-cue
// lateness exceeds 100 ms is labeled unsynchronized and excluded from
// coordinated efficiency milestones. Efficiency divides combined dual WPM by
// matched, fresh solo baselines; it is never capped and never computed from a
// missing, stale or incomparable baseline.
import defaults from '../../config/training-defaults.json';
import type { ModeId } from './modes';
import { canonicalJson } from './signature';
import { numericMedian } from './scoring/fraction';
import { sha256Hex } from './text/sha256';
import { daysBetween } from './time';

const D = defaults.expansions.dualMachine;
export const DUAL_TRIAL_MS = D.defaultTrialSeconds * 1000;
export const MIN_CLOCK_SAMPLES = D.minimumClockSamples;
export const CLOCK_SAMPLE_MAX_AGE_MS = D.clockSampleMaxAgeSeconds * 1000;
export const MIN_START_LEAD_MS = D.minimumStartLeadSeconds * 1000;
export const MAX_CLOCK_UNCERTAINTY_MS = D.maxEstimatedClockUncertaintyMs;
export const MAX_START_LATENESS_MS = D.maxObservedStartCueLatenessMs;
export const STALL_MS = D.stallThresholdMs;
export const COPY_ACCURACY_FLOOR = D.copyAccuracyFloorPercent;
export const BASELINE_MAX_AGE_DAYS = D.baselineMaxAgeDays;
export const SOLO_TRIALS_PER_BASELINE = D.soloTrialsPerBaseline;
export const LEVEL_ADVANCE_TRIALS = D.copyLevelAdvancementTrials;
export const THROUGHPUT_DATES = D.throughputMilestoneDistinctDates;

export type Role = 'left' | 'right';
export type DualLevel = 'D1' | 'D2' | 'D3' | 'D4' | 'D5';
export const DUAL_LEVELS: readonly DualLevel[] = ['D1', 'D2', 'D3', 'D4', 'D5'];

export interface DualLevelDefinition {
  readonly level: DualLevel;
  readonly tasks: string;
  readonly measurement: string;
  /** Composition on the right side in D5; copy everywhere else. */
  readonly composition: Role | null;
}

export const DUAL_LEVEL_DEFINITIONS: Readonly<Record<DualLevel, DualLevelDefinition>> = {
  D1: { level: 'D1', tasks: 'Same simple string on both', measurement: 'Correct-output WPM and accuracy per side', composition: null },
  D2: { level: 'D2', tasks: 'Different fixed strings: letters on the left, digits on the right', measurement: 'Per-side scores, possible substitutions', composition: null },
  D3: { level: 'D3', tasks: 'Two repeated phrases', measurement: 'Per-side scores, stalls', composition: null },
  D4: { level: 'D4', tasks: 'Different continuous copy texts', measurement: 'Matched copy-task efficiency', composition: null },
  D5: { level: 'D5', tasks: 'Copy on the left, free composition on the right', measurement: 'Copy accuracy plus separate production metrics', composition: 'right' },
};

export const LEFT_MODES: readonly ModeId[] = ['QL', 'DL', 'CL', 'WL'];
export const RIGHT_MODES: readonly ModeId[] = ['QR', 'DR', 'CR', 'WR'];

export interface SideSpec {
  readonly role: Role;
  readonly mode: ModeId;
  readonly layoutRevision: string;
  readonly setupRevisionId: string;
  readonly taskId: string;
  readonly taskSha256: string | null;
  readonly taskClass: string;
  readonly composition: boolean;
  readonly baselineTrialIds: readonly string[];
}

export interface DualManifest {
  readonly runId: string;
  readonly protocolId: 'dual-copy-60-v1';
  readonly scorerVersion: string;
  readonly level: DualLevel;
  readonly durationMs: number;
  readonly seed: number;
  readonly createdAt: string;
  readonly left: SideSpec;
  readonly right: SideSpec;
}

export function manifestHash(manifest: DualManifest): string {
  return sha256Hex(canonicalJson(manifest));
}

/** Each client must acknowledge exactly this manifest, from its own role. */
export function checkManifestForRole(manifest: DualManifest, role: Role, mine: { mode: ModeId; setupRevisionId: string }): string[] {
  const side = manifest[role];
  const problems: string[] = [];
  if (side.role !== role) problems.push('The manifest assigns this side a different role.');
  if (side.mode !== mine.mode) problems.push(`The manifest expects ${side.mode} here, but this machine is set up for ${mine.mode}.`);
  if (side.setupRevisionId !== mine.setupRevisionId) problems.push('The manifest names a different setup revision for this machine.');
  if (role === 'left' && !LEFT_MODES.includes(side.mode)) problems.push(`${side.mode} is not a left-hand mode.`);
  if (role === 'right' && !RIGHT_MODES.includes(side.mode)) problems.push(`${side.mode} is not a right-hand mode.`);
  return problems;
}

// ------------------------------------------------------------------ clocks

export interface PingSample {
  /** Client monotonic time when the ping was sent. */
  readonly sentAt: number;
  /** Coordinator monotonic time when it answered. */
  readonly serverAt: number;
  /** Client monotonic time when the answer arrived. */
  readonly receivedAt: number;
}

export interface ClockEstimate {
  /** server = client + offset */
  readonly offsetMs: number;
  /** Half the round trip of the best sample. */
  readonly uncertaintyMs: number;
  readonly samples: number;
  /** Client time of the best sample, for its age. */
  readonly measuredAt: number;
}

/** NTP-style: keep the minimum-round-trip sample; uncertainty is half its RTT. */
export function estimateClock(samples: readonly PingSample[]): ClockEstimate | null {
  if (samples.length === 0) return null;
  let best: PingSample | null = null;
  for (const s of samples) if (!best || s.receivedAt - s.sentAt < best.receivedAt - best.sentAt) best = s;
  const b = best as PingSample;
  const rtt = b.receivedAt - b.sentAt;
  return { offsetMs: b.serverAt - (b.sentAt + b.receivedAt) / 2, uncertaintyMs: rtt / 2, samples: samples.length, measuredAt: b.receivedAt };
}

export function clockUsable(estimate: ClockEstimate | null, clientNow: number): { ok: boolean; reason: string | null } {
  if (!estimate) return { ok: false, reason: 'No clock samples yet.' };
  if (estimate.samples < MIN_CLOCK_SAMPLES) return { ok: false, reason: `Only ${estimate.samples} of ${MIN_CLOCK_SAMPLES} clock samples.` };
  if (clientNow - estimate.measuredAt > CLOCK_SAMPLE_MAX_AGE_MS) return { ok: false, reason: 'The clock estimate is older than 30 seconds; sampling again.' };
  return { ok: true, reason: null };
}

export function toLocal(serverMs: number, estimate: ClockEstimate): number {
  return serverMs - estimate.offsetMs;
}

export function toServer(clientMs: number, estimate: ClockEstimate): number {
  return clientMs + estimate.offsetMs;
}

export interface SyncEvidence {
  readonly uncertaintyMs: number;
  /** How late the start cue was actually painted after the scheduled start. */
  readonly startLatenessMs: number;
  readonly samples: number;
}

export function synchronized(a: SyncEvidence, b: SyncEvidence): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const [side, e] of [
    ['left', a],
    ['right', b],
  ] as const) {
    if (e.uncertaintyMs > MAX_CLOCK_UNCERTAINTY_MS) reasons.push(`The ${side} clock uncertainty was ${Math.round(e.uncertaintyMs)} ms (limit ${MAX_CLOCK_UNCERTAINTY_MS}).`);
    if (Math.abs(e.startLatenessMs) > MAX_START_LATENESS_MS) reasons.push(`The ${side} start cue was ${Math.round(e.startLatenessMs)} ms late (limit ${MAX_START_LATENESS_MS}).`);
    if (e.samples < MIN_CLOCK_SAMPLES) reasons.push(`The ${side} clock had only ${e.samples} samples.`);
  }
  return { ok: reasons.length === 0, reasons };
}

// ------------------------------------------------------------------ stalls

export interface Interval {
  readonly from: number;
  readonly to: number;
}

/** Gaps of at least two seconds without a committed insertion, including the leading and trailing gaps. */
export function stalls(insertTimes: readonly number[], start: number, end: number, threshold = STALL_MS): Interval[] {
  const times = [...insertTimes].filter((t) => t >= start && t < end).sort((a, b) => a - b);
  const points = [start, ...times, end];
  const out: Interval[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1] as number;
    const to = points[i] as number;
    if (to - from >= threshold) out.push({ from, to });
  }
  return out;
}

export function stallSummary(list: readonly Interval[]): { count: number; totalMs: number } {
  return { count: list.length, totalMs: list.reduce((s, i) => s + (i.to - i.from), 0) };
}

/** Time both sides were stalled at once. */
export function bothStalled(a: readonly Interval[], b: readonly Interval[]): { count: number; totalMs: number } {
  let count = 0;
  let totalMs = 0;
  for (const x of a) {
    for (const y of b) {
      const from = Math.max(x.from, y.from);
      const to = Math.min(x.to, y.to);
      if (to > from) {
        count += 1;
        totalMs += to - from;
      }
    }
  }
  return { count, totalMs };
}

// -------------------------------------------------------------- efficiency

export interface SideResult {
  readonly role: Role;
  readonly mode: ModeId;
  readonly trialId: string;
  readonly runId: string;
  readonly manifestHash: string;
  readonly status: 'completed' | 'interrupted' | 'invalid';
  readonly composition: boolean;
  /** Copy tasks: correct-output WPM and attempt accuracy; null for composition. */
  readonly wpm: number | null;
  readonly accuracy: number | null;
  /** Composition: retained characters / 5 per minute; deletions. */
  readonly productionWpm: number | null;
  readonly deletions: number | null;
  readonly glances: number | 'unknown' | null;
  readonly sync: SyncEvidence;
  readonly stalls: readonly Interval[];
  /** This side's matched solo baseline, so either machine can compute efficiency. */
  readonly baseline?: Baseline | null;
  /** Composition only: self-rated coherence 1–5 (unvalidated). */
  readonly coherence?: number | null;
}

export interface Baseline {
  readonly mode: ModeId;
  readonly medianWpm: number;
  readonly trialIds: readonly string[];
  readonly latestDate: string;
  readonly setupRevisionId: string;
  readonly taskClass: string;
}

/** Median of three cue-started solo trials, if fresh and comparable. */
export function soloBaseline(trials: readonly { id: string; wpm: number; localDate: string; setupRevisionId: string; taskClass: string; mode: ModeId }[]): Baseline | null {
  const recent = [...trials].sort((a, b) => b.localDate.localeCompare(a.localDate)).slice(0, SOLO_TRIALS_PER_BASELINE);
  if (recent.length < SOLO_TRIALS_PER_BASELINE) return null;
  const first = recent[0] as (typeof recent)[number];
  if (recent.some((t) => t.setupRevisionId !== first.setupRevisionId || t.taskClass !== first.taskClass || t.mode !== first.mode)) return null;
  return { mode: first.mode, medianWpm: numericMedian(recent.map((t) => t.wpm)) as number, trialIds: recent.map((t) => t.id), latestDate: first.localDate, setupRevisionId: first.setupRevisionId, taskClass: first.taskClass };
}

export type Efficiency =
  | { readonly available: true; readonly combinedWpm: number; readonly efficiency: number; readonly leftCost: number; readonly rightCost: number }
  | { readonly available: false; readonly combinedWpm: number | null; readonly reasons: readonly string[] };

export function dualEfficiency(
  left: SideResult,
  right: SideResult,
  baselines: { readonly left: Baseline | null; readonly right: Baseline | null },
  expect: { readonly left: { setupRevisionId: string; taskClass: string }; readonly right: { setupRevisionId: string; taskClass: string } },
  today: string,
): Efficiency {
  const reasons: string[] = [];
  if (left.composition || right.composition) reasons.push('A composition side has no verified copy WPM; copy efficiency does not apply.');
  if (left.wpm === null || right.wpm === null) reasons.push('A side has no copy result.');
  for (const role of ['left', 'right'] as const) {
    const b = baselines[role];
    if (!b) reasons.push(`The ${role} solo baseline is missing.`);
    else if (b.medianWpm <= 0) reasons.push(`The ${role} solo baseline is zero.`);
    else if (daysBetween(b.latestDate, today) > BASELINE_MAX_AGE_DAYS) reasons.push(`The ${role} solo baseline is older than ${BASELINE_MAX_AGE_DAYS} days.`);
    else if (b.setupRevisionId !== expect[role].setupRevisionId || b.taskClass !== expect[role].taskClass) reasons.push(`The ${role} solo baseline was measured with a different setup or task class.`);
  }
  const combined = left.wpm !== null && right.wpm !== null ? left.wpm + right.wpm : null;
  if (reasons.length > 0 || combined === null) return { available: false, combinedWpm: combined, reasons };
  const soloLeft = (baselines.left as Baseline).medianWpm;
  const soloRight = (baselines.right as Baseline).medianWpm;
  return {
    available: true,
    combinedWpm: combined,
    efficiency: combined / (soloLeft + soloRight),
    leftCost: 1 - (left.wpm as number) / soloLeft,
    rightCost: 1 - (right.wpm as number) / soloRight,
  };
}

export interface CoordinatedRun {
  readonly runId: string;
  readonly localDate: string;
  readonly level: DualLevel;
  readonly left: SideResult;
  readonly right: SideResult;
}

export function runValidity(run: CoordinatedRun): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (run.left.runId !== run.runId || run.right.runId !== run.runId) reasons.push('Results come from different runs.');
  if (run.left.manifestHash !== run.right.manifestHash) reasons.push('The two sides acknowledged different manifests.');
  if (run.left.role !== 'left' || run.right.role !== 'right') reasons.push('The roles are swapped or duplicated.');
  if (run.left.status !== 'completed' || run.right.status !== 'completed') reasons.push('A side did not complete the shared interval.');
  const sync = synchronized(run.left.sync, run.right.sync);
  reasons.push(...sync.reasons);
  return { valid: reasons.length === 0, reasons };
}

/** D1–D4 advance after three completed dual trials with both copy sides at 98%+. */
export function levelReady(runs: readonly CoordinatedRun[], level: DualLevel): boolean {
  const ok = runs.filter((r) => r.level === level && runValidity(r).valid && !r.left.composition && !r.right.composition && (r.left.accuracy ?? 0) >= COPY_ACCURACY_FLOOR && (r.right.accuracy ?? 0) >= COPY_ACCURACY_FLOOR);
  return ok.length >= LEVEL_ADVANCE_TRIALS;
}

/**
 * Throughput milestone: three coordinated copy trials on distinct dates, both
 * sides at 98%+, zero declared glances, combined WPM above the matched fresh
 * two-hand baseline.
 */
export function throughputMilestone(runs: readonly CoordinatedRun[], twoHandBaseline: Baseline | null): { met: boolean; dates: string[]; reasons: string[] } {
  if (!twoHandBaseline) return { met: false, dates: [], reasons: ['No matched two-hand baseline.'] };
  const qualifying = runs.filter(
    (r) =>
      runValidity(r).valid &&
      !r.left.composition &&
      !r.right.composition &&
      (r.left.accuracy ?? 0) >= COPY_ACCURACY_FLOOR &&
      (r.right.accuracy ?? 0) >= COPY_ACCURACY_FLOOR &&
      r.left.glances === 0 &&
      r.right.glances === 0 &&
      (r.left.wpm ?? 0) + (r.right.wpm ?? 0) > twoHandBaseline.medianWpm,
  );
  const dates = [...new Set(qualifying.map((r) => r.localDate))].sort();
  return { met: dates.length >= THROUGHPUT_DATES, dates, reasons: dates.length >= THROUGHPUT_DATES ? [] : [`${dates.length} of ${THROUGHPUT_DATES} qualifying dates.`] };
}

// ----------------------------------------------------- cross-stream analysis

export interface StreamInsert {
  /** Milliseconds since the shared start. */
  readonly atMs: number;
  readonly expected: string | null;
  readonly produced: string;
  readonly correct: boolean;
}

export interface SubstitutionCandidate {
  readonly side: Role;
  readonly atMs: number;
  readonly produced: string;
  readonly expectedHere: string | null;
  readonly otherExpected: string;
  readonly ambiguous: boolean;
}

/**
 * A wrong insertion on one side that equals the character the other side was
 * expected to type at about the same time. Characters shared by both targets
 * at that moment, or alignment uncertainty larger than the window, leave the
 * candidate ambiguous; nothing here is a confirmed substitution.
 */
export function substitutionCandidates(
  left: readonly StreamInsert[],
  right: readonly StreamInsert[],
  windowMs: number,
  alignmentUncertaintyMs: number,
): SubstitutionCandidate[] {
  const out: SubstitutionCandidate[] = [];
  const check =(side: Role, mine: readonly StreamInsert[], other: readonly StreamInsert[]) => {
    for (const ins of mine) {
      if (ins.correct) continue;
      if (ins.produced === ins.expected) continue;
      const near = other.filter((o) => Math.abs(o.atMs - ins.atMs) <= windowMs && o.expected === ins.produced);
      if (near.length === 0) continue;
      const shared = mine.some((m) => Math.abs(m.atMs - ins.atMs) <= windowMs && m.expected === ins.produced);
      out.push({ side, atMs: ins.atMs, produced: ins.produced, expectedHere: ins.expected, otherExpected: ins.produced, ambiguous: shared || alignmentUncertaintyMs > windowMs });
    }
  };
  check('left', left, right);
  check('right', right, left);
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** Merge side result files: identical duplicates collapse; conflicting manifests are rejected. */
export function mergeSideFiles(files: readonly { runId: string; role: Role; manifestHash: string; trialId: string }[]): { runs: Map<string, { left?: string; right?: string; manifestHash: string }>; errors: string[] } {
  const runs = new Map<string, { left?: string; right?: string; manifestHash: string }>();
  const errors: string[] = [];
  for (const f of files) {
    const run = runs.get(f.runId) ?? { manifestHash: f.manifestHash };
    if (run.manifestHash !== f.manifestHash) {
      errors.push(`Run ${f.runId}: the two files acknowledged different manifests and cannot be merged.`);
      continue;
    }
    const existing = run[f.role];
    if (existing && existing !== f.trialId) {
      errors.push(`Run ${f.runId}: two different ${f.role} results.`);
      continue;
    }
    run[f.role] = f.trialId;
    runs.set(f.runId, run);
  }
  return { runs, errors };
}

// ------------------------------------------------------------- local records

/**
 * One side of a coordinated run as stored on a machine. The local side is
 * saved when it submits; the other side's final counters arrive from the
 * relay (no event stream) or from an imported side file (with its stream).
 * Detailed streams never pass through the relay.
 */
export interface DualRunRecord {
  /** `${runId}:${role}` */
  readonly id: string;
  readonly runId: string;
  readonly role: Role;
  readonly source: 'local' | 'relay' | 'imported';
  readonly level: DualLevel;
  readonly localDate: string;
  readonly manifestHash: string;
  readonly manifest: DualManifest;
  readonly result: SideResult;
  /** Copy sides: insertions relative to the shared start, for cross-stream analysis. */
  readonly stream: readonly StreamInsert[] | null;
  /** The coordinator's verdict as this machine saw it; relay/imported sides copy the local one. */
  readonly coordinated: 'pending' | 'complete' | 'stopped' | 'incomplete';
  readonly stoppedBy: Role | null;
  readonly stopReason: string | null;
  /** Keyboard placement/angle/feel and screen arrangement, as written by the user. */
  readonly placement: string | null;
  /** Self-reported collapses and notes (local only). */
  readonly notes: string | null;
  /** Composition side only; stays on this machine. */
  readonly compositionText: string | null;
  readonly savedAt: string;
}

export function dualRecordId(runId: string, role: Role): string {
  return `${runId}:${role}`;
}

export interface RunView {
  readonly runId: string;
  readonly level: DualLevel;
  readonly localDate: string;
  readonly manifest: DualManifest;
  readonly left: DualRunRecord | null;
  readonly right: DualRunRecord | null;
  /** The verdict recorded by the machine that took part (a local record), if any. */
  readonly coordinated: DualRunRecord['coordinated'];
}

/** Group stored side records by run, newest first. */
export function runViews(records: readonly DualRunRecord[]): RunView[] {
  const byRun = new Map<string, DualRunRecord[]>();
  for (const r of records) byRun.set(r.runId, [...(byRun.get(r.runId) ?? []), r]);
  const out: RunView[] = [];
  for (const [runId, list] of byRun) {
    const first = list[0] as DualRunRecord;
    const local = list.find((r) => r.source === 'local');
    out.push({
      runId,
      level: first.level,
      localDate: first.localDate,
      manifest: first.manifest,
      left: list.find((r) => r.role === 'left') ?? null,
      right: list.find((r) => r.role === 'right') ?? null,
      coordinated: local?.coordinated ?? 'incomplete',
    });
  }
  return out.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

/**
 * Runs that count toward level readiness and milestones: the coordinator
 * received both matching results while the shared interval completed. An
 * imported file never upgrades an incomplete run.
 */
export function coordinatedRuns(views: readonly RunView[]): CoordinatedRun[] {
  return views
    .filter((v) => v.coordinated === 'complete' && v.left && v.right)
    .map((v) => ({ runId: v.runId, localDate: v.localDate, level: v.level, left: (v.left as DualRunRecord).result, right: (v.right as DualRunRecord).result }));
}

/** Efficiency for a stored run, using each side's baseline against the manifest's expectations. */
export function runEfficiency(view: RunView): Efficiency | null {
  if (!view.left || !view.right) return null;
  const m = view.manifest;
  return dualEfficiency(
    view.left.result,
    view.right.result,
    { left: view.left.result.baseline ?? null, right: view.right.result.baseline ?? null },
    { left: { setupRevisionId: m.left.setupRevisionId, taskClass: m.left.taskClass }, right: { setupRevisionId: m.right.setupRevisionId, taskClass: m.right.taskClass } },
    view.localDate,
  );
}

export type ImportOutcome = { readonly kind: 'added' | 'upgraded' | 'unchanged'; readonly id: string } | { readonly kind: 'rejected'; readonly id: string; readonly reason: string };

/**
 * Merge an imported side file into the stored records. Identical files are
 * idempotent; a relay copy gains the detailed stream; a different manifest or
 * trial for the same run and role is rejected.
 */
export function mergeImportedSide(existing: readonly DualRunRecord[], incoming: DualRunRecord): { outcome: ImportOutcome; record: DualRunRecord | null } {
  const id = dualRecordId(incoming.runId, incoming.role);
  if (incoming.id !== id || incoming.result.runId !== incoming.runId || incoming.result.role !== incoming.role) {
    return { outcome: { kind: 'rejected', id, reason: 'The file’s run ID and role do not match its result.' }, record: null };
  }
  if (manifestHash(incoming.manifest) !== incoming.manifestHash || incoming.result.manifestHash !== incoming.manifestHash) {
    return { outcome: { kind: 'rejected', id, reason: 'The file’s manifest does not match its manifest hash.' }, record: null };
  }
  const sameRun = existing.filter((r) => r.runId === incoming.runId);
  if (sameRun.some((r) => r.manifestHash !== incoming.manifestHash)) {
    return { outcome: { kind: 'rejected', id, reason: `Run ${incoming.runId.slice(0, 8)}: the files acknowledged different manifests and cannot be merged.` }, record: null };
  }
  const current = sameRun.find((r) => r.role === incoming.role);
  if (!current) {
    const verdict = sameRun.find((r) => r.source === 'local')?.coordinated ?? 'incomplete';
    return { outcome: { kind: 'added', id }, record: { ...incoming, source: 'imported', coordinated: verdict, notes: null, compositionText: null } };
  }
  if (current.result.trialId !== incoming.result.trialId) {
    return { outcome: { kind: 'rejected', id, reason: `Run ${incoming.runId.slice(0, 8)}: a different ${incoming.role} result is already stored.` }, record: null };
  }
  if (current.stream === null && incoming.stream !== null && current.source === 'relay') {
    return { outcome: { kind: 'upgraded', id }, record: { ...current, source: 'imported', stream: incoming.stream } };
  }
  return { outcome: { kind: 'unchanged', id }, record: null };
}
