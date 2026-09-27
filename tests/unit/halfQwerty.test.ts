import { describe, expect, it } from 'vitest';
import { HalfQwertyInterpreter, MIRROR } from '../../src/domain/input/halfQwerty';
import type { InterpretedAction, KeyObservation } from '../../src/domain/input/interpreter';
import { layoutById } from '../../src/domain/layouts/registry';

function key(t: number, code: string, keyValue: string, extra: Partial<KeyObservation> = {}): KeyObservation {
  return { t, code, key: keyValue, shiftKey: false, altGraph: false, capsLock: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, ...extra };
}

const us = layoutById('qwerty-us');
const make = (tapMaxMs: number | null = null) => new HalfQwertyInterpreter({ hand: 'left', layout: us, reference: true, tapMaxMs });
const typed = (actions: InterpretedAction[]) => actions.flatMap((a) => (a.type === 'insert' ? [a.grapheme] : a.type === 'delete' ? ['⌫'] : []));

describe('Half-QWERTY emulation', () => {
  it('mirrors every left-hand letter to its right-hand twin while Space is held', () => {
    for (const [a, b] of Object.entries(MIRROR)) expect(MIRROR[b]).toBe(a);
    const hq = make();
    const out: InterpretedAction[] = [];
    out.push(...hq.keydown(key(0, 'Space', ' ')).actions);
    for (const code of ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG']) out.push(...hq.keydown(key(10, code, 'x')).actions);
    out.push(...hq.keyup(key(90, 'Space', ' ')));
    expect(typed(out)).toEqual([';', 'l', 'k', 'j', 'h']);
  });

  it('types a space on a clean tap and nothing when Space was used as the modifier', () => {
    const hq = make();
    const tap = [...hq.keydown(key(0, 'Space', ' ')).actions, ...hq.keyup(key(80, 'Space', ' '))];
    expect(typed(tap)).toEqual([' ']);
    expect(tap[0]).toMatchObject({ t: 0, input: { inputType: 'emulated', code: 'Space' } });
    const hold = [...hq.keydown(key(100, 'Space', ' ')).actions, ...hq.keydown(key(150, 'KeyR', 'r')).actions, ...hq.keyup(key(220, 'Space', ' '))];
    expect(typed(hold)).toEqual(['u']);
  });

  it('ignores Space auto-repeat and optionally cancels a long idle hold', () => {
    const hq = make(400);
    const out = [...hq.keydown(key(0, 'Space', ' ')).actions, ...hq.keydown(key(300, 'Space', ' ', { repeat: true })).actions, ...hq.keyup(key(900, 'Space', ' '))];
    expect(typed(out)).toEqual([]);
    expect(out.some((a) => a.type === 'observe')).toBe(true);
  });

  it('keeps Shift and Caps Lock, and records mirrored keys by physical position', () => {
    const hq = make();
    hq.keydown(key(0, 'Space', ' '));
    const d = hq.keydown(key(5, 'KeyE', 'E', { shiftKey: true }));
    expect(d).toMatchObject({ preventDefault: true, actions: [{ grapheme: 'I', input: { code: 'KeyE', keys: ['KeyE', 'KeyE'] } }] });
    hq.keyup(key(9, 'Space', ' '));
    expect(typed(hq.keydown(key(20, 'KeyW', 'w', { capsLock: true })).actions)).toEqual(['W']);
  });

  it('mirrors editing keys: Space+Tab is Backspace, Space+Caps Lock is Enter; plain Tab still leaves', () => {
    const hq = make();
    expect(hq.keydown(key(0, 'Tab', 'Tab'))).toEqual({ preventDefault: false, actions: [] });
    hq.keydown(key(10, 'Space', ' '));
    expect(typed(hq.keydown(key(20, 'Tab', 'Tab')).actions)).toEqual(['⌫']);
    expect(typed(hq.keydown(key(30, 'CapsLock', 'CapsLock')).actions)).toEqual(['\n']);
    expect(hq.keyup(key(40, 'Space', ' '))).toEqual([]);
  });

  it('counts auto-repeated characters as attempts and prevents the OS text', () => {
    const hq = make();
    expect(typed(hq.keydown(key(0, 'KeyA', 'a', { repeat: true })).actions)).toEqual(['a']);
    expect(hq.beforeInput({ t: 1, inputType: 'insertText', data: 'a', isComposing: false })).toEqual({ preventDefault: true, actions: [] });
    expect(hq.beforeInput({ t: 2, inputType: 'insertFromPaste', data: 'abc', isComposing: false }).actions).toMatchObject([{ type: 'invalidate', reason: 'paste' }]);
  });

  it('produces QWERTY characters from physical positions whatever the OS layout reports', () => {
    const hq = make();
    // An OS Dvorak layout reports key ";" at KeyQ; the emulation still types q.
    expect(typed(hq.keydown(key(0, 'KeyQ', ';')).actions)).toEqual(['q']);
  });
});
