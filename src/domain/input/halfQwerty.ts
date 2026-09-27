// Half-QWERTY as an explicitly emulated input path (docs/build-plan.md,
// milestone 5). Holding Space mirrors the keyboard, so one hand reaches the
// other half's characters at the mirror-image positions. The characters come
// from the plain US QWERTY table by physical position, independent of the OS
// layout; every result is labeled "emulated" and never mixes with native
// evidence. It is not an automatic reinterpretation of QL/QR.
import type { LayoutDefinition } from '../layouts/registry';
import type { Decision, InterpretedAction, KeyObservation, BeforeInputObservation } from './interpreter';
import type { InputMeta } from './types';

export const HALF_QWERTY_VERSION = 'half-qwerty-emulation-v1';

/** Mirror-image physical positions across the keyboard's centre. */
const PAIRS: readonly [string, string][] = [
  ['Digit1', 'Digit0'], ['Digit2', 'Digit9'], ['Digit3', 'Digit8'], ['Digit4', 'Digit7'], ['Digit5', 'Digit6'],
  ['KeyQ', 'KeyP'], ['KeyW', 'KeyO'], ['KeyE', 'KeyI'], ['KeyR', 'KeyU'], ['KeyT', 'KeyY'],
  ['KeyA', 'Semicolon'], ['KeyS', 'KeyL'], ['KeyD', 'KeyK'], ['KeyF', 'KeyJ'], ['KeyG', 'KeyH'],
  ['KeyZ', 'Slash'], ['KeyX', 'Period'], ['KeyC', 'Comma'], ['KeyV', 'KeyM'], ['KeyB', 'KeyN'],
  ['Backquote', 'Minus'], ['Tab', 'Backspace'], ['CapsLock', 'Enter'],
];

export const MIRROR: Readonly<Record<string, string>> = Object.fromEntries(PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]));

export interface HalfQwertyOptions {
  readonly hand: 'left' | 'right';
  readonly layout: LayoutDefinition;
  readonly reference: boolean;
  /** Hold longer than this with no other key cancels the space; null: never cancel. */
  readonly tapMaxMs: number | null;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'OS', 'Fn']);

/**
 * Same interface as the native InputInterpreter. Every character key is
 * handled on keydown (the native insertion is prevented), so nothing is
 * counted twice; Space is decided on release: a tap types a space, a hold used
 * as the mirror modifier types nothing.
 */
export class HalfQwertyInterpreter {
  private readonly options: HalfQwertyOptions;
  private space: { t: number; used: boolean } | null = null;

  constructor(options: HalfQwertyOptions) {
    this.options = options;
  }

  get isComposing(): boolean {
    return false;
  }

  private meta(obs: KeyObservation, mirroredFrom: string | null): InputMeta {
    return {
      path: 'key',
      inputType: 'emulated',
      code: obs.code,
      key: obs.key,
      repeat: obs.repeat,
      shift: obs.shiftKey,
      shiftSide: null,
      capsLock: obs.capsLock,
      altGraph: false,
      ...(mirroredFrom ? { keys: [obs.code, mirroredFrom] } : {}),
    };
  }

  private charAt(code: string, shift: boolean, capsLock: boolean): string | null {
    const key = this.options.layout.keys[code];
    const level = key?.levels[shift ? 1 : 0];
    let char = level && 'char' in level ? level.char : null;
    if (char && capsLock && key?.capsLock === 'shift-level') {
      const other = key.levels[shift ? 0 : 1];
      if (other && 'char' in other) char = other.char;
    }
    return char;
  }

  keydown(obs: KeyObservation): Decision {
    if (MODIFIERS.has(obs.key) && obs.code !== 'CapsLock') return { preventDefault: false, actions: [] };
    if (obs.ctrlKey || obs.metaKey || obs.altKey) return { preventDefault: false, actions: [] };
    if (obs.code === 'Space') {
      if (!obs.repeat && !this.space) this.space = { t: obs.t, used: false };
      return { preventDefault: true, actions: [] };
    }
    const mirrored = this.space ? (MIRROR[obs.code] ?? null) : null;
    if (this.space) this.space.used = true;
    const effective = mirrored ?? obs.code;
    if (effective === 'Backspace') return { preventDefault: true, actions: [{ type: 'delete', t: obs.t, input: { ...this.meta(obs, mirrored ? obs.code : null), path: 'backspace' } }] };
    if (effective === 'Enter') return { preventDefault: true, actions: [{ type: 'insert', t: obs.t, grapheme: '\n', input: this.meta(obs, mirrored ? obs.code : null) }] };
    if (effective === 'Tab' || effective === 'CapsLock' || effective === 'Escape') {
      // Unmirrored Tab leaves the input (the escape path); Caps Lock stays native.
      return { preventDefault: !!mirrored, actions: [] };
    }
    if (obs.code.startsWith('Arrow') || obs.code === 'Home' || obs.code === 'End') return { preventDefault: true, actions: [] };
    const char = this.charAt(effective, obs.shiftKey, obs.capsLock);
    if (char === null) return { preventDefault: false, actions: [] };
    return { preventDefault: true, actions: [{ type: 'insert', t: obs.t, grapheme: char, input: this.meta(obs, mirrored ? obs.code : null) }] };
  }

  keyup(obs: KeyObservation): InterpretedAction[] {
    if (obs.code !== 'Space' || !this.space) return [];
    const { t, used } = this.space;
    this.space = null;
    if (used) return [];
    if (this.options.tapMaxMs !== null && obs.t - t > this.options.tapMaxMs) {
      return [{ type: 'observe', t: obs.t, observation: { type: 'rejected-edit', inputType: 'emulated-space', reason: 'held Space without a key: no space' } }];
    }
    return [{ type: 'insert', t, grapheme: ' ', input: { path: 'key', inputType: 'emulated', code: 'Space', key: ' ' } }];
  }

  /** Text arriving from the OS was already produced from keydown: prevent it. */
  beforeInput(obs: BeforeInputObservation): Decision {
    if (obs.inputType === 'insertCompositionText' || obs.inputType === 'deleteCompositionText') return { preventDefault: false, actions: [] };
    if (obs.inputType === 'insertFromPaste' || obs.inputType === 'insertFromDrop' || obs.inputType === 'insertReplacementText') {
      return {
        preventDefault: true,
        actions: this.options.reference ? [{ type: 'invalidate', t: obs.t, reason: obs.inputType === 'insertReplacementText' ? 'replacement' : obs.inputType === 'insertFromDrop' ? 'drop' : 'paste', detail: obs.inputType }] : [],
      };
    }
    return { preventDefault: true, actions: [] };
  }

  compositionStart(): void {
    // Compositions have no place in the emulated path.
  }

  compositionEnd(t: number, committed: string): InterpretedAction[] {
    if (committed === '') return [];
    return this.options.reference ? [{ type: 'invalidate', t, reason: 'unexpected-composition', detail: 'input-method composition during emulated input' }] : [];
  }

  reset(): void {
    this.space = null;
  }
}
