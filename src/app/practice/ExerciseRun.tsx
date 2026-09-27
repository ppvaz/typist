// Runs one exercise as one trial: persists the running record, arms, lets the
// user type, then shows the result. Results are shown immediately but only
// labeled saved after the local transaction commits.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { keyStats, recentInsertions } from '../../domain/adaptive';
import type { AssistanceLevel } from '../../domain/input/types';
import type { GeometryDefinition } from '../../domain/layouts/geometry';
import type { LayoutDefinition } from '../../domain/layouts/registry';
import { newId } from '../../domain/ids';
import { modeById, type ModeId } from '../../domain/modes';
import type { FingeringLedger, KeyboardSetup, TrialRecord } from '../../domain/records';
import { formatAccuracy, formatWpm } from '../../domain/scoring/metrics';
import { currentTimeZone, localDateIn } from '../../domain/time';
import type { TrialCommit } from '../../storage/repo';
import { Message, SaveBadge } from '../components/basics';
import { useAppState, useStore } from '../store/react';
import type { ExercisePlan } from './exercises';
import { PracticeView } from './PracticeView';
import { TrialController } from './TrialController';

export interface ExerciseRunProps {
  readonly mode: ModeId;
  readonly plan: ExercisePlan;
  readonly layout: LayoutDefinition;
  readonly geometry: GeometryDefinition;
  readonly ledger: FingeringLedger | null;
  readonly setup: KeyboardSetup;
  readonly calibrationId: string | null;
  readonly sessionId: string | null;
  readonly blockId: string | null;
  readonly title: string;
  readonly subtitle: string;
  readonly assistance: AssistanceLevel;
  readonly benchmarkSetId?: string | null;
  readonly setIndex?: number | null;
  readonly replacesTrialId?: string | null;
  readonly speedVisible?: boolean;
  readonly weakCodes?: readonly string[];
  readonly commitExtras?: (final: TrialRecord) => Omit<TrialCommit, 'trial' | 'chunk'>;
  readonly onFinished: (final: TrialRecord, saved: boolean) => void;
  readonly onAssistanceChange?: (level: AssistanceLevel) => void;
  /** Ends the block: the current trial is finalized and saved first, then reported. */
  readonly onEndBlock?: (final: TrialRecord | null) => void;
  readonly endLabel?: string;
  /** Show the built-in result panel (blocks); benchmark flows render their own. */
  readonly showResult?: boolean;
  readonly continueLabel?: string;
  /** Cue-started timing on the performance.now() scale (two-machine runs). */
  readonly anchorAtPerfMs?: number;
  /** Called with the running controller (two-machine runs need its clock). */
  readonly onController?: (controller: TrialController) => void;
}

export function ExerciseRun(props: ExerciseRunProps) {
  const store = useStore();
  const state = useAppState();
  const [controller, setController] = useState<TrialController | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const repo = store.repo;
    if (!repo) return;
    let disposed = false;
    let created: TrialController | null = null;
    const timeZone = state.data.profile?.timeZone ?? currentTimeZone();
    const now = Date.now();
    // Deferred one tick: React's development double-mount cancels the first
    // scheduled start before anything is persisted.
    const timer = setTimeout(() => void TrialController.start({
      context: {
        id: newId(),
        sessionId: props.sessionId,
        blockId: props.blockId,
        mode: props.mode,
        kind: props.plan.trialKind,
        protocol: props.plan.protocol,
        setup: props.setup,
        layout: props.layout,
        ledger: props.ledger,
        calibrationId: props.calibrationId,
        exercise: props.plan.exercise,
        assistance: {
          initial: props.plan.initialAssistance ?? props.assistance,
          shown: [props.plan.initialAssistance ?? props.assistance],
          revealed: false,
          policy: props.plan.protocol.assistancePolicy,
        },
        startedAt: new Date(now).toISOString(),
        timeZone,
        localDate: localDateIn(timeZone, now),
        benchmarkSetId: props.benchmarkSetId ?? null,
        setIndex: props.setIndex ?? null,
        replacesTrialId: props.replacesTrialId ?? null,
        assessmentLevel: props.plan.assessmentLevel,
        inputPath: modeById(props.mode).inputPath,
      },
      layout: props.layout,
      repo,
      commitExtras: props.commitExtras,
      onSaved: (final) => {
        const extras = props.commitExtras?.(final) ?? {};
        store.applyUpserts({
          trials: [final],
          sets: extras.set ? [extras.set] : [],
          sessions: extras.session ? [extras.session] : [],
          milestones: extras.milestones ?? [],
          core: extras.core ? [extras.core] : [],
          modeStates: extras.modeState ? [extras.modeState] : [],
        });
      },
    })
      .then((c) => {
        created = c;
        if (disposed) {
          c.externalInterrupt('page-closed');
          c.dispose();
          return;
        }
        store.setActiveRun(true);
        store.onLeaseLost = () => c.externalInterrupt('writer-lost');
        if (props.anchorAtPerfMs !== undefined) c.anchorAt(props.anchorAtPerfMs);
        props.onController?.(c);
        setController(c);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))), 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (created) {
        if (!created.finished) created.externalInterrupt('page-closed');
        created.dispose();
      }
      store.setActiveRun(false);
      store.onLeaseLost = null;
    };
    // The run is created once per mounted exercise; the key remounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="center-screen">
        <div className="panel panel-pad stack-sm" style={{ maxWidth: 560 }}>
          <Message kind="error" tag="Could not start">
            {error}
          </Message>
          <p>The prompt must be saved before a trial starts, so nothing was measured.</p>
          {props.onEndBlock && (
            <button type="button" className="btn" onClick={() => props.onEndBlock?.(null)}>
              Back
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!controller) return <div className="center-screen muted">Preparing the exercise…</div>;
  return <RunningExercise {...props} controller={controller} />;
}

function RunningExercise(props: ExerciseRunProps & { controller: TrialController }) {
  const { controller } = props;
  const store = useStore();
  const state = useAppState();
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
  const reported = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [endRequested, setEndRequested] = useState(false);
  const unsavedId = useRef<string | null>(null);
  const ended = view.phase === 'ended';
  const settled = ended && (view.save === 'saved' || view.save === 'failed');

  useEffect(() => {
    if (settled && !reported.current) {
      reported.current = true;
      store.setActiveRun(false);
      // A tab that lost the writer lease cannot save; the new writer already
      // recorded this run as interrupted from the journal.
      if (view.save === 'failed' && store.getState().lease === 'writer') {
        unsavedId.current = store.addUnsaved({ label: `${props.mode} ${props.plan.exercise.title}`, payload: controller.recoveryPayload() });
      }
      if (endRequested) props.onEndBlock?.(view.record);
      else if (!props.showResult) props.onFinished(view.record, view.save === 'saved');
    }
    if (ended) continueRef.current?.focus();
  }, [ended, settled, endRequested, view.save, view.record, props, store, controller]);

  const requestEnd = () => {
    if (!ended) {
      setEndRequested(true);
      controller.endByUser();
    } else if (settled) props.onEndBlock?.(view.record);
  };

  const recordStatus = view.record.status;
  const accuracy = formatAccuracy(view.outcome.counters.attemptsCorrect, view.outcome.counters.attempts);
  const wpm = view.outcome.counters.attempts > 0 ? formatWpm(view.outcome.counters.finalCorrect, view.outcome.activeMs) : null;
  const observation = ended ? observe(controller, props.layout, props.geometry, props.mode) : null;

  return (
    <>
      <PracticeView
        controller={controller}
        mode={props.mode}
        layout={props.layout}
        geometry={props.geometry}
        ledger={props.ledger}
        title={props.title}
        subtitle={props.subtitle}
        targetLabel={`${props.plan.exercise.title}${props.plan.exercise.artificial ? ' · artificial sequences' : ''} · no stop on error`}
        speedVisible={props.speedVisible ?? state.data.profile?.ui.showSpeed ?? true}
        speedHiddenReason={props.speedVisible === false && controller.reference ? 'hidden until the end' : 'hidden by preference'}
        weakCodes={props.weakCodes ?? []}
        showFingers={state.data.profile?.ui.fingerLayer ?? false}
        practiceScale={state.data.profile?.ui.practiceScale ?? 1}
        onEndBlock={props.onEndBlock ? requestEnd : undefined}
        endLabel={props.endLabel}
      />
      {ended && props.showResult && !endRequested && (
        <div className="result-sheet" role="region" aria-label="Exercise result">
          <div className="panel panel-raised panel-pad stack-sm">
            <div className="inline-actions" style={{ justifyContent: 'space-between' }}>
              <h2>
                {recordStatus === 'completed' ? 'Exercise complete' : recordStatus === 'aborted' ? 'Cancelled before any input' : recordStatus === 'invalid' ? 'Exercise invalid' : 'Exercise interrupted'}
              </h2>
              <SaveBadge state={view.save === 'saved' ? { status: 'saved', at: Date.now() } : view.save === 'failed' ? { status: 'failed', at: Date.now(), error: view.saveError ?? 'unknown error' } : view.save === 'saving' ? { status: 'saving' } : { status: 'in-memory' }} timeZone={state.data.profile?.timeZone} />
            </div>
            <p>
              Accuracy <strong>{accuracy === null ? 'not measured' : `${accuracy}%`}</strong> ({view.outcome.counters.attemptsCorrect} of {view.outcome.counters.attempts} attempts)
              {wpm !== null && (
                <>
                  {' '}
                  · <strong>{wpm}</strong> WPM
                </>
              )}{' '}
              · {view.outcome.counters.corrections} corrections · {view.outcome.counters.residualErrors} left wrong
            </p>
            {view.record.invalidity.length > 0 && <Message kind="short">Invalid: {view.record.invalidity.join(', ')}. The record is kept, but it is not a result.</Message>}
            {view.record.interruption && <Message kind="short">Interrupted ({view.record.interruption.replace(/-/g, ' ')}). The partial record is kept.</Message>}
            {observation}
            {view.save === 'failed' && state.lease !== 'writer' && (
              <Message kind="short" tag="Another tab">
                Another tab took over writing, so this run was interrupted. The other tab recorded it as interrupted from the saved journal; nothing needs to be downloaded here.
              </Message>
            )}
            {view.save === 'failed' && state.lease === 'writer' && (
              <Message kind="error">
                This result is held in memory. Retry saving, or download a recovery file from the Data screen before leaving.{' '}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() =>
                    void controller.persistFinal().then((ok) => {
                      if (ok && unsavedId.current) {
                        store.removeUnsaved(unsavedId.current);
                        unsavedId.current = null;
                      }
                    })
                  }
                >
                  Retry saving
                </button>
              </Message>
            )}
            <div className="inline-actions">
              <button type="button" ref={continueRef} className="btn btn-primary" disabled={view.save === 'saving'} onClick={() => props.onFinished(view.record, view.save === 'saved')}>
                {props.continueLabel ?? 'Next exercise'}
              </button>
              {props.onEndBlock && (
                <button type="button" className="btn" disabled={!settled} onClick={requestEnd}>
                  {props.endLabel ?? 'End block'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** One observation, only when the data supports it (20+ opportunities). */
function observe(controller: TrialController, layout: LayoutDefinition, geometry: GeometryDefinition, mode: ModeId) {
  const insertions = recentInsertions([{ trialId: 'current', blockId: null, endedAt: '', events: controller.engine.events }]);
  const stats = keyStats(insertions, 'position', layout, geometry).filter((s) => s.ranked && s.errors > 0);
  const top = stats[0];
  if (!top) return null;
  return (
    <Message kind="observed">
      <code>{top.key}</code> was missed {top.errors} of {top.opportunities} attempts in {mode}.
    </Message>
  );
}
