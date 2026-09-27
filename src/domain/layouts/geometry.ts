// Physical keyboard geometry: which key positions exist and where they sit.
// Positions are KeyboardEvent.code values; they identify physical keys, not
// the characters a layout assigns to them.

export type GeometryId = 'ansi-us' | 'abnt2';

export interface GeometryKey {
  readonly code: string;
  /** Left edge and top row in key units (1 unit = one alphanumeric key). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h?: number;
  /** ISO-style Enter spans two rows with a narrower lower part. */
  readonly shape?: 'iso-enter';
  /** Label for keys that do not produce a printable character. */
  readonly label?: string;
}

export interface GeometryDefinition {
  readonly id: GeometryId;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly keys: readonly GeometryKey[];
  /** Positions that produce printable characters, in calibration order. */
  readonly printableCodes: readonly string[];
  /** Positions that exist only on this geometry among the supported ones. */
  readonly distinguishingCodes: readonly string[];
  readonly anchors: readonly string[];
}

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
const ROW_D = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'];
const ROW_C = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
const ROW_B = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];

function run(codes: readonly string[], x: number, y: number): GeometryKey[] {
  return codes.map((code, i) => ({ code, x: x + i, y, w: 1 }));
}

const numberRow: GeometryKey[] = [
  ...run(['Backquote', ...DIGITS, 'Minus', 'Equal'], 0, 0),
  { code: 'Backspace', x: 13, y: 0, w: 2, label: 'backspace' },
];

const bottomRow: GeometryKey[] = [
  { code: 'ControlLeft', x: 0, y: 4, w: 1.25, label: 'ctrl' },
  { code: 'MetaLeft', x: 1.25, y: 4, w: 1.25, label: 'super' },
  { code: 'AltLeft', x: 2.5, y: 4, w: 1.25, label: 'alt' },
  { code: 'Space', x: 3.75, y: 4, w: 6.25, label: 'space' },
  { code: 'AltRight', x: 10, y: 4, w: 1.25, label: 'alt' },
  { code: 'MetaRight', x: 11.25, y: 4, w: 1.25, label: 'super' },
  { code: 'ContextMenu', x: 12.5, y: 4, w: 1.25, label: 'menu' },
  { code: 'ControlRight', x: 13.75, y: 4, w: 1.25, label: 'ctrl' },
];

const ANSI_KEYS: GeometryKey[] = [
  ...numberRow,
  { code: 'Tab', x: 0, y: 1, w: 1.5, label: 'tab' },
  ...run(ROW_D, 1.5, 1),
  { code: 'Backslash', x: 13.5, y: 1, w: 1.5 },
  { code: 'CapsLock', x: 0, y: 2, w: 1.75, label: 'caps' },
  ...run(ROW_C, 1.75, 2),
  { code: 'Enter', x: 12.75, y: 2, w: 2.25, label: 'enter' },
  { code: 'ShiftLeft', x: 0, y: 3, w: 2.25, label: 'shift' },
  ...run(ROW_B, 2.25, 3),
  { code: 'ShiftRight', x: 12.25, y: 3, w: 2.75, label: 'shift' },
  ...bottomRow,
];

const ABNT2_KEYS: GeometryKey[] = [
  ...numberRow,
  { code: 'Tab', x: 0, y: 1, w: 1.5, label: 'tab' },
  ...run(ROW_D, 1.5, 1),
  { code: 'Enter', x: 13.5, y: 1, w: 1.5, h: 2, shape: 'iso-enter', label: 'enter' },
  { code: 'CapsLock', x: 0, y: 2, w: 1.75, label: 'caps' },
  ...run([...ROW_C, 'Backslash'], 1.75, 2),
  { code: 'ShiftLeft', x: 0, y: 3, w: 1.25, label: 'shift' },
  ...run(['IntlBackslash', ...ROW_B, 'IntlRo'], 1.25, 3),
  { code: 'ShiftRight', x: 13.25, y: 3, w: 1.75, label: 'shift' },
  ...bottomRow,
];

export const GEOMETRIES: Readonly<Record<GeometryId, GeometryDefinition>> = {
  'ansi-us': {
    id: 'ansi-us',
    version: 1,
    name: 'US ANSI',
    description: 'Backslash above a one-row Enter, long left Shift, no key between left Shift and Z.',
    keys: ANSI_KEYS,
    printableCodes: ['Backquote', ...DIGITS, 'Minus', 'Equal', ...ROW_D, 'Backslash', ...ROW_C, ...ROW_B],
    distinguishingCodes: [],
    anchors: ['KeyF', 'KeyJ'],
  },
  abnt2: {
    id: 'abnt2',
    version: 1,
    name: 'ABNT2 (Brazilian)',
    description: 'Tall Enter, an extra key between left Shift and Z, and a key left of right Shift.',
    keys: ABNT2_KEYS,
    printableCodes: [
      'Backquote', ...DIGITS, 'Minus', 'Equal', ...ROW_D, ...ROW_C, 'Backslash',
      'IntlBackslash', ...ROW_B, 'IntlRo',
    ],
    distinguishingCodes: ['IntlBackslash', 'IntlRo'],
    anchors: ['KeyF', 'KeyJ'],
  },
};

export const GEOMETRY_IDS = Object.keys(GEOMETRIES) as GeometryId[];

export function geometryById(id: GeometryId): GeometryDefinition {
  return GEOMETRIES[id];
}

export function isGeometryId(value: unknown): value is GeometryId {
  return typeof value === 'string' && value in GEOMETRIES;
}
