import { describe, expect, it } from 'vitest';
import {
  type Decision,
  type InterpretedAction,
  InputInterpreter,
  type KeyObservation,
} from '../../src/domain/input/interpreter';
import { layoutById } from '../../src/domain/layouts/registry';

function key(t: number, code: string, keyValue: string, extra: Partial<KeyObservation> = {}): KeyObservation {
  return {
    t,
    code,
    key: keyValue,
    shiftKey: false,
    altGraph: false,
    capsLock: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    ...extra,
  };
}

function inserts(actions: readonly InterpretedAction[]) {
  return actions.flatMap((a) => (a.type === 'insert' ? [a] : []));
}

function kinds(actions: readonly InterpretedAction[]) {
  return actions.map((a) => a.type);
}

/** Press a printable key that commits `data` directly (no composition). */
function press(input: InputInterpreter, t: number, code: string, data: string, extra: Partial<KeyObservation> = {}): InterpretedAction[] {
  const down = input.keydown(key(t, code, data, extra));
  const decision = input.beforeInput({ t: t + 1, inputType: 'insertText', data, isComposing: false });
  const up = input.keyup(key(t + 30, code, data, extra));
  return [...down.actions, ...decision.actions, ...up];
}

const qwertyIntl = layoutById('qwerty-us-intl');
const qwerty = layoutById('qwerty-us');
const dvorakLeft = layoutById('dvorak-left-us');

describe('ordinary key presses', () => {
  it('scores committed text once and attributes it to the unambiguous keydown', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    const down = input.keydown(key(100, 'KeyC', 'c'));
    expect(down).toEqual({ preventDefault: false, actions: [] });
    const decision: Decision = input.beforeInput({ t: 104, inputType: 'insertText', data: 'c', isComposing: false });
    expect(decision.preventDefault).toBe(true);
    expect(inserts(decision.actions)).toEqual([
      {
        type: 'insert',
        t: 100,
        grapheme: 'c',
        input: {
          path: 'key',
          inputType: 'insertText',
          code: 'KeyC',
          key: 'c',
          repeat: false,
          shift: false,
          shiftSide: null,
          capsLock: false,
          altGraph: false,
        },
      },
    ]);
  });

  it('records which Shift key was held and keeps auto-repeat attempts', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    input.keydown(key(0, 'ShiftRight', 'Shift', { shiftKey: true }));
    const first = inserts(press(input, 10, 'KeyA', 'A', { shiftKey: true }));
    const repeated = inserts(press(input, 60, 'KeyA', 'A', { shiftKey: true, repeat: true }));
    expect(first[0]?.input).toMatchObject({ code: 'KeyA', shift: true, shiftSide: 'right', repeat: false });
    expect(repeated[0]?.input).toMatchObject({ repeat: true });
  });

  it('treats Backspace as one tail deletion and Enter as a newline attempt', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    input.keydown(key(0, 'Backspace', 'Backspace'));
    const del = input.beforeInput({ t: 2, inputType: 'deleteContentBackward', data: null, isComposing: false });
    expect(del.preventDefault).toBe(true);
    expect(del.actions).toMatchObject([{ type: 'delete', t: 0, input: { path: 'backspace', code: 'Backspace' } }]);
    input.keydown(key(10, 'Enter', 'Enter'));
    const enter = input.beforeInput({ t: 11, inputType: 'insertLineBreak', data: null, isComposing: false });
    expect(enter.actions).toMatchObject([{ type: 'insert', grapheme: '\n', input: { code: 'Enter' } }]);
  });

  it('respects an OS-remapped Backspace by its edit type, not its physical code', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    input.keydown(key(0, 'CapsLock', 'Backspace'));
    const del = input.beforeInput({ t: 1, inputType: 'deleteContentBackward', data: null, isComposing: false });
    expect(del.actions).toMatchObject([{ type: 'delete', input: { code: 'CapsLock', key: 'Backspace' } }]);
  });

  it('keeps the caret at the tail by consuming caret-movement keys', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    expect(input.keydown(key(0, 'ArrowLeft', 'ArrowLeft')).preventDefault).toBe(true);
    expect(input.keydown(key(0, 'Tab', 'Tab')).preventDefault).toBe(false);
    expect(input.keydown(key(0, 'Escape', 'Escape')).preventDefault).toBe(false);
  });

  it('associates a key an input method reported as "Process" when the layout produces the text there', () => {
    const input = new InputInterpreter(dvorakLeft, { reference: true });
    input.keydown(key(0, 'KeyF', 'Process'));
    const decision = input.beforeInput({ t: 3, inputType: 'insertText', data: 'd', isComposing: false });
    expect(inserts(decision.actions)[0]?.input).toMatchObject({ path: 'key', code: 'KeyF' });
    input.keydown(key(10, 'KeyF', 'Process', { shiftKey: true }));
    expect(inserts(input.beforeInput({ t: 12, inputType: 'insertText', data: 'D', isComposing: false }).actions)[0]?.input).toMatchObject({ path: 'key', code: 'KeyF' });
    input.keydown(key(20, 'KeyF', 'Process'));
    expect(inserts(input.beforeInput({ t: 22, inputType: 'insertText', data: 'x', isComposing: false }).actions)[0]?.input.path).toBe('unassociated');
  });

  it('stores no physical position when no keydown explains the text', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    const decision = input.beforeInput({ t: 5, inputType: 'insertText', data: 'q', isComposing: false });
    expect(inserts(decision.actions)[0]?.input).toMatchObject({ path: 'unassociated', code: null });
  });
});

describe('rejected and invalidating edits', () => {
  it.each([
    ['insertFromPaste', 'paste'],
    ['insertFromDrop', 'drop'],
    ['insertReplacementText', 'replacement'],
    ['historyUndo', 'undo-redo'],
    ['historyRedo', 'undo-redo'],
  ])('rejects %s and invalidates reference measurement', (inputType, reason) => {
    const reference = new InputInterpreter(qwerty, { reference: true });
    const decision = reference.beforeInput({ t: 0, inputType, data: 'pasted', isComposing: false });
    expect(decision.preventDefault).toBe(true);
    expect(decision.actions).toContainEqual(expect.objectContaining({ type: 'invalidate', reason }));
    const practice = new InputInterpreter(qwerty, { reference: false });
    const practiced = practice.beforeInput({ t: 0, inputType, data: 'pasted', isComposing: false });
    expect(practiced.preventDefault).toBe(true);
    expect(kinds(practiced.actions)).toEqual(['observe']);
  });

  it('rejects word deletion without invalidating, because nothing changed', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    const decision = input.beforeInput({ t: 0, inputType: 'deleteWordBackward', data: null, isComposing: false });
    expect(decision.preventDefault).toBe(true);
    expect(kinds(decision.actions)).toEqual(['observe']);
  });

  it('invalidates a multi-character insertion in reference tests and splits it in practice', () => {
    const reference = new InputInterpreter(qwerty, { reference: true });
    expect(reference.beforeInput({ t: 0, inputType: 'insertText', data: 'the', isComposing: false }).actions).toContainEqual(
      expect.objectContaining({ type: 'invalidate', reason: 'multi-character-insertion' }),
    );
    const practice = new InputInterpreter(qwerty, { reference: false });
    const actions = practice.beforeInput({ t: 0, inputType: 'insertText', data: 'the', isComposing: false }).actions;
    expect(inserts(actions).map((a) => a.grapheme)).toEqual(['t', 'h', 'e']);
  });
});

describe('composition', () => {
  it('A19: a composed é in practice counts as one grapheme without a physical position', () => {
    const input = new InputInterpreter(qwerty, { reference: false });
    input.keydown(key(0, 'KeyE', 'Process', { isComposing: true }));
    input.compositionStart();
    expect(input.beforeInput({ t: 1, inputType: 'insertCompositionText', data: 'é', isComposing: true }).preventDefault).toBe(false);
    const actions = input.compositionEnd(40, 'é');
    expect(inserts(actions)).toMatchObject([{ grapheme: 'é', input: { path: 'composition', code: null } }]);
  });

  it('invalidates an input-method composition in a reference trial', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    input.keydown(key(0, 'KeyA', 'Process', { isComposing: true }));
    input.compositionStart();
    const actions = input.compositionEnd(50, 'あ');
    expect(inserts(actions)).toEqual([]);
    expect(actions).toContainEqual(expect.objectContaining({ type: 'invalidate', reason: 'unexpected-composition' }));
  });
});

describe('US International dead keys', () => {
  it("accepts ' then Space as an apostrophe in a reference trial (composition path)", () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    const dead = input.keydown(key(100, 'Quote', 'Dead'));
    expect(dead.preventDefault).toBe(false);
    expect(dead.actions).toEqual([{ type: 'observe', t: 100, observation: { type: 'dead-key', code: 'Quote', declared: true } }]);
    input.compositionStart();
    input.beforeInput({ t: 101, inputType: 'insertCompositionText', data: '´', isComposing: true });
    input.keyup(key(140, 'Quote', 'Dead'));
    input.keydown(key(300, 'Space', ' ', { isComposing: true }));
    const actions = input.compositionEnd(302, "'");
    expect(actions).toEqual([
      { type: 'insert', t: 300, grapheme: "'", input: { path: 'dead-key', inputType: 'compositionend', code: 'Quote', key: null, keys: ['Quote', 'Space'] } },
    ]);
  });

  it('accepts a dead key completed by a direct commit (no composition events)', () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    input.keydown(key(0, 'Quote', 'Dead', { shiftKey: true }));
    input.keyup(key(20, 'Quote', 'Dead', { shiftKey: true }));
    input.keydown(key(200, 'Space', '"'));
    const decision = input.beforeInput({ t: 201, inputType: 'insertText', data: '"', isComposing: false });
    expect(decision.preventDefault).toBe(true);
    expect(decision.actions).toEqual([
      { type: 'insert', t: 200, grapheme: '"', input: { path: 'dead-key', inputType: 'insertText', code: 'Quote', key: null, keys: ['Quote', 'Space'] } },
    ]);
  });

  it("counts both graphemes when an unmatched sequence commits ' and t together", () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    input.keydown(key(0, 'Quote', 'Dead'));
    input.compositionStart();
    input.keydown(key(150, 'KeyT', 't', { isComposing: true }));
    const actions = input.compositionEnd(152, "'t");
    expect(inserts(actions).map((a) => [a.grapheme, a.input.code])).toEqual([
      ["'", 'Quote'],
      ['t', 'KeyT'],
    ]);
  });

  it('treats a declared dead position reported as "Process" by an input method as a dead key', () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    const dead = input.keydown(key(0, 'Quote', 'Process', { isComposing: true }));
    expect(dead.actions).toContainEqual(expect.objectContaining({ observation: { type: 'dead-key', code: 'Quote', declared: true } }));
    input.compositionStart();
    input.keydown(key(120, 'Space', 'Process', { isComposing: true }));
    const actions = input.compositionEnd(125, "'");
    expect(inserts(actions)).toMatchObject([{ grapheme: "'", input: { path: 'dead-key', code: 'Quote' } }]);
    expect(actions.some((a) => a.type === 'invalidate')).toBe(false);
  });

  it('does not treat an unshifted Digit6 "Process" key as a dead key (only Shift+6 is dead)', () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    const d = input.keydown(key(0, 'Digit6', 'Process', { isComposing: true }));
    expect(d.actions).toEqual([]);
    input.compositionStart();
    expect(input.compositionEnd(20, '6')).toContainEqual(expect.objectContaining({ type: 'invalidate', reason: 'unexpected-composition' }));
  });

  it('Firefox/X11: an empty compositionend followed by a later insertText still types the dead key (recorded sequence)', () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    input.keydown(key(5026, 'Quote', 'Dead'));
    input.compositionStart();
    expect(input.beforeInput({ t: 5027, inputType: 'insertCompositionText', data: '´', isComposing: true }).preventDefault).toBe(false);
    input.keyup(key(5054, 'Quote', 'Dead'));
    input.keydown(key(5110, 'Space', ' ', { isComposing: true }));
    input.beforeInput({ t: 5111, inputType: 'insertCompositionText', data: '', isComposing: true });
    // compositionend arrives with nothing committed…
    expect(input.compositionEnd(5112, '')).toEqual([]);
    // …and the character follows as a separate, non-composing insertText.
    const d = input.beforeInput({ t: 5113, inputType: 'insertText', data: "'", isComposing: false });
    expect(inserts(d.actions)).toMatchObject([{ grapheme: "'", input: { path: 'dead-key', code: 'Quote', keys: ['Quote', 'Space'] } }]);
    expect(input.keyup(key(5136, 'Space', ' '))).toEqual([]);
  });

  it('Chromium/X11: a dead key reported as Process with a committed composition (recorded sequence)', () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    input.keydown(key(3794, 'Quote', 'Process'));
    input.compositionStart();
    input.beforeInput({ t: 3796, inputType: 'insertCompositionText', data: '´', isComposing: true });
    input.keyup(key(3820, 'Quote', 'Dead'));
    input.keydown(key(3877, 'Space', 'Process', { isComposing: true }));
    input.beforeInput({ t: 3881, inputType: 'insertCompositionText', data: "'", isComposing: true });
    expect(inserts(input.compositionEnd(3882, "'"))).toMatchObject([{ grapheme: "'", t: 3877, input: { path: 'dead-key', code: 'Quote' } }]);
  });

  it('records a discarded dead-key sequence without inventing an insertion', () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    input.keydown(key(0, 'Quote', 'Dead'));
    input.keyup(key(30, 'Quote', 'Dead'));
    input.keydown(key(200, 'KeyT', 't'));
    const up = input.keyup(key(260, 'KeyT', 't'));
    expect(up).toEqual([{ type: 'observe', t: 260, observation: { type: 'dead-key-discarded', keys: ['Quote', 'KeyT'] } }]);
  });

  it('treats a dead key the configured layout does not declare as a setup disagreement', () => {
    const input = new InputInterpreter(qwerty, { reference: true });
    const dead = input.keydown(key(0, 'Quote', 'Dead'));
    expect(dead.actions).toContainEqual(expect.objectContaining({ type: 'observe', observation: expect.objectContaining({ type: 'mapping', code: 'Quote' }) }));
    input.compositionStart();
    input.keydown(key(100, 'Space', ' ', { isComposing: true }));
    expect(input.compositionEnd(101, "'")).toContainEqual(expect.objectContaining({ type: 'invalidate', reason: 'unexpected-composition' }));
  });

  it("treats a plain apostrophe as a disagreement when US International is configured", () => {
    const input = new InputInterpreter(qwertyIntl, { reference: true });
    const actions = press(input, 0, 'Quote', "'");
    expect(actions).toContainEqual(expect.objectContaining({ observation: expect.objectContaining({ type: 'mapping', agreement: false }) }));
  });

  it('accepts AltGr characters that the layout declares', () => {
    const input = new InputInterpreter(qwertyIntl, { reference: false });
    const actions = press(input, 0, 'Comma', 'ç', { altGraph: true });
    expect(inserts(actions)).toMatchObject([{ grapheme: 'ç', input: { code: 'Comma', altGraph: true } }]);
    expect(actions.some((a) => a.type === 'observe')).toBe(false);
  });
});

describe('setup mismatch detection', () => {
  it('A02: typing QWERTY output while DL is configured raises an alert on the third consecutive disagreement', () => {
    const input = new InputInterpreter(dvorakLeft, { reference: true });
    const alerts: number[] = [];
    let t = 0;
    for (const [code, data] of [
      ['KeyF', 'f'],
      ['KeyQ', 'q'],
      ['KeyJ', 'j'],
      ['KeyA', 'a'],
    ] as const) {
      for (const action of press(input, (t += 100), code, data)) if (action.type === 'mapping-alert') alerts.push(action.t);
    }
    expect(alerts).toEqual([300]);
  });

  it('A02: Dvorak-L output agrees with the DL map (KeyQ → ;, KeyF → d)', () => {
    const input = new InputInterpreter(dvorakLeft, { reference: true });
    const actions = [...press(input, 0, 'KeyQ', ';'), ...press(input, 100, 'KeyF', 'd'), ...press(input, 200, 'Digit1', '{', { shiftKey: true })];
    expect(actions.filter((a) => a.type !== 'insert')).toEqual([]);
  });

  it('resets the disagreement streak on any agreeing key, so ordinary typos never trigger it', () => {
    const input = new InputInterpreter(dvorakLeft, { reference: true });
    const sequence = [
      ['KeyF', 'f'],
      ['KeyQ', 'q'],
      ['KeyF', 'd'],
      ['KeyJ', 'j'],
      ['KeyA', 'a'],
    ] as const;
    const actions = sequence.flatMap(([code, data], i) => press(input, i * 100, code, data));
    expect(actions.some((a) => a.type === 'mapping-alert')).toBe(false);
  });

  it('does not judge positions outside the layout, such as the numeric keypad', () => {
    const input = new InputInterpreter(dvorakLeft, { reference: true });
    const actions = [0, 1, 2, 3].flatMap((i) => press(input, i * 100, 'Numpad5', '5'));
    expect(actions.every((a) => a.type === 'insert')).toBe(true);
  });
});
