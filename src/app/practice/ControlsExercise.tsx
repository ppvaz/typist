// Level 1 control-key exercise: Space, Enter, both Shifts and Backspace, then
// a comfort confirmation. Comfort is the user's declaration; the app cannot
// observe which finger or hand was used.
import { useEffect, useRef, useState } from 'react';
import { geometryById } from '../../domain/layouts/geometry';
import { levelChar } from '../../domain/layouts/registry';
import type { ModeId } from '../../domain/modes';
import { Message, ModeIdentity } from '../components/basics';
import { KeyboardMap } from '../components/KeyboardMap';
import { currentSetup, modeOverview } from '../store/derive';
import { useAppState, useStore } from '../store/react';
import { resetSurface } from './TrialController';

interface Step {
  readonly id: string;
  readonly prompt: string;
  readonly code: string;
  readonly check: (e: { inputType: string; data: string | null; shiftSide: 'left' | 'right' | null }) => boolean;
}

export function ControlsExercise({ mode, onDone }: { mode: ModeId; onDone: () => void }) {
  const store = useStore();
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const o = modeOverview(state.data, mode, state.today, state.browserSession);
  const geometry = geometryById(setup?.geometryId ?? 'ansi-us');
  const upperF = levelChar(o.layout.keys.KeyF?.levels[1]) ?? 'F';
  const upperJ = levelChar(o.layout.keys.KeyJ?.levels[1]) ?? 'J';
  const steps: Step[] = [
    { id: 'space', prompt: 'Press Space with the thumb', code: 'Space', check: (e) => e.inputType === 'insertText' && e.data === ' ' },
    { id: 'enter', prompt: 'Press Enter', code: 'Enter', check: (e) => e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph' },
    { id: 'shift-left', prompt: `Hold the left Shift and press KeyF (${upperF})`, code: 'KeyF', check: (e) => e.inputType === 'insertText' && e.data === upperF && e.shiftSide === 'left' },
    { id: 'shift-right', prompt: `Hold the right Shift and press KeyJ (${upperJ})`, code: 'KeyJ', check: (e) => e.inputType === 'insertText' && e.data === upperJ && e.shiftSide === 'right' },
    { id: 'backspace', prompt: 'Press Backspace', code: 'Backspace', check: (e) => e.inputType === 'deleteContentBackward' },
  ];
  const [index, setIndex] = useState(o.state?.controlsCompletedAt ? steps.length : 0);
  const [hint, setHint] = useState<string | null>(null);
  const [comfortable, setComfortable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shift = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });

  useEffect(() => {
    const el = inputRef.current;
    if (!el || index >= steps.length) return;
    resetSurface(el);
    el.focus();
    const down = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft') shift.current.left = true;
      if (e.code === 'ShiftRight') shift.current.right = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft') shift.current.left = false;
      if (e.code === 'ShiftRight') shift.current.right = false;
    };
    const before = (e: InputEvent) => {
      if (e.inputType.includes('Composition')) return;
      if (e.cancelable) e.preventDefault();
      const step = steps[index];
      if (!step) return;
      const side = shift.current.left && !shift.current.right ? 'left' : shift.current.right && !shift.current.left ? 'right' : null;
      if (step.check({ inputType: e.inputType, data: e.data, shiftSide: side })) {
        setHint(null);
        setIndex((i) => i + 1);
      } else setHint('That was not this step; try again.');
    };
    el.addEventListener('keydown', down);
    el.addEventListener('keyup', up);
    el.addEventListener('beforeinput', before);
    return () => {
      el.removeEventListener('keydown', down);
      el.removeEventListener('keyup', up);
      el.removeEventListener('beforeinput', before);
    };
    // Steps depend only on the mode's layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  async function finish() {
    try {
      const now = new Date().toISOString();
      await store.updateModeState(mode, { controlsCompletedAt: o.state?.controlsCompletedAt ?? now, ...(comfortable ? { comfortConfirmedAt: now } : {}) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const step = steps[index];
  return (
    <main className="content" data-hand={o.layout.family === 'qwerty' ? (mode === 'QL' ? 'left' : 'right') : mode === 'DL' ? 'left' : 'right'}>
      <div className="stack" style={{ maxWidth: 980 }}>
        <ModeIdentity mode={mode} />
        <div>
          <div className="eyebrow">Level 1 · control keys</div>
          <h1 style={{ marginTop: 8 }}>{step ? step.prompt : 'Control keys done'}</h1>
        </div>
        {step ? (
          <>
            <label htmlFor="controls-input">Control-key input</label>
            <textarea id="controls-input" ref={inputRef} className="field" style={{ minHeight: 44, maxWidth: 260 }} autoComplete="off" spellCheck={false} />
            {hint && <p role="status">{hint}</p>}
            <p className="muted small">
              Step {index + 1} of {steps.length}. Relocate the whole hand if you need to; there is no clock here.
            </p>
            <KeyboardMap geometry={geometry} layout={o.layout} ledger={o.ledger} assistance="full-map" targetCode={step.code} targetModifier={step.id === 'shift-left' ? 'ShiftLeft' : step.id === 'shift-right' ? 'ShiftRight' : null} />
          </>
        ) : (
          <div className="panel panel-pad stack-sm">
            <p>Space, Enter, both Shift keys and Backspace all worked with your setup.</p>
            <label className="choice" style={{ maxWidth: 560 }}>
              <input type="checkbox" checked={comfortable} onChange={(e) => setComfortable(e.target.checked)} />
              The hand position, the anchors and these reaches feel comfortable. (If anything hurts, stop and adjust; discomfort is a reason to change the plan, never to push on.)
            </label>
            {error && <Message kind="error">{error}</Message>}
            <div className="inline-actions">
              <button type="button" className="btn btn-primary" onClick={() => void finish()}>
                {comfortable ? 'Save and continue' : 'Save without confirming comfort'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
