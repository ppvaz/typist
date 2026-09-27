// The practice screen for one running trial. Accuracy comes first and is
// never smaller than speed; speed can be hidden. The textarea is the real
// input; Tab leaves it, Escape ends the trial, Space always types a space.
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AssistanceLevel } from '../../domain/input/types';
import type { GeometryDefinition } from '../../domain/layouts/geometry';
import { type LayoutDefinition, strokesFor } from '../../domain/layouts/registry';
import { modeById, type ModeId } from '../../domain/modes';
import type { FingeringLedger } from '../../domain/records';
import { formatAccuracy, formatWpm } from '../../domain/scoring/metrics';
import { toGraphemes } from '../../domain/text/graphemes';
import { handOf, ModeIdentity, Segmented } from '../components/basics';
import { KeyboardMap, MapLegend } from '../components/KeyboardMap';
import { SingleTarget, TargetText } from '../components/TargetText';
import { clock } from '../format';
import type { TrialController } from './TrialController';

export interface PracticeViewProps {
  readonly controller: TrialController;
  readonly mode: ModeId;
  readonly layout: LayoutDefinition;
  readonly geometry: GeometryDefinition;
  readonly ledger: FingeringLedger | null;
  readonly title: string;
  readonly subtitle: string;
  readonly targetLabel: string;
  /** Speed withheld until the end (benchmarks) or by preference. */
  readonly speedVisible: boolean;
  readonly speedHiddenReason?: string;
  readonly weakCodes?: readonly string[];
  readonly showFingers?: boolean;
  readonly onEndBlock?: () => void;
  readonly endLabel?: string;
  readonly footerNote?: ReactNode;
  readonly practiceScale?: number;
}

const ASSISTANCE: readonly { value: AssistanceLevel; label: string }[] = [
  { value: 'full-map', label: 'Full map' },
  { value: 'anchors', label: 'Anchors' },
  { value: 'none', label: 'Off' },
];

function strokeFor(layout: LayoutDefinition, geometry: GeometryDefinition, char: string | undefined): { code: string | null; modifier: string | null } {
  if (char === undefined) return { code: null, modifier: null };
  if (char === '\n') return { code: 'Enter', modifier: null };
  const stroke = strokesFor(layout, geometry, char)[0];
  if (!stroke) return { code: null, modifier: null };
  if (stroke.then) return { code: stroke.code, modifier: stroke.then.code };
  return { code: stroke.code, modifier: stroke.level === 1 ? 'ShiftLeft' : null };
}

export function PracticeView(props: PracticeViewProps) {
  const { controller, layout, geometry } = props;
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
  const target = useMemo(() => toGraphemes(controller.options.context.exercise.text), [controller]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const describedBy = useId();
  const liveId = useId();
  const hand = handOf(props.mode);
  const def = modeById(props.mode);
  const single = controller.options.context.exercise.presentation === 'single';

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const detach = controller.attach(el);
    el.focus({ preventScroll: true });
    return detach;
  }, [controller]);

  useEffect(() => {
    const timer = setInterval(() => controller.tick(), 250);
    return () => clearInterval(timer);
  }, [controller]);

  const ended = view.phase === 'ended';
  const counters = view.outcome.counters;
  const accuracy = formatAccuracy(counters.attemptsCorrect, counters.attempts);
  const wpm = counters.attempts > 0 ? formatWpm(counters.finalCorrect, view.outcome.activeMs) : null;
  const current = target[view.bufferLength];
  const next = target[view.bufferLength + 1];
  const stroke = strokeFor(layout, geometry, current);
  const nextStroke = strokeFor(layout, geometry, next);
  const benchmark = controller.reference;
  const assistanceNote =
    view.assistance === 'none'
      ? 'No map assistance'
      : benchmark
        ? 'Map shown — this trial cannot qualify as no-look'
        : `${view.assistance === 'full-map' ? 'Full map' : 'Anchors'} is on — this block cannot qualify as no-look`;

  const focusInput = useCallback(() => textareaRef.current?.focus({ preventScroll: true }), []);

  return (
    <div className="practice-shell" data-hand={hand} style={{ ['--practice-size' as string]: `${30 * (props.practiceScale ?? 1)}px` }}>
      <header className="strip">
        <ModeIdentity mode={props.mode} />
        <span className="sep" aria-hidden="true" />
        <div className="block-info">
          <strong>{props.title}</strong>
          <span className="mono">{props.subtitle}</span>
        </div>
        <div className="strip-metrics" aria-live="off">
          <div className="strip-metric">
            <span className="eyebrow">Accuracy</span>
            <span className={accuracy === null ? 'v hidden-value' : 'v'}>{accuracy === null ? 'no input yet' : `${accuracy}%`}</span>
          </div>
          <div className="strip-metric">
            <span className="eyebrow">WPM</span>
            {props.speedVisible || ended ? (
              <span className={wpm === null ? 'v hidden-value' : 'v'}>{wpm ?? 'no input yet'}</span>
            ) : (
              <span className="v hidden-value">{props.speedHiddenReason ?? 'hidden until the end'}</span>
            )}
          </div>
          <div className="strip-metric">
            <span className="eyebrow">{view.remainingMs !== null ? 'Remaining' : 'Active'}</span>
            <span className="v num">{view.remainingMs !== null ? clock(view.remainingMs) : clock(view.outcome.activeMs ?? 0)}</span>
          </div>
        </div>
        {/* Pointer use of these controls keeps focus in the typing area, so
            revealing the map or ending a block is recorded as that action
            rather than as a focus loss. Tab still leaves the input. */}
        <div className="strip-actions" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button, label')) e.preventDefault(); }}>
          <Segmented label="Keyboard map assistance" value={view.assistance} options={ASSISTANCE} onChange={(level) => controller.setAssistance(level)} disabled={ended} />
          {!controller.fixed && !ended && (
            view.phase === 'paused' ? (
              <button type="button" className="btn" onClick={() => { controller.resume(); focusInput(); }}>
                Resume
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => controller.pause()} disabled={view.phase !== 'running'}>
                Pause
              </button>
            )
          )}
          {props.onEndBlock && (
            <button type="button" className="btn" onClick={props.onEndBlock}>
              {props.endLabel ?? 'End block'}
            </button>
          )}
        </div>
      </header>

      <main className="practice-main" id="main">
        <div className="target-head">
          <span className="eyebrow">{props.targetLabel}</span>
          <span className="counters">
            {counters.finalCorrect} correct · {counters.residualErrors} residual · {counters.corrections} corrections · {counters.attempts} attempts
          </span>
        </div>
        <div className={`target-box${focused ? ' focused' : ''}`} onClick={focusInput} onKeyDown={undefined}>
          {single ? <SingleTarget target={target} bufferLength={view.bufferLength} source={controller.engine} /> : <TargetText target={target} bufferLength={view.bufferLength} version={view.version} source={controller.engine} />}
          <textarea
            ref={textareaRef}
            className="typing-surface"
            aria-label={`Typing area for ${props.mode}, ${def.layoutName}, ${def.handLabel}. Type the text; Tab leaves, Escape ends.`}
            aria-describedby={describedBy}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-gramm="false"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            readOnly={ended}
          />
        </div>
        <p id={describedBy} className="visually-hidden">
          {single ? 'Find each letter shown, one at a time.' : `Target text: ${controller.options.context.exercise.text.slice(0, 600)}`}
        </p>
        {view.notice && (
          <div className="notice message tentative" role="status">
            <span className="tag">{view.mappingAlert ? 'Setup mismatch' : 'Note'}</span>
            {view.notice}{' '}
            <button type="button" className="btn btn-small btn-quiet" onClick={() => controller.dismissNotice()}>
              Dismiss
            </button>
          </div>
        )}
        {view.assistance === 'none' ? (
          <p className="overlay-note">
            The keyboard map is hidden. Feel for the ridge under <code>KeyF</code> and <code>KeyJ</code>.
            <br />
            <span className="small">Looking at the physical keyboard is not an error — it is a number you will be asked for afterwards.</span>
          </p>
        ) : (
          <div className="keyboard-area">
            <KeyboardMap
              geometry={geometry}
              layout={layout}
              ledger={props.ledger}
              assistance={view.assistance}
              targetCode={stroke.code}
              targetModifier={stroke.modifier}
              nextCode={nextStroke.code}
              weakCodes={props.weakCodes ?? []}
              showFingers={props.showFingers ?? false}
            />
            <MapLegend
              geometryName={geometry.name}
              layoutCode={layout.xkbName}
              fingerCount={props.ledger?.entries.filter((e) => e.finger).length ?? 0}
              positions={geometry.keys.length}
              revision={props.ledger?.revision ?? null}
            />
          </div>
        )}
        <div id={liveId} className="visually-hidden" aria-live="polite">
          {ended ? `Finished. Accuracy ${accuracy ?? 'not measured'}${wpm ? `, ${wpm} words per minute` : ''}.` : ''}
        </div>
      </main>

      <footer className="practice-footer">
        {/* A focus stop after the typing area: Tab always has somewhere to go. */}
        <button type="button" className="btn btn-small btn-quiet" onClick={() => document.querySelector<HTMLElement>('.strip-actions input:checked, .strip-actions button')?.focus()}>
          Block controls
        </button>
        <span>
          <kbd>Tab</kbd> leaves the typing area · <kbd>Esc</kbd> {benchmark ? 'interrupts the trial — an interrupted benchmark needs a fresh one, and the partial record is kept' : 'ends the block'}
          {!controller.fixed && ' · Pause with its button; Space always types a space'}
        </span>
        <span>
          <span className={`status-mark ${view.assistance === 'none' ? 'met' : 'pending'}`} aria-hidden="true" />
          {assistanceNote} · Typist does not change your OS layout · input source: {layout.xkbName}
          {props.footerNote ? <> · {props.footerNote}</> : null}
        </span>
      </footer>
    </div>
  );
}
