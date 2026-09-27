// Fingering ledgers: the user's plan for a hand, versioned and never edited in
// place. Seeds follow docs/input-and-layouts.md: DL/DR home prompts from the
// dedicated one-hand Dvorak tutor; QL/QR get left/center/right zones with
// tactile anchors at KeyF/KeyJ and a checklist whose fingers stay unset,
// because one-hand full-board QWERTY has no canonical fingering.
import type { GeometryDefinition } from './layouts/geometry';
import type { ModeId } from './modes';
import type { Finger, FingeringLedger, LedgerEntry, Zone } from './records';
import { RECORD_SCHEMA_VERSION } from './records';
import { addDays } from './time';

export const FREEZE_DAYS = 14;

/** Finger column (0 = far left) of each printable/editing position on ANSI and ABNT2 boards. */
const COLUMN: Readonly<Record<string, number>> = {
  Backquote: 0, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6,
  Digit8: 7, Digit9: 8, Digit0: 9, Minus: 10, Equal: 11, Backspace: 11,
  Tab: 0, KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3, KeyT: 4, KeyY: 5, KeyU: 6, KeyI: 7, KeyO: 8,
  KeyP: 9, BracketLeft: 10, BracketRight: 11, Backslash: 11,
  CapsLock: 0, KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyG: 4, KeyH: 5, KeyJ: 6, KeyK: 7, KeyL: 8,
  Semicolon: 9, Quote: 10, Enter: 11,
  ShiftLeft: 0, IntlBackslash: 0, KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3, KeyB: 4, KeyN: 5, KeyM: 6,
  Comma: 7, Period: 8, Slash: 9, IntlRo: 10, ShiftRight: 11,
};

export function columnOf(code: string): number | null {
  return COLUMN[code] ?? null;
}

function zoneCodes(geometry: GeometryDefinition, from: number, to: number): string[] {
  return geometry.keys
    .map((k) => k.code)
    .filter((code) => {
      const col = COLUMN[code];
      return col !== undefined && col >= from && col <= to;
    });
}

/** Left/center/right zones for a full-board one-hand layout, named for the hand. */
export function qwertyZones(mode: 'QL' | 'QR' | 'left' | 'right', geometry: GeometryDefinition): Zone[] {
  const left = mode === 'QL' || mode === 'left';
  return [
    { id: 'left', name: left ? 'Home · anchor KeyF' : 'Left reach · anchor KeyF', codes: zoneCodes(geometry, 0, 4), anchor: 'KeyF', restingWindow: null },
    { id: 'center', name: 'Center reach', codes: zoneCodes(geometry, 3, 8), anchor: null, restingWindow: 'between the KeyF and KeyJ anchors' },
    { id: 'right', name: left ? 'Right reach · anchor KeyJ' : 'Home · anchor KeyJ', codes: zoneCodes(geometry, 7, 11), anchor: 'KeyJ', restingWindow: null },
  ];
}

/** One-hand Dvorak places the whole alphabet around a central home; one zone covers it. */
export function dvorakZones(geometry: GeometryDefinition): Zone[] {
  return [{ id: 'board', name: 'Home · anchors KeyF and KeyJ', codes: zoneCodes(geometry, 0, 11), anchor: 'KeyF', restingWindow: 'KeyF–KeyJ' }];
}

/** Home prompts from the dedicated one-hand Dvorak tutor (onehandtyper.com). */
export const DVORAK_HOME: Readonly<Record<'DL' | 'DR', readonly { code: string; finger: Finger }[]>> = {
  DL: [
    { code: 'KeyF', finger: 'little' },
    { code: 'KeyG', finger: 'ring' },
    { code: 'KeyH', finger: 'middle' },
    { code: 'KeyJ', finger: 'index' },
  ],
  DR: [
    { code: 'KeyF', finger: 'index' },
    { code: 'KeyG', finger: 'middle' },
    { code: 'KeyH', finger: 'ring' },
    { code: 'KeyJ', finger: 'little' },
  ],
};

/** Positions the spec asks every ledger to decide on deliberately. */
export const CHECKLIST_CODES = [
  'KeyT', 'KeyG', 'KeyB', 'KeyY', 'KeyH', 'KeyN', 'Backspace', 'Enter', 'ShiftLeft', 'ShiftRight',
  'BracketLeft', 'BracketRight', 'Backslash', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote',
] as const;

function entry(code: string, zoneId: string | null, finger: Finger | null, checklist: boolean, notes = ''): LedgerEntry {
  return { code, zoneId, finger, modifierStrategy: null, alternative: null, notes, checklist };
}

function zoneFor(zones: readonly Zone[], code: string, preferred?: string): string | null {
  if (preferred && zones.some((z) => z.id === preferred && z.codes.includes(code))) return preferred;
  return zones.find((z) => z.codes.includes(code))?.id ?? null;
}

export interface SeedLedgerInput {
  readonly id: string;
  readonly ledgerId: string;
  readonly mode: ModeId;
  readonly setupId: string;
  readonly geometry: GeometryDefinition;
  readonly createdAt: string;
  readonly effectiveDate: string;
}

export function seedLedger(input: SeedLedgerInput): FingeringLedger {
  const { mode, geometry } = input;
  let zones: Zone[];
  let entries: LedgerEntry[];
  let anchors: string[];
  if (mode === 'DL' || mode === 'DR') {
    zones = dvorakZones(geometry);
    anchors = ['KeyF', 'KeyJ'];
    const home = DVORAK_HOME[mode];
    entries = [
      ...home.map((h) => entry(h.code, 'board', h.finger, false, 'Home prompt from the dedicated one-hand Dvorak tutor.')),
      entry('Space', 'board', 'thumb', false, 'Thumb.'),
      ...CHECKLIST_CODES.filter((c) => !home.some((h) => h.code === c) && geometry.keys.some((k) => k.code === c)).map((c) => entry(c, 'board', null, true)),
    ];
  } else if (mode === 'QL' || mode === 'QR' || mode === 'CL' || mode === 'CR' || mode === 'WL' || mode === 'WR') {
    // Full-board one-hand layouts: zones by hand, relocation rather than stretching.
    const hand = mode.endsWith('L') ? 'left' : 'right';
    zones = qwertyZones(hand, geometry);
    anchors = ['KeyF', 'KeyJ'];
    const home = hand;
    entries = [
      entry('Space', null, 'thumb', false, 'Thumb.'),
      ...CHECKLIST_CODES.filter((c) => geometry.keys.some((k) => k.code === c)).map((c) =>
        entry(c, zoneFor(zones, c, ['KeyT', 'KeyG', 'KeyB', 'KeyY', 'KeyH', 'KeyN'].includes(c) ? 'center' : home), null, true, 'Relocate the whole hand rather than stretching.'),
      ),
    ];
  } else {
    // Two-hand baseline: no ledger decisions are needed.
    zones = [];
    anchors = ['KeyF', 'KeyJ'];
    entries = [];
  }
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: input.id,
    ledgerId: input.ledgerId,
    mode,
    setupId: input.setupId,
    geometryId: geometry.id,
    revision: 1,
    createdAt: input.createdAt,
    effectiveDate: input.effectiveDate,
    freezeUntil: addDays(input.effectiveDate, FREEZE_DAYS),
    reason: null,
    zones,
    anchors,
    entries,
  };
}

/** A new revision from edits; the old revision is kept untouched. */
export function reviseLedger(
  previous: FingeringLedger,
  changes: { readonly id: string; readonly createdAt: string; readonly effectiveDate: string; readonly entries?: readonly LedgerEntry[]; readonly zones?: readonly Zone[]; readonly reason: string | null },
): FingeringLedger {
  return {
    ...previous,
    id: changes.id,
    revision: previous.revision + 1,
    createdAt: changes.createdAt,
    effectiveDate: changes.effectiveDate,
    freezeUntil: addDays(changes.effectiveDate, FREEZE_DAYS),
    reason: changes.reason,
    entries: changes.entries ?? previous.entries,
    zones: changes.zones ?? previous.zones,
  };
}

export function ledgerEntry(ledger: FingeringLedger | null, code: string): LedgerEntry | null {
  return ledger?.entries.find((e) => e.code === code) ?? null;
}

export function fingersAssigned(ledger: FingeringLedger): number {
  return ledger.entries.filter((e) => e.finger !== null).length;
}

export function isFrozen(ledger: FingeringLedger, localDate: string): boolean {
  return localDate < ledger.freezeUntil;
}

export const FINGER_LABEL: Readonly<Record<Finger, string>> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  little: 'Little',
};

export const FINGER_NUMERAL: Readonly<Record<Finger, string>> = { thumb: 'T', index: '1', middle: '2', ring: '3', little: '4' };
