// Logical layouts: the characters each OS input source produces at each
// physical position. Tables are generated from the installed XKB data by
// scripts/xkb-extract.mjs and verified on the user's machine by calibration.
import colemak from './data/colemak-us.json';
import dvorakLeft from './data/dvorak-left-us.json';
import dvorakRight from './data/dvorak-right-us.json';
import qwertyUs from './data/qwerty-us.json';
import qwertyUsIntl from './data/qwerty-us-intl.json';
import workman from './data/workman-us.json';
import type { GeometryDefinition, GeometryId } from './geometry';

export type LayoutId = 'qwerty-us-intl' | 'qwerty-us' | 'dvorak-left-us' | 'dvorak-right-us' | 'colemak-us' | 'workman-us';
export type LayoutFamily = 'qwerty' | 'dvorak-left' | 'dvorak-right' | 'colemak' | 'workman';

export type LevelOutput = { readonly char: string } | { readonly dead: string } | null;

export interface LayoutKey {
  readonly xkb: string;
  readonly type: string | null;
  readonly capsLock: 'shift-level' | 'none';
  /** Levels 1–4: base, Shift, AltGr, AltGr+Shift. Missing levels produce nothing. */
  readonly levels: readonly LevelOutput[];
}

export interface LayoutData {
  readonly id: LayoutId;
  readonly revision: number;
  readonly family: LayoutFamily;
  readonly os: {
    readonly platform: 'linux';
    readonly xkbLayout: string;
    readonly xkbVariant: string | null;
    readonly inputSourceLabel: string | null;
  };
  readonly source: Readonly<Record<string, unknown>>;
  readonly altGr: 'right-alt-level3' | 'none';
  /** What the physical Caps Lock key does under this layout (Colemak and Workman make it Backspace). */
  readonly capsLockKey: 'caps-lock' | 'backspace' | 'other';
  /** What each dead key produces when followed by Space. */
  readonly deadKeySpace: Readonly<Record<string, string>>;
  readonly keys: Readonly<Record<string, LayoutKey>>;
}

export interface LayoutDefinition extends LayoutData {
  readonly name: string;
  readonly shortName: string;
  readonly xkbName: string;
  readonly compatibleGeometries: readonly GeometryId[];
}

const DISPLAY: Record<LayoutId, { name: string; shortName: string }> = {
  'qwerty-us-intl': { name: 'US International, dead keys', shortName: 'US intl' },
  'qwerty-us': { name: 'US', shortName: 'US' },
  'dvorak-left-us': { name: 'Dvorak Left-Handed', shortName: 'Dvorak-L' },
  'dvorak-right-us': { name: 'Dvorak Right-Handed', shortName: 'Dvorak-R' },
  'colemak-us': { name: 'Colemak', shortName: 'Colemak' },
  'workman-us': { name: 'Workman', shortName: 'Workman' },
};

function define(data: unknown): LayoutDefinition {
  const layout = data as LayoutData;
  const { xkbLayout, xkbVariant } = layout.os;
  return {
    ...layout,
    ...DISPLAY[layout.id],
    xkbName: xkbVariant ? `${xkbLayout}(${xkbVariant})` : xkbLayout,
    compatibleGeometries: ['ansi-us', 'abnt2'],
  };
}

export const LAYOUTS: Readonly<Record<LayoutId, LayoutDefinition>> = {
  'qwerty-us-intl': define(qwertyUsIntl),
  'qwerty-us': define(qwertyUs),
  'dvorak-left-us': define(dvorakLeft),
  'dvorak-right-us': define(dvorakRight),
  'colemak-us': define(colemak),
  'workman-us': define(workman),
};

/** Layouts of the four core modes (and the two-hand baseline). */
export const CORE_LAYOUT_IDS: readonly LayoutId[] = ['qwerty-us-intl', 'qwerty-us', 'dvorak-left-us', 'dvorak-right-us'];

export const QWERTY_LAYOUT_CHOICES: readonly LayoutId[] = ['qwerty-us-intl', 'qwerty-us'];

export function layoutById(id: LayoutId): LayoutDefinition {
  return LAYOUTS[id];
}

export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === 'string' && value in LAYOUTS;
}

export function levelChar(level: LevelOutput | undefined): string | null {
  return level && 'char' in level ? level.char : null;
}

export function levelDead(level: LevelOutput | undefined): string | null {
  return level && 'dead' in level ? level.dead : null;
}

/** One way to produce a character on a layout. */
export interface Stroke {
  readonly code: string;
  readonly level: 0 | 1 | 2 | 3;
  /** Present when the character is a dead key followed by another key. */
  readonly then?: { readonly code: string };
}

/**
 * Ways to produce `grapheme`, most direct first: base/Shift, then a base/Shift
 * dead key followed by Space, then AltGr levels (only when AltGr exists).
 */
export function strokesFor(layout: LayoutDefinition, geometry: GeometryDefinition, grapheme: string): Stroke[] {
  const codes = new Set(geometry.keys.map((k) => k.code));
  const direct: Stroke[] = [];
  const dead: Stroke[] = [];
  const altGr: Stroke[] = [];
  if (grapheme === ' ') return [{ code: 'Space', level: 0 }];
  for (const [code, key] of Object.entries(layout.keys)) {
    if (!codes.has(code)) continue;
    key.levels.forEach((level, index) => {
      const i = index as 0 | 1 | 2 | 3;
      if (i >= 2 && layout.altGr === 'none') return;
      if (levelChar(level) === grapheme) (i < 2 ? direct : altGr).push({ code, level: i });
      const deadName = levelDead(level);
      if (i < 2 && deadName && layout.deadKeySpace[deadName] === grapheme) {
        dead.push({ code, level: i, then: { code: 'Space' } });
      }
    });
  }
  return [...direct, ...dead, ...altGr];
}

/** The output XKB assigns to a position at a level (Caps Lock not applied). */
export function outputAt(layout: LayoutDefinition, code: string, level: 0 | 1 | 2 | 3): LevelOutput {
  return layout.keys[code]?.levels[level] ?? null;
}
