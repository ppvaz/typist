// The mode catalog comes from the machine-readable protocol defaults, so the
// app and the specification cannot drift apart. Core modes (QL/QR/DL/DR)
// define completion; the two-hand baseline and the optional expansion modes
// never change the four-mode denominator.
import defaults from '../../config/training-defaults.json';
import type { LayoutFamily, LayoutId } from './layouts/registry';

export type CoreModeId = 'QL' | 'QR' | 'DL' | 'DR';
export type ExpansionModeId = 'CL' | 'CR' | 'WL' | 'WR' | 'HQL' | 'HQR';
export type ModeId = CoreModeId | 'Q2' | ExpansionModeId;
export type Hand = 'left' | 'right' | 'both';

export interface ModeDefinition {
  readonly id: ModeId;
  readonly family: LayoutFamily;
  readonly defaultLayoutId: LayoutId;
  readonly hand: Hand;
  readonly technique: string;
  readonly countsTowardCore: boolean;
  /** Optional layouts offered only after core completion. */
  readonly expansion: boolean;
  /** "emulated" results never mix with native evidence. */
  readonly inputPath: 'native' | 'emulated';
  readonly layoutName: string;
  readonly handLabel: string;
}

const FAMILY_BY_LAYOUT: Record<string, LayoutFamily> = {
  'qwerty-us-intl': 'qwerty',
  'qwerty-us': 'qwerty',
  'dvorak-left-us': 'dvorak-left',
  'dvorak-right-us': 'dvorak-right',
  'colemak-us': 'colemak',
  'workman-us': 'workman',
};

const LAYOUT_NAME: Record<LayoutFamily, string> = {
  qwerty: 'QWERTY, full board',
  'dvorak-left': 'Dvorak Left-Handed',
  'dvorak-right': 'Dvorak Right-Handed',
  colemak: 'Colemak, full board',
  workman: 'Workman, full board',
};

const HAND_LABEL: Record<Hand, string> = {
  left: 'Left hand',
  right: 'Right hand',
  both: 'Both hands',
};

interface CatalogEntry {
  id: string;
  layoutId: string;
  hand: string;
  technique?: string;
  countsTowardCore?: boolean;
  inputPath?: string;
}

function toMode(entry: CatalogEntry, countsTowardCore: boolean, expansion: boolean): ModeDefinition {
  const family = FAMILY_BY_LAYOUT[entry.layoutId];
  if (!family) throw new Error(`Unknown layout ${entry.layoutId} for mode ${entry.id}`);
  const hand = entry.hand as Hand;
  const inputPath = entry.inputPath === 'emulated' ? 'emulated' : 'native';
  return {
    id: entry.id as ModeId,
    family,
    defaultLayoutId: entry.layoutId as LayoutId,
    hand,
    technique: entry.technique ?? 'two-hand',
    countsTowardCore,
    expansion,
    inputPath,
    layoutName: inputPath === 'emulated' ? 'Half-QWERTY (emulated)' : family === 'qwerty' && hand === 'both' ? 'QWERTY, two hands' : LAYOUT_NAME[family],
    handLabel: HAND_LABEL[hand],
  };
}

export const CORE_MODES: readonly ModeDefinition[] = defaults.coreModes.map((m) => toMode(m, true, false));
export const BASELINE_MODE: ModeDefinition = toMode(defaults.baselineMode, false, false);
export const EXPANSION_MODES: readonly ModeDefinition[] = defaults.expansionModes.map((m) => toMode(m, false, true));
export const ALL_MODES: readonly ModeDefinition[] = [...CORE_MODES, BASELINE_MODE, ...EXPANSION_MODES];
/** Modes offered before core completion. */
export const BASE_MODES: readonly ModeDefinition[] = [...CORE_MODES, BASELINE_MODE];

export function modeById(id: ModeId): ModeDefinition {
  const mode = ALL_MODES.find((m) => m.id === id);
  if (!mode) throw new Error(`Unknown mode ${id}`);
  return mode;
}

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && ALL_MODES.some((m) => m.id === value);
}

/**
 * The layout a mode uses under a setup. Native QWERTY modes follow the
 * setup's QWERTY choice; emulated Half-QWERTY always maps the plain US table
 * onto physical positions, whatever the OS layout.
 */
export function layoutForMode(mode: ModeDefinition, qwertyLayoutId: LayoutId): LayoutId {
  if (mode.inputPath === 'emulated') return mode.defaultLayoutId;
  return mode.family === 'qwerty' ? qwertyLayoutId : mode.defaultLayoutId;
}
