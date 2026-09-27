// Stable identifiers written into every record so results stay interpretable
// after the software changes. A different editing policy, timing rule or text
// policy is a different protocol ID, never a silent variation of an old one.

export const CORE_PROTOCOL_ID = 'typist-core-v1';
export const SCORER_VERSION = 'typist-scorer-v1';
export const GATE_RULES_VERSION = 'typist-gates-v1';
export const SCHEMA_VERSION = 1;

export const CORRECTION_POLICY = 'append-tail-backspace';
export const BENCHMARK_DURATION_MS = 60_000;

export const BENCHMARK_PROTOCOL_ID = 'english-prose-60-v1';
export const PRACTICE_PROTOCOL_ID = 'english-prose-untimed-practice-v1';

export type ProtocolId =
  | 'english-prose-60-v1'
  | 'english-prose-untimed-practice-v1'
  | 'english-prose-timed-practice-60-v1'
  | 'drill-untimed-practice-v1'
  | 'word-drill-60-v1'
  | 'spatial-find-v1'
  | 'controls-v1'
  | 'coverage-assessment-v1'
  | 'monthly-fixed-passage-60-v1'
  | 'custom-text-practice-v1'
  | 'switch-segment-v1'
  | 'dual-solo-copy-60-v1'
  | 'dual-copy-60-v1'
  | 'emulated-half-qwerty-prose-60-v1';

export interface ProtocolDefinition {
  readonly id: ProtocolId;
  readonly name: string;
  readonly timing: { readonly mode: 'fixed'; readonly durationMs: number } | { readonly mode: 'untimed' };
  /** Strict input rules: paste, replacement, unexpected composition invalidate. */
  readonly reference: boolean;
  /** Counts toward stage/acquisition gates. */
  readonly gateEvidence: boolean;
  readonly correctionPolicy: string;
  readonly assistancePolicy: 'no-assistance' | 'any';
  readonly description: string;
}

const fixed60 = { mode: 'fixed', durationMs: BENCHMARK_DURATION_MS } as const;
const untimed = { mode: 'untimed' } as const;

export const PROTOCOLS: Readonly<Record<ProtocolId, ProtocolDefinition>> = {
  'english-prose-60-v1': {
    id: 'english-prose-60-v1',
    name: 'Reference benchmark',
    timing: fixed60,
    reference: true,
    gateEvidence: true,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'no-assistance',
    description: 'Three 60-second native-layout prose trials, same mode and setup, tail Backspace, one-minute rests, no stop-on-error, no adaptive text.',
  },
  'english-prose-untimed-practice-v1': {
    id: 'english-prose-untimed-practice-v1',
    name: 'Prose practice',
    timing: untimed,
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: 'Untimed practice; active time excludes explicit pauses. Practice feedback, never benchmark evidence.',
  },
  'english-prose-timed-practice-60-v1': {
    id: 'english-prose-timed-practice-60-v1',
    name: 'Timed prose practice',
    timing: fixed60,
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: '60-second practice runs on rotating text. Practice feedback only.',
  },
  'drill-untimed-practice-v1': {
    id: 'drill-untimed-practice-v1',
    name: 'Drill practice',
    timing: untimed,
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: 'Untimed generated drills (keys, words, relocation, coverage).',
  },
  'word-drill-60-v1': {
    id: 'word-drill-60-v1',
    name: 'Word drill, 60 s',
    timing: fixed60,
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: 'Level 3 assessment drill: 60-second common-word text using learned keys.',
  },
  'spatial-find-v1': {
    id: 'spatial-find-v1',
    name: 'Find the letters',
    timing: untimed,
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: 'Level 0 spatial map: find each prompted letter; untimed.',
  },
  'controls-v1': {
    id: 'controls-v1',
    name: 'Control keys',
    timing: untimed,
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: 'Level 1 control-key exercise: Space, Enter, both Shifts, Backspace.',
  },
  'coverage-assessment-v1': {
    id: 'coverage-assessment-v1',
    name: 'Coverage assessment',
    timing: untimed,
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: 'Levels 1–2 assessment drill: every introduced key, at least twice, 100+ insertions.',
  },
  'monthly-fixed-passage-60-v1': {
    id: 'monthly-fixed-passage-60-v1',
    name: 'Monthly fixed passage',
    timing: fixed60,
    reference: true,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'no-assistance',
    description: 'The same fixed passage each month in every acquired mode. Does not feed the rotating-corpus acquisition gate.',
  },
  'custom-text-practice-v1': {
    id: 'custom-text-practice-v1',
    name: 'Custom text',
    timing: untimed,
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: 'Your own English or Portuguese text; composition allowed; never a reference benchmark.',
  },
  'switch-segment-v1': {
    id: 'switch-segment-v1',
    name: 'Switching segment',
    timing: { mode: 'fixed', durationMs: 45_000 },
    reference: false,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'any',
    description: 'A separately cued practice segment after a latency probe; its timer starts fresh.',
  },
  'dual-solo-copy-60-v1': {
    id: 'dual-solo-copy-60-v1',
    name: 'Two-machine solo baseline',
    timing: fixed60,
    reference: true,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'no-assistance',
    description: 'Cue-started 60-second copy trial including initial hesitation; the matched solo baseline for dual efficiency.',
  },
  'dual-copy-60-v1': {
    id: 'dual-copy-60-v1',
    name: 'Coordinated dual copy',
    timing: fixed60,
    reference: true,
    gateEvidence: false,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'no-assistance',
    description: 'One side of a coordinated two-machine run, counted inside the shared 60-second interval.',
  },
  'emulated-half-qwerty-prose-60-v1': {
    id: 'emulated-half-qwerty-prose-60-v1',
    name: 'Half-QWERTY (emulated) benchmark',
    timing: fixed60,
    reference: true,
    gateEvidence: true,
    correctionPolicy: CORRECTION_POLICY,
    assistancePolicy: 'no-assistance',
    description: 'In-app mirror-modifier emulation. Evidence is labeled emulated and never merged with native results.',
  },
};

export function protocolById(id: string): ProtocolDefinition | null {
  return (PROTOCOLS as Record<string, ProtocolDefinition>)[id] ?? null;
}

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-test';
