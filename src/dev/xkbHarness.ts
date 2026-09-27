// OS-level layout verification harness (development only).
//
// The page runs the real calibration code against whatever the operating
// system's XKB keymap produces. It reports each step's required keys to a
// driver (scripts/xkb-os-check.mjs), which presses physical keys with XTest
// in a private nested X server. Then it asks the driver to type a text and
// scores it with the reference input rules, to check that dead keys and the
// browser's input method produce verified native input.
import { buildPlan, type CalibrationStep } from '../domain/calibration/plan';
import { CalibrationSession, identifyLayout, summarize } from '../domain/calibration/session';
import { InputInterpreter, type InterpretedAction, type KeyObservation } from '../domain/input/interpreter';
import { type GeometryId, geometryById } from '../domain/layouts/geometry';
import { LAYOUTS, type LayoutId, layoutById, strokesFor } from '../domain/layouts/registry';
import { TrialEngine } from '../domain/scoring/engine';
import { toGraphemes } from '../domain/text/graphemes';
import { provenanceOf } from '../domain/trial-record';
import { committedText, resetSurface } from '../app/practice/TrialController';

const params = new URLSearchParams(location.search);
const layout = layoutById((params.get('layout') ?? 'qwerty-us-intl') as LayoutId);
const geometry = geometryById((params.get('geometry') ?? 'ansi-us') as GeometryId);
const report = params.get('report') ?? '';
const TEXTS: Record<string, string> = {
  qwerty: `It's "quoted" text: ~tilde, ^caret, \`grave\` and 50% of #1 (really)! The quick brown fox jumps over the lazy dog? [a{b}c] <d> e=f+g; h|i\\j @k $l &m *n _o -p`,
  'dvorak-left': 'The quick brown fox jumps over the lazy dog, 1234567890! "Quotes" and it\'s (fine): [a]{b}/c?',
  'dvorak-right': 'The quick brown fox jumps over the lazy dog, 1234567890! "Quotes" and it\'s (fine): [a]{b}/c?',
};

async function post(body: unknown): Promise<void> {
  if (!report) return;
  await fetch(report, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain' } }).catch(() => undefined);
}

function keysFor(step: CalibrationStep): { code: string; shift?: 'left' | 'right'; altGr?: boolean; capsLock?: boolean; then?: string }[] {
  const dead = (code: string, level: 0 | 1) => {
    const l = layout.keys[code]?.levels[level];
    return !!l && 'dead' in l;
  };
  switch (step.kind) {
    case 'position':
      return [{ code: step.code, ...(step.layer === 'shift' ? { shift: 'left' as const } : {}), ...(dead(step.code, step.layer === 'shift' ? 1 : 0) ? { then: 'Space' } : {}) }];
    case 'space':
      return [{ code: 'Space' }];
    case 'enter':
      return [{ code: 'Enter' }];
    case 'backspace':
      return [{ code: 'Backspace' }];
    case 'shift-side':
      return [{ code: step.code, shift: step.side }];
    case 'caps-lock':
      return [{ code: step.code, capsLock: true }];
    case 'info':
      return step.keys.map((k) => ({ code: k.code, ...(k.shift ? { shift: 'left' as const } : {}), ...(k.altGraph ? { altGr: true } : {}) }));
  }
}

const log = document.getElementById('log') as HTMLPreElement;
const el = document.getElementById('surface') as HTMLTextAreaElement;
const status = document.getElementById('status') as HTMLElement;
const say = (s: string) => {
  log.textContent = `${s}\n${log.textContent ?? ''}`.slice(0, 4000);
};

const plan = buildPlan('full', layout, geometry);
const session = new CalibrationSession(plan, geometry);
let phase: 'calibration' | 'await-typing' | 'typing' | 'done' = 'calibration';
let lastStepSent = -1;
const target = toGraphemes(TEXTS[layout.family] ?? TEXTS.qwerty ?? '');
const interpreter = new InputInterpreter(layout, { reference: true });
const engine = new TrialEngine({ kind: 'benchmark', timing: { mode: 'untimed' }, target });
const raw: unknown[] = [];

function obs(e: KeyboardEvent): KeyObservation {
  return { t: e.timeStamp, code: e.code, key: e.key, shiftKey: e.shiftKey, altGraph: e.getModifierState('AltGraph'), capsLock: e.getModifierState('CapsLock'), ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, isComposing: e.isComposing };
}

function applyTyping(actions: readonly InterpretedAction[]): void {
  for (const a of actions) {
    if (a.type === 'insert') engine.insert(a.t, a.grapheme, a.input);
    else if (a.type === 'delete') engine.deleteBackward(a.t, a.input);
    else if (a.type === 'invalidate') engine.invalidate(a.t, a.reason, a.detail);
    else if (a.type === 'observe') engine.observe(a.t, a.observation);
  }
}

function sendNextStep(): void {
  if (phase !== 'calibration') return;
  const index = session.results.length;
  if (session.done) {
    // Late output from the last calibration step must not reach the typing
    // phase; typing starts at the driver's explicit F8 marker.
    phase = 'await-typing';
    const summary = summarize(plan, session.results);
    void post({
      type: 'calibration',
      layout: layout.id,
      geometry: geometry.id,
      browser: navigator.userAgent,
      summary: { status: summary.status, checked: summary.checked, matched: summary.matched, skipped: summary.skipped, absent: summary.absent },
      mismatches: summary.mismatches.map((m) => ({ step: m.stepId, expected: m.step.kind === 'position' ? m.step.expected : m.step.kind, observed: m.observed })),
      info: session.results.filter((r) => r.step.kind === 'info' || r.step.kind === 'caps-lock').map((r) => ({ step: r.stepId, outcome: r.outcome, observed: r.observed })),
      identified: identifyLayout(session.observations, Object.values(LAYOUTS)).slice(0, 3),
    }).then(() => {
      const strokes = target.map((c) => {
        if (c === ' ') return { code: 'Space' };
        const s = strokesFor(layout, geometry, c).find((x) => x.level < 2);
        if (!s) return { code: 'Unknown', char: c };
        return { code: s.code, ...(s.level === 1 ? { shift: 'left' } : {}), ...(s.then ? { then: s.then.code } : {}) };
      });
      status.textContent = 'typing';
      void post({ type: 'type', strokes, text: target.join('') });
    });
    return;
  }
  if (index === lastStepSent) return;
  lastStepSent = index;
  const step = session.current as CalibrationStep;
  status.textContent = `step ${index + 1}/${plan.length}: ${step.id}`;
  void post({ type: 'step', index, id: step.id, keys: keysFor(step) });
}

el.addEventListener('keydown', (e) => {
  raw.push({ t: Math.round(e.timeStamp), type: 'keydown', code: e.code, key: e.key, shift: e.shiftKey, caps: e.getModifierState('CapsLock'), altgr: e.getModifierState('AltGraph'), composing: e.isComposing });
  if (e.code === 'F8' && phase === 'await-typing') {
    e.preventDefault();
    interpreter.reset();
    phase = 'typing';
    return;
  }
  if (e.code === 'F9') {
    e.preventDefault();
    // The driver finished typing: report the scored result.
    const outcome = engine.outcome(performance.now());
    phase = 'done';
    void post({
      type: 'typing',
      layout: layout.id,
      counters: outcome.counters,
      status: outcome.status,
      invalidity: outcome.invalidity,
      verification: provenanceOf(engine.events),
      wrong: engine.events.filter((x) => x.kind === 'insert' && !x.correct).map((x) => (x.kind === 'insert' ? { index: x.index, expected: x.expected, got: x.grapheme, code: x.input.code, path: x.input.path } : null)),
      paths: [...new Set(engine.events.filter((x) => x.kind === 'insert').map((x) => (x.kind === 'insert' ? x.input.path : '')))],
      raw,
    });
    status.textContent = 'done';
    return;
  }
  if (phase === 'calibration') {
    const f = session.keydown(obs(e));
    if (f.type !== 'none' && f.type !== 'recorded') say(`feedback ${f.type} ${'pressed' in f ? f.pressed : ''}`);
    sendNextStep();
  } else if (phase === 'typing') {
    const d = interpreter.keydown(obs(e));
    if (d.preventDefault) e.preventDefault();
    applyTyping(d.actions);
  }
});
el.addEventListener('keyup', (e) => {
  raw.push({ t: Math.round(e.timeStamp), type: 'keyup', code: e.code, key: e.key });
  if (phase === 'calibration') {
    session.keyup(obs(e));
    setTimeout(() => {
      session.settle();
      sendNextStep();
    }, 90);
  } else if (phase === 'typing') applyTyping(interpreter.keyup(obs(e)));
});
el.addEventListener('beforeinput', (e) => {
  raw.push({ t: Math.round(e.timeStamp), type: 'beforeinput', inputType: e.inputType, data: e.data, composing: e.isComposing });
  if (phase === 'calibration') {
    if (e.inputType.includes('Composition')) return;
    if (e.cancelable) e.preventDefault();
    session.input(e.inputType, e.data);
    sendNextStep();
  } else if (phase === 'typing') {
    const d = interpreter.beforeInput({ t: e.timeStamp, inputType: e.inputType, data: e.data, isComposing: e.isComposing });
    if (d.preventDefault && e.cancelable) e.preventDefault();
    applyTyping(d.actions);
  }
});
el.addEventListener('compositionstart', () => {
  raw.push({ type: 'compositionstart' });
  if (phase === 'typing') interpreter.compositionStart();
});
el.addEventListener('compositionend', (e) => {
  const t = e.timeStamp;
  setTimeout(() => {
    const text = committedText(el);
    raw.push({ type: 'compositionend', data: e.data, committed: text });
    resetSurface(el);
    if (phase === 'calibration') {
      session.input('insertText', text);
      sendNextStep();
    } else if (phase === 'typing') applyTyping(interpreter.compositionEnd(t, text));
  }, 0);
});

resetSurface(el);
el.focus();
document.addEventListener('click', () => el.focus());
status.textContent = 'ready';
void post({ type: 'ready', layout: layout.id, geometry: geometry.id, userAgent: navigator.userAgent }).then(() => sendNextStep());
