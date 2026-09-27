// Calibration checks that the operating system's active input source produces
// what the configured layout table says, position by position. It is never
// practice evidence. Full calibration walks every printable position in base
// and Shift layers plus editing controls; the short probe covers the positions
// that tell the core layouts apart.
import type { GeometryDefinition } from '../layouts/geometry';
import { type LayoutDefinition, levelChar, levelDead } from '../layouts/registry';

export type CalibrationKind = 'full' | 'probe';

export type Expected =
  | { readonly type: 'char'; readonly char: string }
  | { readonly type: 'dead'; readonly name: string; readonly thenSpace: string }
  | { readonly type: 'none' };

export type CalibrationStep =
  | {
      readonly id: string;
      readonly kind: 'position';
      readonly code: string;
      readonly layer: 'base' | 'shift';
      readonly expected: Expected;
      /** Only some keyboards have this key; "not on my keyboard" is an answer. */
      readonly geometrySpecific: boolean;
    }
  | { readonly id: string; readonly kind: 'space' }
  | { readonly id: string; readonly kind: 'enter' }
  | { readonly id: string; readonly kind: 'backspace' }
  | { readonly id: string; readonly kind: 'shift-side'; readonly side: 'left' | 'right'; readonly code: string; readonly expected: string }
  | { readonly id: string; readonly kind: 'caps-lock'; readonly code: string; readonly expected: string }
  | {
      /** Records what the system does; never fails calibration. */
      readonly id: string;
      readonly kind: 'info';
      readonly prompt: 'dead-then-letter' | 'altgr';
      readonly keys: readonly { readonly code: string; readonly shift: boolean; readonly altGraph: boolean }[];
    };

export const PROBE_POSITIONS: readonly (readonly [string, 'base' | 'shift'])[] = [
  ['KeyQ', 'base'],
  ['KeyF', 'base'],
  ['KeyJ', 'base'],
  ['Digit5', 'base'],
  ['Digit1', 'shift'],
];

/** The positive-control letter position for Shift and Caps Lock checks. */
const CONTROL_LETTER = 'KeyF';

export function expectedAt(layout: LayoutDefinition, code: string, layer: 'base' | 'shift'): Expected {
  const level = layout.keys[code]?.levels[layer === 'base' ? 0 : 1];
  const char = levelChar(level);
  if (char !== null) return { type: 'char', char };
  const dead = levelDead(level);
  if (dead !== null) return { type: 'dead', name: dead, thenSpace: layout.deadKeySpace[dead] ?? '' };
  return { type: 'none' };
}

function positionStep(layout: LayoutDefinition, geometry: GeometryDefinition, code: string, layer: 'base' | 'shift'): CalibrationStep {
  return {
    id: `${layer}:${code}`,
    kind: 'position',
    code,
    layer,
    expected: expectedAt(layout, code, layer),
    geometrySpecific: geometry.distinguishingCodes.includes(code),
  };
}

export function buildPlan(kind: CalibrationKind, layout: LayoutDefinition, geometry: GeometryDefinition): CalibrationStep[] {
  if (kind === 'probe') return PROBE_POSITIONS.map(([code, layer]) => positionStep(layout, geometry, code, layer));

  const steps: CalibrationStep[] = [];
  for (const code of geometry.printableCodes) steps.push(positionStep(layout, geometry, code, 'base'));
  for (const code of geometry.printableCodes) steps.push(positionStep(layout, geometry, code, 'shift'));

  const upper = levelChar(layout.keys[CONTROL_LETTER]?.levels[1]) ?? '';
  steps.push(
    { id: 'control:space', kind: 'space' },
    { id: 'control:enter', kind: 'enter' },
    { id: 'control:backspace', kind: 'backspace' },
    { id: 'control:shift-left', kind: 'shift-side', side: 'left', code: CONTROL_LETTER, expected: upper },
    { id: 'control:shift-right', kind: 'shift-side', side: 'right', code: CONTROL_LETTER, expected: upper },
  );
  // Only asked where the physical key is Caps Lock; Colemak and Workman make it Backspace.
  if (layout.capsLockKey === 'caps-lock') steps.push({ id: 'control:caps-lock', kind: 'caps-lock', code: CONTROL_LETTER, expected: upper });

  const acute = Object.entries(layout.keys).find(([, key]) => levelDead(key.levels[0]) === 'acute')?.[0];
  if (acute) {
    steps.push(
      { id: 'info:dead-then-t', kind: 'info', prompt: 'dead-then-letter', keys: [{ code: acute, shift: false, altGraph: false }, { code: 'KeyT', shift: false, altGraph: false }] },
      { id: 'info:dead-then-c', kind: 'info', prompt: 'dead-then-letter', keys: [{ code: acute, shift: false, altGraph: false }, { code: 'KeyC', shift: false, altGraph: false }] },
    );
  }
  if (layout.altGr !== 'none' && levelChar(layout.keys.Comma?.levels[2]) !== null) {
    steps.push({ id: 'info:altgr-comma', kind: 'info', prompt: 'altgr', keys: [{ code: 'Comma', shift: false, altGraph: true }] });
  }
  return steps;
}

/**
 * Printable positions and editing controls are required. Caps Lock behavior is
 * recorded but optional (it is often remapped), and informational probes
 * never fail calibration.
 */
export function isRequired(step: CalibrationStep): boolean {
  return step.kind !== 'info' && step.kind !== 'caps-lock';
}
