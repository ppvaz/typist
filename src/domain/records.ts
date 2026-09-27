// Persisted record shapes (docs/architecture.md, "Data contracts"). Every
// record carries a schema version; IDs are UUIDs; wall-clock times are UTC ISO
// strings; measurements use trial-relative monotonic milliseconds. Unknown
// values stay null: nothing here defaults a declaration to zero or false.
import type { Level } from './curriculum';
import type { Exercise } from './exercises/exercise';
import type { AssistanceLevel } from './input/types';
import type { GeometryId } from './layouts/geometry';
import type { LayoutId } from './layouts/registry';
import type { ModeId } from './modes';
import type { EndReason, InterruptionReason, InvalidityReason, TrialEvent, TrialStatus } from './scoring/engine';
import type { Counters } from './scoring/metrics';

export const RECORD_SCHEMA_VERSION = 1;

export type Origin = 'native-run' | 'restored-typist' | 'manual-external';
export type Hand = 'left' | 'right';
export type DominantHand = 'left' | 'right' | 'both';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface UiPreferences {
  readonly theme: ThemePreference;
  /** Speed may be hidden in learning sessions; accuracy stays visible. */
  readonly showSpeed: boolean;
  /** Multiplier for the practice text, independent of interface text. */
  readonly practiceScale: number;
  readonly uiScale: number;
  readonly fingerLayer: boolean;
  /** Optional, remappable shortcuts; empty strings disable them. */
  readonly shortcuts: { readonly pause: string; readonly toggleMap: string };
}

export const DEFAULT_UI: UiPreferences = {
  theme: 'system',
  showSpeed: true,
  practiceScale: 1,
  uiScale: 1,
  fingerLayer: false,
  shortcuts: { pause: '', toggleMap: '' },
};

export interface Profile {
  readonly schemaVersion: number;
  readonly id: string;
  readonly preferredName: string | null;
  readonly dominantHand: DominantHand | null;
  readonly timeZone: string;
  /** ISO weekdays, 1 = Monday. */
  readonly practiceWeekdays: readonly number[];
  readonly dailyMinutes: number;
  readonly primaryMode: ModeId;
  readonly startDate: string;
  readonly planStyle: 'sequential' | 'paired-hands';
  readonly ui: UiPreferences;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly onboardingComplete: boolean;
  /** A personal level-7 target; labeled separately from the default. */
  readonly showcaseTarget: { readonly wpm: number; readonly accuracyPercent: number; readonly label: string } | null;
}

export type ModifierStrategy = 'hold-shift' | 'sticky-keys' | 'other';

/** One revision of the physical/OS setup. Editing creates a new revision. */
export interface KeyboardSetup {
  readonly schemaVersion: number;
  /** Revision ID, referenced by trials. */
  readonly id: string;
  /** Stable across revisions. */
  readonly setupId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly geometryId: GeometryId;
  readonly geometryVersion: number;
  readonly keyboardLabel: string;
  readonly os: string;
  readonly sessionType: string | null;
  readonly browser: string;
  readonly qwertyLayoutId: LayoutId;
  readonly modifierStrategy: ModifierStrategy;
  readonly modifierNotes: string;
  readonly remaps: string;
  /** Per-hand keyboard offset/placement, as the user describes it. */
  readonly keyboardOffset: { readonly left: string; readonly right: string };
  readonly chairDeskNotes: string;
  readonly changeReason: string | null;
  /** True when this geometry's positions have not been verified end to end. */
  readonly geometryVerified: boolean;
}

export type CalibrationKind = 'full' | 'probe';
export type CalibrationStatus = 'passed' | 'failed' | 'incomplete';

export interface CalibrationRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly setupRevisionId: string;
  readonly layoutId: LayoutId;
  readonly layoutRevision: number;
  readonly geometryId: GeometryId;
  readonly kind: CalibrationKind;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: CalibrationStatus;
  readonly checked: number;
  readonly matched: number;
  readonly results: readonly {
    readonly stepId: string;
    readonly outcome: string;
    readonly expected: unknown;
    readonly observed: unknown;
  }[];
  readonly identified: readonly { readonly layoutId: string; readonly agreements: number; readonly comparisons: number }[];
  /** Browser session in which it ran; a restart requires a short probe. */
  readonly browserSessionId: string;
  readonly browser: string;
  readonly absent: readonly string[];
}

export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';

export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly codes: readonly string[];
  /** Tactile anchor position, or null when the zone is edge-referenced. */
  readonly anchor: string | null;
  readonly restingWindow: string | null;
}

export interface LedgerEntry {
  readonly code: string;
  readonly zoneId: string | null;
  readonly finger: Finger | null;
  readonly modifierStrategy: string | null;
  readonly alternative: string | null;
  readonly notes: string;
  /** Seeded checklist entries awaiting a decision. */
  readonly checklist: boolean;
}

/** One revision of a mode's fingering plan. Never edited in place. */
export interface FingeringLedger {
  readonly schemaVersion: number;
  readonly id: string;
  /** Stable per mode + setup series. */
  readonly ledgerId: string;
  readonly mode: ModeId;
  readonly setupId: string;
  readonly geometryId: GeometryId;
  readonly revision: number;
  readonly createdAt: string;
  readonly effectiveDate: string;
  readonly freezeUntil: string;
  readonly reason: string | null;
  readonly zones: readonly Zone[];
  readonly anchors: readonly string[];
  readonly entries: readonly LedgerEntry[];
}

export interface LevelEvent {
  readonly level: Level;
  readonly from: Level | null;
  readonly at: string;
  readonly reason: 'start' | 'assessment' | 'gate' | 'manual';
  readonly evidenceIds: readonly string[];
  readonly note: string | null;
}

/** Per-mode teaching state. Levels 0–3 are recommendations the user may skip. */
export interface ModeState {
  readonly schemaVersion: number;
  readonly mode: ModeId;
  readonly level: Level;
  /** Completed level-2 stages (home is level 1). */
  readonly stageProgress: number;
  readonly startedAt: string | null;
  readonly history: readonly LevelEvent[];
  readonly comfortConfirmedAt: string | null;
  readonly controlsCompletedAt: string | null;
}

export type BlockKind =
  | 'warmup'
  | 'weak-keys'
  | 'words'
  | 'light-words'
  | 'timed-text'
  | 'switching'
  | 'benchmark'
  | 'maintenance'
  | 'assessment'
  | 'monthly'
  | 'baseline'
  | 'log';

export interface PlannedBlock {
  readonly id: string;
  readonly kind: BlockKind;
  readonly mode: ModeId | null;
  readonly minutes: number;
  readonly title: string;
  readonly detail: string;
  /** Minutes removed to fit maintenance, for honest labels. */
  readonly shortenedBy: number;
  readonly benchmark: boolean;
  readonly switchPair?: readonly [ModeId, ModeId];
  readonly assessmentLevel?: Level;
}

export interface SessionBlockRecord {
  readonly blockId: string;
  readonly kind: BlockKind;
  readonly mode: ModeId | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly activeMs: number;
  readonly trialIds: readonly string[];
  readonly status: 'completed' | 'ended-early' | 'skipped' | 'interrupted';
}

export interface SessionRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly timeZone: string;
  readonly localDate: string;
  readonly template: 'standard' | 'deep' | 'friday' | 'custom' | 'free';
  readonly plannedBlocks: readonly PlannedBlock[];
  readonly plannedMinutes: number;
  readonly blocks: readonly SessionBlockRecord[];
  readonly actualMinutes: number;
  readonly fatigueBefore: number | null;
  readonly fatigueAfter: number | null;
  readonly effort: number | null;
  readonly note: string | null;
  readonly status: 'active' | 'completed' | 'ended-early' | 'interrupted';
  readonly appVersion: string;
  readonly protocolId: string;
  readonly deferred: readonly { readonly what: string; readonly why: string }[];
}

export type TrialKind =
  | 'benchmark'
  | 'practice'
  | 'timed-practice'
  | 'assessment'
  | 'monthly'
  | 'baseline'
  | 'switch-practice'
  | 'dual'
  | 'custom';

/** Glances: an exact count, an explicitly bounded estimate, or "unknown". Null: not yet answered. */
export type GlanceDeclaration =
  | { readonly kind: 'exact'; readonly count: number }
  | { readonly kind: 'at-least'; readonly count: number }
  | { readonly kind: 'unknown' };

export interface Declarations {
  readonly glances: GlanceDeclaration | null;
  /** "stated" confirms the designated hand; "other" reports the wrong hand. */
  readonly hand: 'stated' | 'other' | null;
  readonly unrecordedAssistance: boolean | null;
  readonly updatedAt: string | null;
}

export const EMPTY_DECLARATIONS: Declarations = { glances: null, hand: null, unrecordedAssistance: null, updatedAt: null };

export interface AssistanceRecord {
  /** Assistance at arming; a benchmark policy requires "none". */
  readonly initial: AssistanceLevel;
  /** Every level shown while the trial ran, including the initial one. */
  readonly shown: readonly AssistanceLevel[];
  /** A hidden map revealed after arming; never erased by hiding it again. */
  readonly revealed: boolean;
  readonly policy: 'no-assistance' | 'any';
}

export interface ComparisonSignature {
  readonly protocolId: string;
  readonly scorerVersion: string;
  readonly mode: ModeId;
  readonly layout: string;
  readonly geometry: string;
  readonly setupRevisionId: string;
  readonly ledgerRevisionId: string | null;
  readonly inputPath: 'native' | 'emulated';
  readonly modifierStrategy: string;
  readonly corpus: string;
  readonly language: string;
  readonly textClass: string;
  readonly durationMs: number | null;
  readonly correctionPolicy: string;
  readonly assistancePolicy: string;
}

export interface SetupSnapshot {
  readonly setupRevisionId: string;
  readonly setupRevision: number;
  readonly geometryId: GeometryId;
  readonly keyboardLabel: string;
  readonly modifierStrategy: ModifierStrategy;
  readonly keyboardOffset: { readonly left: string; readonly right: string };
  readonly chairDeskNotes: string;
  readonly browser: string;
  readonly os: string;
}

/** Exercise metadata stored on a trial; the text lives in the content-addressed exercise store. */
export type ExerciseRef = Omit<Exercise, 'text'>;

export function exerciseRef(exercise: Exercise): ExerciseRef {
  const { text: _text, ...ref } = exercise;
  return ref;
}

/** A frozen prompt, keyed by the SHA-256 of its normalized text. */
export interface StoredExercise {
  readonly sha256: string;
  readonly exercise: Exercise;
  readonly storedAt: string;
}

export interface TrialRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly sessionId: string | null;
  readonly blockId: string | null;
  readonly mode: ModeId;
  readonly kind: TrialKind;
  readonly protocolId: string;
  readonly scorerVersion: string;
  readonly appVersion: string;
  readonly origin: Origin;
  /** Reference measurement policy (strict input rules) was applied. */
  readonly reference: boolean;
  /**
   * "unverified" when any insertion had unknown provenance (no associated key
   * press, or several characters at once): such a trial cannot earn a
   * reference result, even though nothing was rejected.
   */
  readonly verification: 'verified' | 'unverified';
  readonly inputPath: 'native' | 'emulated';
  readonly setup: SetupSnapshot;
  readonly layoutId: LayoutId | string;
  readonly layoutRevision: number;
  readonly ledgerRevisionId: string | null;
  readonly ledgerRevision: number | null;
  readonly calibrationId: string | null;
  readonly exercise: ExerciseRef;
  readonly timing: { readonly mode: 'fixed'; readonly durationMs: number } | { readonly mode: 'untimed' };
  readonly assistance: AssistanceRecord;
  /** Null while running (journal). */
  readonly status: TrialStatus | 'running';
  readonly endReason: EndReason | null;
  readonly interruption: InterruptionReason | null;
  readonly invalidity: readonly InvalidityReason[];
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly timeZone: string;
  readonly localDate: string;
  readonly startAtMs: number | null;
  readonly endAtMs: number | null;
  readonly activeMs: number | null;
  readonly counters: Counters & { readonly lateInputs: number };
  readonly metrics: { readonly wpm: number | null; readonly rawWpm: number | null; readonly accuracy: number | null };
  readonly declarations: Declarations;
  readonly signature: ComparisonSignature;
  readonly signatureHash: string;
  readonly benchmarkSetId: string | null;
  readonly setIndex: number | null;
  readonly replacesTrialId: string | null;
  readonly eventCount: number;
  /** Raw events pruned by retention; summaries remain. */
  readonly eventsPruned: boolean;
  /** Level assessment this trial served, if any. */
  readonly assessmentLevel: Level | null;
  readonly note: string | null;
}

export interface EventChunk {
  readonly trialId: string;
  readonly chunk: number;
  readonly events: readonly TrialEvent[];
}

export interface BenchmarkSetRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly sessionId: string;
  readonly mode: ModeId;
  readonly protocolId: string;
  readonly localDate: string;
  readonly timeZone: string;
  readonly createdAt: string;
  readonly signatureHash: string;
  /** Every attempted trial, in order, including invalid and interrupted ones. */
  readonly trialIds: readonly string[];
  readonly status: 'in-progress' | 'complete' | 'abandoned';
  readonly purpose: 'stage' | 'maintenance' | 'monthly' | 'retention' | 'baseline';
}

export type MilestoneKind = 'advance' | 'acquired' | 'strong' | 'showcase';

export interface MilestoneRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly mode: ModeId;
  readonly kind: MilestoneKind;
  readonly target: { readonly wpm: string; readonly accuracyPercent: string; readonly label: string | null };
  readonly protocolId: string;
  readonly gateRules: string;
  readonly awardedAt: string;
  readonly awardedLocalDate: string;
  readonly signatureHash: string;
  readonly setIds: readonly string[];
  readonly trialIds: readonly string[];
  /** The evaluation that justified the award, frozen at award time. */
  readonly evaluation: readonly {
    readonly setId: string;
    readonly localDate: string;
    readonly medianWpm: string;
    readonly medianAccuracy: string;
    readonly jointPasses: number;
  }[];
  readonly origin: Origin;
}

export interface CoreCompletionRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly awardedAt: string;
  readonly awardedLocalDate: string;
  readonly milestoneIds: Readonly<Record<string, string>>;
  readonly stabilitySetIds: Readonly<Record<string, string>>;
  readonly origin: Origin;
}

export type SwitchStage = 'blocked' | 'paired' | 'randomized';
export type ProbeOutcome = 'complete' | 'timeout' | 'interrupted' | 'invalid';

export interface SwitchProbeRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly sessionId: string | null;
  readonly blockId: string | null;
  readonly stage: SwitchStage;
  readonly from: ModeId;
  readonly to: ModeId;
  readonly fromLayout: string;
  readonly toLayout: string;
  readonly setupRevisionId: string;
  readonly cueAt: string;
  readonly localDate: string;
  readonly seed: number;
  readonly sequenceIndex: number;
  readonly prompt: string;
  readonly outcome: ProbeOutcome;
  readonly latencyMs: number | null;
  /** For a timeout: a lower bound, never a success. */
  readonly lowerBoundMs: number | null;
  readonly firstInsertMs: number | null;
  readonly resets: number;
  readonly interruption: string | null;
  readonly declarations: { readonly glances: GlanceDeclaration | null };
  readonly events: readonly { readonly atMs: number; readonly kind: string; readonly grapheme?: string; readonly correct?: boolean }[];
  readonly origin: Origin;
}

export interface PlanEvent {
  readonly schemaVersion: number;
  readonly id: string;
  readonly at: string;
  readonly kind: 'stage-advance' | 'primary-change' | 'level-change' | 'plan-edit' | 'skip-maintenance';
  readonly mode: ModeId | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly note: string | null;
}

export interface CustomText {
  readonly schemaVersion: number;
  readonly id: string;
  readonly createdAt: string;
  readonly title: string;
  readonly language: string;
  readonly exercise: Exercise;
}
