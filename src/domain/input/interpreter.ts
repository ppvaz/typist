// Turns observations of a focused native text field into committed edits.
//
// keydown/keyup supply physical position, modifiers, repeat, and timing;
// committed text (beforeinput, or a reconciled composition) supplies what is
// scored, so a printable key is never counted twice. Dead keys declared by the
// active layout are a native input path: the dead key plus its completing key
// commit one or two graphemes. Any other composition, paste, replacement, or
// undo is rejected where possible and invalidates reference measurement.
import type { LayoutDefinition } from '../layouts/registry';
import type { InvalidityReason } from '../scoring/engine';
import { toGraphemes } from '../text/graphemes';
import type { InputMeta, Observation } from './types';

export interface KeyObservation {
  /** Event timestamp on the page's monotonic clock (Event.timeStamp). */
  readonly t: number;
  readonly code: string;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altGraph: boolean;
  readonly capsLock: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
}

export interface BeforeInputObservation {
  readonly t: number;
  readonly inputType: string;
  readonly data: string | null;
  readonly isComposing: boolean;
}

export type InterpretedAction =
  | { readonly type: 'insert'; readonly t: number; readonly grapheme: string; readonly input: InputMeta }
  | { readonly type: 'delete'; readonly t: number; readonly input: InputMeta }
  | { readonly type: 'observe'; readonly t: number; readonly observation: Observation }
  | { readonly type: 'invalidate'; readonly t: number; readonly reason: InvalidityReason; readonly detail?: string }
  /** Three consecutive unambiguous disagreements with the configured layout. */
  | { readonly type: 'mapping-alert'; readonly t: number };

export interface Decision {
  readonly preventDefault: boolean;
  readonly actions: InterpretedAction[];
}

export interface InputPolicy {
  /** Reference measurement: invalidate instead of tolerating unusual input. */
  readonly reference: boolean;
}

export const MAPPING_ALERT_THRESHOLD = 3;
/** A keydown and the edit it produced must be this close to be associated. */
const ASSOCIATION_WINDOW_MS = 1000;
/** At most the dead key's own character plus the completing key's character. */
const MAX_DEAD_KEY_GRAPHEMES = 2;

const MODIFIER_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
  'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock', 'OS',
]);
/** Key values input methods report when they process a key themselves. */
const OPAQUE_KEYS = new Set(['Process', 'Unidentified']);
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const COMPOSITION_TYPES = new Set(['insertCompositionText', 'deleteCompositionText', 'insertFromComposition', 'deleteByComposition']);
const OTHER_DELETIONS = new Set([
  'deleteWordBackward', 'deleteWordForward', 'deleteSoftLineBackward', 'deleteSoftLineForward',
  'deleteEntireSoftLine', 'deleteHardLineBackward', 'deleteHardLineForward', 'deleteContentForward',
  'deleteContent', 'deleteByCut',
]);
const INVALIDATING: Record<string, InvalidityReason> = {
  insertFromPaste: 'paste',
  insertFromPasteAsQuotation: 'paste',
  insertFromDrop: 'drop',
  deleteByDrag: 'drop',
  insertReplacementText: 'replacement',
  historyUndo: 'undo-redo',
  historyRedo: 'undo-redo',
};

interface PendingKey {
  readonly t: number;
  readonly code: string;
  readonly key: string;
  readonly shift: boolean;
  readonly altGraph: boolean;
  readonly capsLock: boolean;
  readonly repeat: boolean;
  readonly shiftSide: 'left' | 'right' | 'both' | null;
  consumed: boolean;
}

interface PendingDead {
  readonly t: number;
  readonly code: string;
  readonly name: string | null;
  readonly declared: boolean;
  completingKey: PendingKey | null;
}

export class InputInterpreter {
  private readonly layout: LayoutDefinition;
  private readonly policy: InputPolicy;
  private readonly shiftDown = { left: false, right: false };
  private lastKey: PendingKey | null = null;
  private dead: PendingDead | null = null;
  private composing = false;
  private compositionFromDeadKey = false;
  private disagreements = 0;

  constructor(layout: LayoutDefinition, policy: InputPolicy) {
    this.layout = layout;
    this.policy = policy;
  }

  get isComposing(): boolean {
    return this.composing;
  }

  keydown(obs: KeyObservation): Decision {
    if (MODIFIER_KEYS.has(obs.key)) {
      this.trackShift(obs.code, true);
      return { preventDefault: false, actions: [] };
    }
    if (CARET_KEYS.has(obs.key) && !obs.isComposing) return { preventDefault: true, actions: [] };

    const pending: PendingKey = {
      t: obs.t,
      code: obs.code,
      key: obs.key,
      shift: obs.shiftKey,
      altGraph: obs.altGraph,
      capsLock: obs.capsLock,
      repeat: obs.repeat,
      shiftSide: this.shiftSide(),
      consumed: false,
    };

    // Input methods (e.g. IBus) may report a dead key as "Process"; the layout
    // declares which positions are dead keys, so those take the dead-key path.
    const exactLevel = this.layout.keys[obs.code]?.levels[(obs.altGraph && this.layout.altGr !== 'none' ? 2 : 0) + (obs.shiftKey ? 1 : 0)];
    const processedDead = obs.key === 'Process' && !this.dead && !!exactLevel && 'dead' in exactLevel;
    if (obs.key === 'Dead' || processedDead) {
      const deadName = this.declaredDead(obs.code, obs.shiftKey, obs.altGraph);
      const declared = deadName !== null;
      const actions: InterpretedAction[] = [
        { type: 'observe', t: obs.t, observation: { type: 'dead-key', code: obs.code, declared } },
      ];
      if (this.dead) {
        // A second dead key completes the first (e.g. ´ ´ → ´).
        this.dead.completingKey = pending;
      } else {
        this.dead = { t: obs.t, code: obs.code, name: deadName, declared, completingKey: null };
        // Some input methods announce the composition before the dead key's keydown.
        if (this.composing) this.compositionFromDeadKey = true;
      }
      if (this.layout.keys[obs.code]) actions.push(...this.recordMapping(obs.t, obs.code, declared, 'Dead'));
      this.lastKey = null;
      return { preventDefault: false, actions };
    }

    if (this.dead && !this.dead.completingKey) this.dead.completingKey = pending;
    this.lastKey = pending;
    return { preventDefault: false, actions: [] };
  }

  keyup(obs: KeyObservation): InterpretedAction[] {
    if (MODIFIER_KEYS.has(obs.key)) {
      this.trackShift(obs.code, false);
      return [];
    }
    // A dead key whose completing key committed nothing: the OS discarded the sequence.
    const dead = this.dead;
    if (dead && !this.composing && dead.completingKey && dead.completingKey.code === obs.code) {
      this.dead = null;
      return [
        { type: 'observe', t: obs.t, observation: { type: 'dead-key-discarded', keys: [dead.code, obs.code] } },
      ];
    }
    return [];
  }

  beforeInput(obs: BeforeInputObservation): Decision {
    const { inputType } = obs;
    if (COMPOSITION_TYPES.has(inputType) || ((obs.isComposing || this.composing) && inputType === 'insertText')) {
      return { preventDefault: false, actions: [] };
    }
    if (inputType === 'insertText') return { preventDefault: true, actions: this.insertText(obs) };
    if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
      const key = this.takeKey((k) => k.key === 'Enter', obs.t);
      return { preventDefault: true, actions: [{ type: 'insert', t: key?.t ?? obs.t, grapheme: '\n', input: this.meta('key', inputType, key) }] };
    }
    if (inputType === 'deleteContentBackward') {
      const key = this.takeKey((k) => k.key === 'Backspace', obs.t);
      return { preventDefault: true, actions: [{ type: 'delete', t: key?.t ?? obs.t, input: this.meta('backspace', inputType, key) }] };
    }
    const rejected: InterpretedAction = {
      type: 'observe',
      t: obs.t,
      observation: { type: 'rejected-edit', inputType, reason: OTHER_DELETIONS.has(inputType) ? 'editing-policy' : 'unsupported' },
    };
    const reason = INVALIDATING[inputType];
    if (reason) {
      return { preventDefault: true, actions: this.policy.reference ? [rejected, { type: 'invalidate', t: obs.t, reason, detail: inputType }] : [rejected] };
    }
    if (OTHER_DELETIONS.has(inputType)) return { preventDefault: true, actions: [rejected] };
    return {
      preventDefault: true,
      actions: this.policy.reference
        ? [rejected, { type: 'invalidate', t: obs.t, reason: 'unsupported-edit', detail: inputType }]
        : [rejected],
    };
  }

  /** Whether the composition comes from a dead key is decided at its end. */
  compositionStart(): void {
    this.composing = true;
    this.compositionFromDeadKey = this.dead !== null;
  }

  /**
   * Account for text an input method committed natively. `committed` is what
   * the composition appended to the field (the caller reconciles the field).
   */
  compositionEnd(t: number, committed: string): InterpretedAction[] {
    this.composing = false;
    const dead = this.dead;
    const graphemes = toGraphemes(committed);
    // Firefox can end a dead-key composition with an empty commit and deliver
    // the character as a separate insertText in a later task: keep the dead
    // key pending. The completing key's keyup records a real discard.
    if (dead && this.compositionFromDeadKey && graphemes.length === 0 && dead.completingKey) return [];
    this.dead = null;
    const completing = dead?.completingKey ?? this.lastKey;
    const at = completing && t - completing.t < ASSOCIATION_WINDOW_MS ? completing.t : t;
    if (dead && this.compositionFromDeadKey) {
      if (graphemes.length === 0) {
        return [{ type: 'observe', t, observation: { type: 'dead-key-discarded', keys: this.sequenceKeys(dead) } }];
      }
      return this.deadKeyInserts(at, 'compositionend', dead, graphemes);
    }
    if (graphemes.length === 0) return [];
    const actions: InterpretedAction[] = [
      { type: 'observe', t, observation: { type: 'composition', data: committed, accepted: !this.policy.reference } },
    ];
    if (this.policy.reference) {
      actions.push({ type: 'invalidate', t, reason: 'unexpected-composition', detail: 'input-method composition' });
      return actions;
    }
    for (const grapheme of graphemes) {
      actions.push({ type: 'insert', t: at, grapheme, input: { path: 'composition', inputType: 'compositionend', code: null, key: null } });
    }
    return actions;
  }

  /** Forget in-flight key state, e.g. after focus loss. */
  reset(): void {
    this.lastKey = null;
    this.dead = null;
    this.composing = false;
    this.shiftDown.left = false;
    this.shiftDown.right = false;
  }

  private insertText(obs: BeforeInputObservation): InterpretedAction[] {
    const graphemes = toGraphemes(obs.data ?? '');
    if (graphemes.length === 0) return [];
    const dead = this.dead;
    if (dead) {
      // Dead key completed without composition events (direct commit).
      this.dead = null;
      const completing = dead.completingKey ?? this.lastKey;
      if (completing) completing.consumed = true;
      const at = completing && obs.t - completing.t < ASSOCIATION_WINDOW_MS ? completing.t : obs.t;
      return this.deadKeyInserts(at, 'insertText', dead, graphemes);
    }
    if (graphemes.length > 1) {
      if (this.policy.reference) {
        return [
          { type: 'observe', t: obs.t, observation: { type: 'rejected-edit', inputType: 'insertText', reason: 'multi-character' } },
          { type: 'invalidate', t: obs.t, reason: 'multi-character-insertion', detail: `${graphemes.length} graphemes` },
        ];
      }
      return graphemes.map((grapheme) => ({ type: 'insert', t: obs.t, grapheme, input: { path: 'multi', inputType: 'insertText', code: null, key: null } }));
    }
    const grapheme = graphemes[0] ?? '';
    const key = this.takeKey((k) => k.key.normalize('NFC') === grapheme || (OPAQUE_KEYS.has(k.key) && this.layoutProduces(k, grapheme)), obs.t);
    if (!key) {
      return [{ type: 'insert', t: obs.t, grapheme, input: { path: 'unassociated', inputType: 'insertText', code: null, key: null } }];
    }
    const actions: InterpretedAction[] = [{ type: 'insert', t: key.t, grapheme, input: this.meta('key', 'insertText', key) }];
    if (this.layout.keys[key.code]) {
      const expected = this.expectedOutputs(key.code, key.altGraph);
      actions.push(...this.recordMapping(key.t, key.code, expected.includes(grapheme), grapheme, expected));
    }
    return actions;
  }

  private deadKeyInserts(at: number, inputType: string, dead: PendingDead, graphemes: string[]): InterpretedAction[] {
    const keys = this.sequenceKeys(dead);
    const actions: InterpretedAction[] = [];
    if (graphemes.length > MAX_DEAD_KEY_GRAPHEMES && this.policy.reference) {
      return [{ type: 'invalidate', t: at, reason: 'multi-character-insertion', detail: `dead-key sequence committed ${graphemes.length} graphemes` }];
    }
    if (!dead.declared && this.policy.reference) {
      return [{ type: 'invalidate', t: at, reason: 'unexpected-composition', detail: `undeclared dead key at ${dead.code}` }];
    }
    const spacing = dead.name ? this.layout.deadKeySpace[dead.name] : undefined;
    graphemes.forEach((grapheme, i) => {
      // Attribute a position only when one key clearly carries the character.
      let code: string | null = null;
      if (graphemes.length === 1 && grapheme === spacing) code = dead.code;
      else if (graphemes.length === 2) code = i === 0 ? (grapheme === spacing ? dead.code : null) : (keys[1] ?? null);
      actions.push({ type: 'insert', t: at, grapheme, input: { path: 'dead-key', inputType, code, key: null, keys } });
    });
    return actions;
  }

  private sequenceKeys(dead: PendingDead): string[] {
    return dead.completingKey ? [dead.code, dead.completingKey.code] : [dead.code];
  }

  /** Whether the configured layout produces `grapheme` at the key's position and level. */
  private layoutProduces(key: PendingKey, grapheme: string): boolean {
    const levels = this.layout.keys[key.code]?.levels ?? [];
    const level = levels[(key.altGraph && this.layout.altGr !== 'none' ? 2 : 0) + (key.shift ? 1 : 0)];
    const char = level && 'char' in level ? level.char : null;
    if (char === null) return false;
    if (char === grapheme) return true;
    // Caps Lock turns alphabetic base characters into their Shift level.
    return key.capsLock && this.layout.keys[key.code]?.capsLock === 'shift-level' && char.toUpperCase() === grapheme;
  }

  private takeKey(matches: (key: PendingKey) => boolean, t: number): PendingKey | null {
    const key = this.lastKey;
    if (!key || key.consumed || t - key.t > ASSOCIATION_WINDOW_MS || !matches(key)) return null;
    key.consumed = true;
    return key;
  }

  private meta(path: InputMeta['path'], inputType: string, key: PendingKey | null): InputMeta {
    if (!key) return { path: path === 'key' ? 'unassociated' : path, inputType, code: null, key: null };
    return {
      path,
      inputType,
      code: key.code,
      key: key.key,
      repeat: key.repeat,
      shift: key.shift,
      shiftSide: key.shiftSide,
      capsLock: key.capsLock,
      altGraph: key.altGraph,
    };
  }

  /** Characters the configured layout allows at a position for the active level group. */
  private expectedOutputs(code: string, altGraph: boolean): string[] {
    const levels = this.layout.keys[code]?.levels ?? [];
    const group = altGraph && this.layout.altGr !== 'none' ? [2, 3] : [0, 1];
    const chars: string[] = [];
    for (const i of group) {
      const level = levels[i];
      if (level && 'char' in level) chars.push(level.char);
    }
    return chars;
  }

  private declaredDead(code: string, shift: boolean, altGraph: boolean): string | null {
    const levels = this.layout.keys[code]?.levels ?? [];
    const group = altGraph && this.layout.altGr !== 'none' ? [2, 3] : [0, 1];
    const preferred = group[shift ? 1 : 0] ?? 0;
    for (const i of [preferred, ...group.filter((g) => g !== preferred)]) {
      const level = levels[i];
      if (level && 'dead' in level) return level.dead;
    }
    return null;
  }

  private recordMapping(t: number, code: string, agreement: boolean, produced: string, expected: readonly string[] = []): InterpretedAction[] {
    if (agreement) {
      this.disagreements = 0;
      return [];
    }
    this.disagreements += 1;
    const actions: InterpretedAction[] = [
      { type: 'observe', t, observation: { type: 'mapping', code, produced, expected, agreement: false } },
    ];
    if (this.disagreements === MAPPING_ALERT_THRESHOLD) actions.push({ type: 'mapping-alert', t });
    return actions;
  }

  private trackShift(code: string, down: boolean): void {
    if (code === 'ShiftLeft') this.shiftDown.left = down;
    if (code === 'ShiftRight') this.shiftDown.right = down;
  }

  private shiftSide(): PendingKey['shiftSide'] {
    const { left, right } = this.shiftDown;
    if (left && right) return 'both';
    if (left) return 'left';
    if (right) return 'right';
    return null;
  }
}
