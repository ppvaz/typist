import { describe, expect, it } from 'vitest';
import { buildPlan, type CalibrationStep } from '../../src/domain/calibration/plan';
import { CalibrationSession, identifyLayout, summarize } from '../../src/domain/calibration/session';
import type { KeyObservation } from '../../src/domain/input/interpreter';
import { geometryById } from '../../src/domain/layouts/geometry';
import { LAYOUTS, type LayoutDefinition, layoutById, levelChar, levelDead } from '../../src/domain/layouts/registry';

function obs(code: string, key: string, extra: Partial<KeyObservation> = {}): KeyObservation {
  return { t: 0, code, key, shiftKey: false, altGraph: false, capsLock: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, ...extra };
}

interface Press {
  shift?: boolean;
  shiftCode?: 'ShiftLeft' | 'ShiftRight';
  capsLock?: boolean;
  altGraph?: boolean;
  /** How the simulated OS completes dead keys and unmatched sequences. */
  unmatchedDeadSequence?: 'discard' | 'both';
}

/** Simulate the OS producing output for one physical key under `os`. */
function pressOn(session: CalibrationSession, os: LayoutDefinition, code: string, press: Press = {}): void {
  const shiftCode = press.shiftCode ?? 'ShiftLeft';
  const flags = { shiftKey: !!press.shift, capsLock: !!press.capsLock, altGraph: !!press.altGraph };
  if (press.shift) session.keydown(obs(shiftCode, 'Shift', { shiftKey: true }));
  if (code === 'Space' || code === 'Enter' || code === 'Backspace') {
    const keyValue = code === 'Space' ? ' ' : code;
    session.keydown(obs(code, keyValue, flags));
    if (code === 'Space') session.input('insertText', ' ');
    if (code === 'Enter') session.input('insertLineBreak', null);
    if (code === 'Backspace') session.input('deleteContentBackward', null);
    session.keyup(obs(code, keyValue, flags));
  } else {
    const key = os.keys[code];
    const level = (press.altGraph ? 2 : 0) + (press.shift ? 1 : 0);
    let out = key?.levels[level] ?? null;
    const char = levelChar(out);
    const upper = char && press.capsLock && key?.capsLock === 'shift-level' ? levelChar(key.levels[1]) : char;
    if (upper !== null) {
      session.keydown(obs(code, upper, flags));
      session.input('insertText', upper);
      session.keyup(obs(code, upper, flags));
    } else if (levelDead(out)) {
      const dead = levelDead(out) ?? '';
      session.keydown(obs(code, 'Dead', flags));
      session.keyup(obs(code, 'Dead', flags));
      session.keydown(obs('Space', ' '));
      session.input('insertText', os.deadKeySpace[dead] ?? '');
      session.keyup(obs('Space', ' '));
    } else {
      out = null;
      session.keydown(obs(code, 'Unidentified', flags));
      session.keyup(obs(code, 'Unidentified', flags));
    }
  }
  if (press.shift) session.keyup(obs(shiftCode, 'Shift'));
  session.settle();
}

/** Perform whatever the current step asks, as a cooperative user would. */
function perform(session: CalibrationSession, os: LayoutDefinition, step: CalibrationStep, press: Press = {}): void {
  switch (step.kind) {
    case 'position':
      pressOn(session, os, step.code, { shift: step.layer === 'shift' });
      return;
    case 'space':
      pressOn(session, os, 'Space');
      return;
    case 'enter':
      pressOn(session, os, 'Enter');
      return;
    case 'backspace':
      pressOn(session, os, 'Backspace');
      return;
    case 'shift-side':
      pressOn(session, os, step.code, { shift: true, shiftCode: step.side === 'left' ? 'ShiftLeft' : 'ShiftRight' });
      return;
    case 'caps-lock':
      pressOn(session, os, step.code, { capsLock: true });
      return;
    case 'info': {
      const [first, second] = step.keys;
      if (!first) return;
      if (step.prompt === 'altgr') {
        pressOn(session, os, first.code, { altGraph: true });
        return;
      }
      session.keydown(obs(first.code, 'Dead'));
      session.keyup(obs(first.code, 'Dead'));
      if (second) {
        const letter = levelChar(os.keys[second.code]?.levels[0]) ?? '';
        session.keydown(obs(second.code, letter));
        if (press.unmatchedDeadSequence === 'both') session.input('insertText', `'${letter}`);
        session.keyup(obs(second.code, letter));
      }
      session.settle();
      return;
    }
  }
}

function runAll(session: CalibrationSession, os: LayoutDefinition, press: Press = {}): void {
  let guard = 0;
  while (session.current && guard < 500) {
    perform(session, os, session.current, press);
    guard += 1;
  }
}

const ansi = geometryById('ansi-us');
const abnt2 = geometryById('abnt2');

describe('calibration plans', () => {
  it('walks every printable position in base and Shift layers, plus controls', () => {
    const plan = buildPlan('full', layoutById('dvorak-left-us'), ansi);
    expect(plan.filter((s) => s.kind === 'position')).toHaveLength(94);
    expect(plan.map((s) => s.kind)).toEqual(expect.arrayContaining(['space', 'enter', 'backspace', 'shift-side', 'caps-lock']));
    expect(plan.filter((s) => s.kind === 'shift-side').map((s) => (s.kind === 'shift-side' ? s.side : ''))).toEqual(['left', 'right']);
  });

  it('asks about Caps Lock only where the physical key is Caps Lock', () => {
    for (const id of ['colemak-us', 'workman-us'] as const) {
      expect(layoutById(id).capsLockKey).toBe('backspace');
      expect(buildPlan('full', layoutById(id), ansi).some((s) => s.kind === 'caps-lock')).toBe(false);
    }
    expect(buildPlan('full', layoutById('qwerty-us-intl'), ansi).some((s) => s.kind === 'caps-lock')).toBe(true);
  });

  it('includes ABNT2-only positions, marked as geometry specific', () => {
    const plan = buildPlan('full', layoutById('qwerty-us-intl'), abnt2);
    const specific = plan.filter((s) => s.kind === 'position' && s.geometrySpecific).map((s) => s.id);
    expect(specific).toEqual(['base:IntlBackslash', 'base:IntlRo', 'shift:IntlBackslash', 'shift:IntlRo']);
  });

  it('expects dead keys completed by Space and informational probes on US International', () => {
    const plan = buildPlan('full', layoutById('qwerty-us-intl'), ansi);
    expect(plan.find((s) => s.id === 'base:Quote')).toMatchObject({ expected: { type: 'dead', name: 'acute', thenSpace: "'" } });
    expect(plan.filter((s) => s.kind === 'info').map((s) => s.id)).toEqual(['info:dead-then-t', 'info:dead-then-c', 'info:altgr-comma']);
    expect(buildPlan('full', layoutById('dvorak-right-us'), ansi).some((s) => s.kind === 'info')).toBe(false);
  });

  it('keeps the short probe to KeyQ, KeyF, KeyJ, Digit5 and one shifted symbol', () => {
    expect(buildPlan('probe', layoutById('qwerty-us'), ansi).map((s) => s.id)).toEqual([
      'base:KeyQ',
      'base:KeyF',
      'base:KeyJ',
      'base:Digit5',
      'shift:Digit1',
    ]);
  });
});

describe('browser-specific dead-key delivery (recorded on X11)', () => {
  const intl = layoutById('qwerty-us-intl');

  function atQuote(): CalibrationSession {
    const plan = buildPlan('full', intl, ansi);
    const session = new CalibrationSession(plan, ansi);
    while (session.current?.id !== 'base:Quote') perform(session, intl, session.current as CalibrationStep);
    return session;
  }

  it('Chromium: "Process" keydown, composition committed on compositionend', () => {
    const session = atQuote();
    session.keydown(obs('Quote', 'Process'));
    session.keyup(obs('Quote', 'Dead'));
    session.keydown(obs('Space', 'Process', { isComposing: true }));
    session.input('insertText', "'");
    expect(session.results.at(-1)).toMatchObject({ stepId: 'base:Quote', outcome: 'match' });
  });

  it('Firefox: empty compositionend first, the character in a later insertText', () => {
    const session = atQuote();
    session.keydown(obs('Quote', 'Dead'));
    session.keyup(obs('Quote', 'Dead'));
    session.keydown(obs('Space', ' ', { isComposing: true }));
    expect(session.input('insertText', '')).toEqual({ type: 'none' });
    session.input('insertText', "'");
    expect(session.results.at(-1)).toMatchObject({ stepId: 'base:Quote', outcome: 'match' });
  });
});

describe('calibration runs', () => {
  for (const layout of Object.values(LAYOUTS)) {
    for (const geometry of [ansi, abnt2]) {
      it(`passes ${layout.id} on ${geometry.id} when the OS uses the same layout`, () => {
        const plan = buildPlan('full', layout, geometry);
        const session = new CalibrationSession(plan, geometry);
        runAll(session, layout);
        const summary = summarize(plan, session.results);
        expect(summary.mismatches.map((m) => m.stepId)).toEqual([]);
        expect(summary.status).toBe('passed');
      });
    }
  }

  it('A02: selecting DL with QWERTY active identifies the mismatches and the likely OS layout', () => {
    const dl = layoutById('dvorak-left-us');
    const plan = buildPlan('probe', dl, ansi);
    const session = new CalibrationSession(plan, ansi);
    runAll(session, layoutById('qwerty-us'));
    const summary = summarize(plan, session.results);
    expect(summary.status).toBe('failed');
    expect(summary.mismatches.map((m) => [m.stepId, m.observed])).toEqual([
      ['base:KeyQ', { type: 'char', char: 'q' }],
      ['base:KeyF', { type: 'char', char: 'f' }],
      ['base:KeyJ', { type: 'char', char: 'j' }],
      ['base:Digit5', { type: 'char', char: '5' }],
      ['shift:Digit1', { type: 'char', char: '!' }],
    ]);
    const ranking = identifyLayout(session.observations, Object.values(LAYOUTS));
    expect(ranking[0]?.layoutId).toMatch(/^qwerty-us/);
    expect(ranking[0]?.agreements).toBe(5);
  });

  it('A02: with Dvorak-L active, KeyQ yields ; and KeyF yields d', () => {
    const dl = layoutById('dvorak-left-us');
    const plan = buildPlan('probe', dl, ansi);
    const session = new CalibrationSession(plan, ansi);
    runAll(session, dl);
    expect(session.results.slice(0, 2).map((r) => r.observed)).toEqual([
      { type: 'char', char: ';' },
      { type: 'char', char: 'd' },
    ]);
    expect(summarize(plan, session.results).status).toBe('passed');
  });

  it('distinguishes plain US from US International by the dead keys', () => {
    const plan = buildPlan('full', layoutById('qwerty-us-intl'), ansi);
    const session = new CalibrationSession(plan, ansi);
    runAll(session, layoutById('qwerty-us'));
    const summary = summarize(plan, session.results);
    expect(summary.status).toBe('failed');
    expect(summary.mismatches.map((m) => m.stepId)).toEqual(['base:Backquote', 'base:Quote', 'shift:Backquote', 'shift:Digit6', 'shift:Quote']);
  });

  it('records what an unmatched dead-key sequence produced without failing calibration', () => {
    const intl = layoutById('qwerty-us-intl');
    const plan = buildPlan('full', intl, ansi);
    const discard = new CalibrationSession(plan, ansi);
    runAll(discard, intl, { unmatchedDeadSequence: 'discard' });
    expect(discard.results.find((r) => r.stepId === 'info:dead-then-t')?.observed).toEqual({ type: 'committed', text: '' });
    const both = new CalibrationSession(plan, ansi);
    runAll(both, intl, { unmatchedDeadSequence: 'both' });
    expect(both.results.find((r) => r.stepId === 'info:dead-then-t')?.observed).toEqual({ type: 'committed', text: "'t" });
    expect(summarize(plan, both.results).status).toBe('passed');
  });

  it('prompts for the right modifier instead of recording a wrong layer', () => {
    const qwerty = layoutById('qwerty-us');
    const session = new CalibrationSession(buildPlan('full', qwerty, ansi), ansi);
    expect(session.keydown(obs('Backquote', '~', { shiftKey: true }))).toEqual({ type: 'release-shift' });
    expect(session.keydown(obs('KeyZ', 'z'))).toEqual({ type: 'wrong-key', pressed: 'KeyZ' });
    expect(session.results).toHaveLength(0);
  });

  it('suggests another geometry when a key the configured board lacks is pressed', () => {
    const session = new CalibrationSession(buildPlan('full', layoutById('qwerty-us'), ansi), ansi);
    expect(session.keydown(obs('IntlBackslash', '<'))).toEqual({ type: 'geometry-hint', code: 'IntlBackslash' });
  });

  it('lets the user report an ABNT2-only key as absent, leaving calibration incomplete', () => {
    const layout = layoutById('qwerty-us');
    const plan = buildPlan('full', layout, abnt2);
    const session = new CalibrationSession(plan, abnt2);
    while (session.current && !(session.current.kind === 'position' && session.current.geometrySpecific)) {
      perform(session, layout, session.current);
    }
    expect(session.markAbsent().type).toBe('recorded');
    runAll(session, layout);
    const summary = summarize(plan, session.results);
    expect(summary.status).toBe('incomplete');
    expect(summary.absent).toEqual(['IntlBackslash']);
  });

  it('checks Caps Lock only on the positive-control letter and asks for it to be on', () => {
    const layout = layoutById('dvorak-right-us');
    const plan = buildPlan('full', layout, ansi);
    const session = new CalibrationSession(plan, ansi);
    while (session.current && session.current.kind !== 'caps-lock') perform(session, layout, session.current);
    expect(session.keydown(obs('KeyF', 'a'))).toEqual({ type: 'turn-caps-lock-on' });
    session.keyup(obs('KeyF', 'a'));
    perform(session, layout, session.current as CalibrationStep);
    expect(session.results.at(-1)).toMatchObject({ stepId: 'control:caps-lock', outcome: 'match', observed: { type: 'char', char: 'A' } });
  });
});
