// Calibration: checks that the OS input source produces what the layout
// table says, position by position. It never counts as practice.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPlan, type CalibrationKind, type CalibrationStep } from '../../domain/calibration/plan';
import { CalibrationSession, type Feedback, identifyLayout, summarize } from '../../domain/calibration/session';
import type { KeyObservation } from '../../domain/input/interpreter';
import { newId } from '../../domain/ids';
import { LAYOUTS, type LayoutId, layoutById } from '../../domain/layouts/registry';
import { RECORD_SCHEMA_VERSION, type CalibrationRecord } from '../../domain/records';
import { Message } from '../components/basics';
import { committedText, resetSurface } from '../practice/TrialController';
import { KeyboardMap } from '../components/KeyboardMap';
import { browserLabel } from '../runtime/env';
import { currentLedger, geometryFor } from '../store/derive';
import { useAppState, useSetup, useStore } from '../store/react';

function describeExpected(step: CalibrationStep): string {
  switch (step.kind) {
    case 'position':
      if (step.expected.type === 'char') return step.expected.char === ' ' ? 'Space' : step.expected.char;
      if (step.expected.type === 'dead') return `dead key (then Space → ${step.expected.thenSpace})`;
      return 'nothing';
    case 'space':
      return 'a space';
    case 'enter':
      return 'a new line';
    case 'backspace':
      return 'a deletion';
    case 'shift-side':
    case 'caps-lock':
      return step.expected;
    case 'info':
      return 'whatever your system produces';
  }
}

function instruction(step: CalibrationStep): string {
  switch (step.kind) {
    case 'position':
      return step.layer === 'shift' ? `Hold Shift and press ${step.code}` : `Press ${step.code}`;
    case 'space':
      return 'Press Space';
    case 'enter':
      return 'Press Enter';
    case 'backspace':
      return 'Press Backspace';
    case 'shift-side':
      return `Hold the ${step.side} Shift and press ${step.code}`;
    case 'caps-lock':
      return `Turn Caps Lock on, press ${step.code}, then turn Caps Lock off again (optional: skip if Caps Lock is remapped)`;
    case 'info':
      return step.prompt === 'dead-then-letter'
        ? `Press ${step.keys.map((k) => k.code).join(', then ')} (recorded only: shows how your system combines a dead key with a letter)`
        : `Hold AltGr (right Alt) and press ${step.keys[0]?.code} (recorded only)`;
  }
}

function feedbackText(f: Feedback): string | null {
  switch (f.type) {
    case 'wrong-key':
      return `That was ${f.pressed}. Press the highlighted position instead; nothing was recorded.`;
    case 'hold-shift':
      return 'Hold Shift for this one.';
    case 'release-shift':
      return 'Release Shift for this one.';
    case 'use-shift':
      return `Use the ${f.side} Shift key.`;
    case 'turn-caps-lock-on':
      return 'Turn Caps Lock on first.';
    case 'turn-caps-lock-off':
      return 'Caps Lock is on; turn it off for this step.';
    case 'press-space-after-dead':
      return 'That key is a dead key. Press it again, then Space, to see what it produces.';
    case 'dead-key-detected':
      return 'Dead key detected — now press Space.';
    case 'geometry-hint':
      return `${f.code} exists only on some keyboards (it is not on the configured ${'geometry'}). Your keyboard may be ISO/ABNT2 rather than ANSI; check Setup.`;
    default:
      return null;
  }
}

export function CalibrationScreen({ layoutId, kind, onDone }: { layoutId: LayoutId; kind: CalibrationKind; onDone: (record: CalibrationRecord | null) => void }) {
  const store = useStore();
  const state = useAppState();
  const setup = useSetup();
  const layout = layoutById(layoutId);
  const geometry = geometryFor(setup);
  const plan = useMemo(() => buildPlan(kind, layout, geometry), [kind, layout, geometry]);
  const [session, setSession] = useState(() => new CalibrationSession(plan, geometry));
  const [, setTick] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [saved, setSaved] = useState<CalibrationRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const startedAt = useRef(new Date().toISOString());
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const handle = useCallback(
    (f: Feedback) => {
      const text = feedbackText(f);
      if (f.type === 'recorded') setFeedback(null);
      else if (text) setFeedback(text);
      rerender();
    },
    [rerender],
  );

  useEffect(() => {
    const el = inputRef.current;
    if (!el || !started) return;
    resetSurface(el);
    el.focus();
    const obs = (e: KeyboardEvent): KeyObservation => ({
      t: 0,
      code: e.code,
      key: e.key,
      shiftKey: e.shiftKey,
      altGraph: e.getModifierState?.('AltGraph') ?? false,
      capsLock: e.getModifierState?.('CapsLock') ?? false,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      repeat: e.repeat,
      isComposing: e.isComposing,
    });
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Escape') return;
      if (e.repeat) return;
      handle(session.keydown(obs(e)));
    };
    const keyup = (e: KeyboardEvent) => {
      handle(session.keyup(obs(e)));
      setTimeout(() => handle(session.settle()), 90);
    };
    const beforeinput = (e: InputEvent) => {
      if (e.inputType.includes('Composition')) return;
      if (e.cancelable) e.preventDefault();
      handle(session.input(e.inputType, e.data));
    };
    const compositionend = () => {
      setTimeout(() => {
        const text = committedText(el);
        resetSurface(el);
        handle(session.input('insertText', text));
      }, 0);
    };
    el.addEventListener('keydown', keydown);
    el.addEventListener('keyup', keyup);
    el.addEventListener('beforeinput', beforeinput);
    el.addEventListener('compositionend', compositionend);
    return () => {
      el.removeEventListener('keydown', keydown);
      el.removeEventListener('keyup', keyup);
      el.removeEventListener('beforeinput', beforeinput);
      el.removeEventListener('compositionend', compositionend);
    };
  }, [session, started, handle]);

  const step = session.current;
  const summary = summarize(plan, session.results);
  const verification = useMemo(() => {
    const map = new Map<string, 'ok' | 'bad' | 'unverified'>();
    for (const code of geometry.printableCodes) map.set(code, 'unverified');
    const byCode = new Map<string, string[]>();
    for (const r of session.results) {
      if (r.step.kind !== 'position') continue;
      const list = byCode.get(r.step.code) ?? [];
      list.push(r.outcome);
      byCode.set(r.step.code, list);
    }
    for (const [code, outcomes] of byCode) {
      if (outcomes.includes('mismatch')) map.set(code, 'bad');
      else if (outcomes.includes('match') && (kind === 'probe' || outcomes.length >= 2)) map.set(code, 'ok');
    }
    return map;
    // session.results mutates in place; the tick re-renders.
  }, [session, geometry, kind, session.results.length]);

  const identified = identifyLayout(session.observations, Object.values(LAYOUTS)).slice(0, 3);
  const done = session.done;
  const targetCode = step && (step.kind === 'position' || step.kind === 'shift-side' || step.kind === 'caps-lock') ? step.code : step?.kind === 'space' ? 'Space' : step?.kind === 'enter' ? 'Enter' : step?.kind === 'backspace' ? 'Backspace' : step?.kind === 'info' ? (step.keys[0]?.code ?? null) : null;

  async function save() {
    if (!setup) return;
    const record: CalibrationRecord = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: newId(),
      setupRevisionId: setup.id,
      layoutId,
      layoutRevision: layout.revision,
      geometryId: geometry.id,
      kind,
      startedAt: startedAt.current,
      completedAt: new Date().toISOString(),
      status: summary.status,
      checked: summary.checked,
      matched: summary.matched,
      results: session.results.map((r) => ({ stepId: r.stepId, outcome: r.outcome, expected: r.step.kind === 'position' ? r.step.expected : r.step.kind, observed: r.observed })),
      identified,
      browserSessionId: state.browserSession,
      browser: browserLabel(),
      absent: summary.absent,
    };
    try {
      const geometryVerified = kind === 'full' && summary.status === 'passed' && geometry.distinguishingCodes.every((c) => session.results.some((r) => r.step.kind === 'position' && r.step.code === c && r.outcome === 'match'));
      await store.saveCalibration(record, geometryVerified);
      setSaved(record);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const ledger = currentLedger(state.data.ledgers, layout.family === 'dvorak-left' ? 'DL' : layout.family === 'dvorak-right' ? 'DR' : 'QR', setup?.setupId ?? null);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">{kind === 'full' ? 'Full calibration' : 'Short probe'} · {layout.name}</div>
          <h1>Check {layout.xkbName} against your OS</h1>
        </div>
        <div className="aside small">
          {summary.matched} of {plan.filter((s) => s.kind !== 'info').length} checks matched · never scored
        </div>
      </div>
      <Message kind="observed" tag="Read me">
        Choosing a mode changes what Typist trains and measures. It does not change your operating system's keyboard layout — you switch that yourself, and this screen checks that
        the two agree. Select <strong>{layout.os.inputSourceLabel ?? layout.xkbName}</strong> (XKB <code>{layout.xkbName}</code>) as your input source now. On GNOME: Settings →
        Keyboard → Input Sources.
      </Message>
      {!started ? (
        <div className="inline-actions">
          <button type="button" className="btn btn-primary btn-large" onClick={() => setStarted(true)}>
            Start {kind === 'full' ? 'full calibration' : 'the short probe'}
          </button>
          <button type="button" className="btn" onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="stack">
          {!done && step && (
            <div className="panel panel-pad" data-hand="right">
              <div className="eyebrow">
                Step {session.results.length + 1} of {plan.length}
              </div>
              <h2 style={{ marginTop: 8 }}>{instruction(step)}</h2>
              <p className="muted small">
                Expected under {layout.xkbName}: <strong className="mono">{describeExpected(step)}</strong>
                {step.kind === 'position' && step.geometrySpecific ? ' · this key exists only on some keyboards' : ''}
              </p>
              <label htmlFor="calibration-input">Calibration input (focus stays here)</label>
              <textarea id="calibration-input" ref={inputRef} className="field" style={{ minHeight: 44, maxWidth: 260 }} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
              {feedback && (
                <p className="small" role="status" style={{ marginTop: 8 }}>
                  {feedback}
                </p>
              )}
              <div className="inline-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-small" onClick={() => { handle(session.skip()); inputRef.current?.focus(); }}>
                  Skip this check
                </button>
                {step.kind === 'position' && step.geometrySpecific && (
                  <button type="button" className="btn btn-small" onClick={() => { handle(session.markAbsent()); inputRef.current?.focus(); }}>
                    Not on my keyboard
                  </button>
                )}
                <button type="button" className="btn btn-small btn-quiet" onClick={() => { setSession(new CalibrationSession(plan, geometry)); setFeedback(null); }}>
                  Restart
                </button>
              </div>
            </div>
          )}
          <KeyboardMap geometry={geometry} layout={layout} ledger={ledger} assistance="full-map" targetCode={targetCode} verification={verification} label="Calibration map: highlighted key is the one to press; hatched keys are not yet verified" />
          {done && (
            <div className="panel panel-pad stack-sm">
              <h2>
                {summary.status === 'passed' ? 'Calibration passed' : summary.status === 'failed' ? 'Calibration found mismatches' : 'Calibration incomplete'}
              </h2>
              <p>
                {summary.matched} of {summary.checked} checks matched{summary.skipped ? ` · ${summary.skipped} skipped` : ''}
                {summary.absent.length ? ` · reported absent: ${summary.absent.join(', ')}` : ''}.
              </p>
              {summary.mismatches.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <caption>Positions where the OS disagreed with {layout.xkbName}</caption>
                    <thead>
                      <tr>
                        <th>Check</th>
                        <th>Expected</th>
                        <th>Observed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.mismatches.slice(0, 20).map((m) => (
                        <tr key={m.stepId}>
                          <td className="mono">{m.stepId}</td>
                          <td className="mono">{describeExpected(m.step)}</td>
                          <td className="mono">{JSON.stringify(m.observed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {identified[0] && identified[0].layoutId !== layoutId && identified[0].agreements > (identified.find((i) => i.layoutId === layoutId)?.agreements ?? 0) && (
                <Message kind="tentative" tag="Looks like">
                  The output matches <code>{layoutById(identified[0].layoutId as LayoutId).xkbName}</code> better ({identified[0].agreements} of {identified[0].comparisons}). Your OS is
                  probably set to that layout; switch the input source and calibrate again.
                </Message>
              )}
              {error && <Message kind="error">{error}</Message>}
              {saved ? (
                <div className="inline-actions">
                  <Message kind={saved.status === 'passed' ? 'met' : 'short'} tag="Saved">
                    Calibration saved for setup revision {setup?.revision}.
                  </Message>
                  <button type="button" className="btn btn-primary" onClick={() => onDone(saved)}>
                    Continue
                  </button>
                </div>
              ) : (
                <div className="inline-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!store.writable}>
                    Save calibration
                  </button>
                  <button type="button" className="btn" onClick={() => { setSession(new CalibrationSession(plan, geometry)); setFeedback(null); }}>
                    Run again
                  </button>
                  {!store.writable && <span className="disabled-reason">This tab is read-only.</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
