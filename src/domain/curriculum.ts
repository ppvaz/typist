// Curriculum: levels 0–7 and the order in which a mode's keys are introduced.
// Keys are introduced by physical row of the actual geometry, never by the
// rows implied by letter names: one-hand Dvorak keeps letters on the number
// row, so that row arrives inside level 2 and the whole alphabet is covered.
import type { GeometryDefinition } from './layouts/geometry';
import { type LayoutDefinition, levelChar } from './layouts/registry';

export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const LEVELS_ALL: readonly Level[] = [0, 1, 2, 3, 4, 5, 6, 7];

export interface LevelDefinition {
  readonly level: Level;
  readonly name: string;
  readonly exercises: string;
  /** Recommended evidence to move beyond the level. */
  readonly evidence: string;
  /** Levels 0–3 are teaching recommendations; 4+ are evidence gates. */
  readonly kind: 'teaching' | 'gate';
}

export const LEVELS: readonly LevelDefinition[] = [
  { level: 0, name: 'Spatial map', exercises: 'Find letters, identify anchors, relocate between zones', evidence: 'Find all 26 letters correctly twice each in a shuffled assessment with no map assistance or physical glances; untimed', kind: 'teaching' },
  { level: 1, name: 'Home and anchors', exercises: 'Home positions, Space, Backspace, Enter, Shift', evidence: 'At least 95% attempt accuracy over 100 target insertions, plus a completed control-key exercise and comfort confirmation', kind: 'teaching' },
  { level: 2, name: 'Rows', exercises: 'Add the top row, the bottom row, then the remaining number and symbol positions', evidence: 'At least 95% over 100 insertions covering every newly introduced printable key at least twice', kind: 'teaching' },
  { level: 3, name: 'Words', exercises: 'Common words and bigrams using learned keys', evidence: 'At least 10 WPM and 96% in two 60-second word drills; 15 WPM is a stretch target', kind: 'teaching' },
  { level: 4, name: 'Prose', exercises: 'Sentences, case, punctuation; later code', evidence: 'Stage gate: a qualifying benchmark set at 20 WPM and 97%, no looking', kind: 'gate' },
  { level: 5, name: 'Acquisition track', exercises: 'Mixed prose and maintenance', evidence: 'Acquisition: three qualifying sessions at 30 WPM and 98%, no looking', kind: 'gate' },
  { level: 6, name: 'Strong track', exercises: 'More fluent prose; harder punctuation', evidence: 'Three qualifying sessions at 45 WPM and 98.5%, no looking', kind: 'gate' },
  { level: 7, name: 'Showcase track', exercises: '60+ WPM, 99%, or a named personal target', evidence: 'Three qualifying sessions at the configured target; a custom target is labeled separately', kind: 'gate' },
];

export function levelDefinition(level: Level): LevelDefinition {
  return LEVELS[level] as LevelDefinition;
}

export type StageId = 'home' | 'top' | 'bottom' | 'number' | 'rest';

export interface KeyStage {
  readonly id: StageId;
  readonly label: string;
  /** Physical positions introduced in this stage. */
  readonly codes: readonly string[];
  /** Base and Shift characters those positions produce (dead keys resolved with Space). */
  readonly chars: readonly string[];
}

const ROW_OF_Y: Record<number, StageId> = { 0: 'number', 1: 'top', 2: 'home', 3: 'bottom' };
const STAGE_LABEL: Record<StageId, string> = {
  home: 'Home row letters',
  top: 'Top row letters',
  bottom: 'Bottom row letters',
  number: 'Number row letters',
  rest: 'Numbers and symbols',
};

const LETTER = /^[a-z]$/;

/** Printable characters a position produces in the base and Shift layers. */
export function positionChars(layout: LayoutDefinition, code: string): string[] {
  const key = layout.keys[code];
  if (!key) return [];
  const out: string[] = [];
  for (const level of key.levels.slice(0, 2)) {
    const char = levelChar(level);
    if (char !== null) out.push(char);
    else if (level && 'dead' in level) {
      const spaced = layout.deadKeySpace[level.dead];
      if (spaced) out.push(spaced);
    }
  }
  return out.filter((c) => c >= ' ' && c <= '~');
}

function isLetterPosition(layout: LayoutDefinition, code: string): boolean {
  return LETTER.test(levelChar(layout.keys[code]?.levels[0]) ?? '');
}

/** The ordered key stages for a layout on a geometry. Empty stages are omitted. */
export function keyStages(layout: LayoutDefinition, geometry: GeometryDefinition): KeyStage[] {
  const printable = geometry.printableCodes.filter((code) => positionChars(layout, code).length > 0);
  const byStage = new Map<StageId, string[]>([
    ['home', []],
    ['top', []],
    ['bottom', []],
    ['number', []],
    ['rest', []],
  ]);
  for (const code of printable) {
    const key = geometry.keys.find((k) => k.code === code);
    const row = key ? ROW_OF_Y[key.y] : undefined;
    const stage: StageId = row && isLetterPosition(layout, code) ? row : 'rest';
    byStage.get(stage)?.push(code);
  }
  const order: StageId[] = ['home', 'top', 'bottom', 'number', 'rest'];
  return order
    .map((id) => {
      const codes = byStage.get(id) ?? [];
      return { id, label: STAGE_LABEL[id], codes, chars: [...new Set(codes.flatMap((c) => positionChars(layout, c)))] };
    })
    .filter((s) => s.codes.length > 0);
}

/** Every letter a–z and where the layout puts it on this geometry. */
export function letterPositions(layout: LayoutDefinition, geometry: GeometryDefinition): Map<string, string> {
  const map = new Map<string, string>();
  for (const code of geometry.printableCodes) {
    const c = levelChar(layout.keys[code]?.levels[0]);
    if (c && LETTER.test(c) && !map.has(c)) map.set(c, code);
  }
  return map;
}

export interface Introduced {
  /** Characters available to drills, including space. */
  readonly chars: readonly string[];
  /** Positions introduced so far. */
  readonly codes: readonly string[];
  /** Stages completed or in progress, in order. */
  readonly stages: readonly KeyStage[];
  /** The stage currently being learned, if any. */
  readonly current: KeyStage | null;
}

/**
 * What a mode has been introduced to at a level. Level 1 teaches the home-row
 * letters (with Shift and Space); level 2 adds stages one by one
 * (`stageProgress` counts completed level-2 stages); level 3+ has everything.
 */
export function introducedAt(layout: LayoutDefinition, geometry: GeometryDefinition, level: Level, stageProgress = 0): Introduced {
  const stages = keyStages(layout, geometry);
  const [home, ...later] = stages;
  if (level === 0) {
    const letters = [...letterPositions(layout, geometry).keys()].sort();
    return { chars: letters, codes: [...letterPositions(layout, geometry).values()], stages: [], current: null };
  }
  let active: KeyStage[];
  let current: KeyStage | null;
  if (level === 1) {
    active = home ? [home] : [];
    current = home ?? null;
  } else if (level === 2) {
    const count = Math.min(Math.max(stageProgress, 0), later.length - 1);
    active = [...(home ? [home] : []), ...later.slice(0, count + 1)];
    current = later[count] ?? null;
  } else {
    active = stages;
    current = null;
  }
  const chars = new Set<string>([' ']);
  for (const stage of active) for (const c of stage.chars) chars.add(c);
  return { chars: [...chars], codes: active.flatMap((s) => s.codes), stages: active, current };
}

/** Level 2's newly introduced positions: everything after the home stage. */
export function levelTwoStages(layout: LayoutDefinition, geometry: GeometryDefinition): KeyStage[] {
  return keyStages(layout, geometry).slice(1);
}

/** Level assessment requirements (docs/training-protocol.md). */
export const LEVEL_ASSESSMENT = {
  0: { repeats: 2, letters: 26 },
  1: { accuracyPercent: 95, insertions: 100 },
  2: { accuracyPercent: 95, insertions: 100, coverageRepeats: 2 },
  3: { wpm: 10, accuracyPercent: 96, drills: 2, durationMs: 60_000, stretchWpm: 15 },
} as const;
