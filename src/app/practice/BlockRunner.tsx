// Runs one practice block: level-appropriate exercises until the block's
// suggested time is used or the user ends it. The layout must be calibrated
// (or probed after a restart) before practice starts.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrialEvents } from '../../domain/adaptive';
import type { AssistanceLevel } from '../../domain/input/types';
import { newId } from '../../domain/ids';
import type { ModeId } from '../../domain/modes';
import { randomSeed } from '../../domain/random';
import type { BlockKind, SessionBlockRecord, TrialRecord } from '../../domain/records';
import { isoWeekday } from '../../domain/time';
import { Message } from '../components/basics';
import { CalibrationScreen } from '../screens/CalibrationScreen';
import { currentSetup, geometryFor, isCalibrated, modeOverview } from '../store/derive';
import { useAppState, useStore } from '../store/react';
import { ExerciseRun } from './ExerciseRun';
import { type ExercisePlan, planExercise, weakTargetsFor } from './exercises';

export function defaultAssistance(level: number): AssistanceLevel {
  if (level <= 2) return 'full-map';
  if (level === 3) return 'anchors';
  return 'none';
}

/** Recent trials' events for adaptive drills: same mode, setup and ledger. */
export function useRecentEvents(mode: ModeId): TrialEvents[] | null {
  const store = useStore();
  const state = useAppState();
  const [recent, setRecent] = useState<TrialEvents[] | null>(null);
  const setup = currentSetup(state.data.setups);
  const overview = modeOverview(state.data, mode, state.today, state.browserSession);
  const ledgerId = overview.ledger?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    const trials = state.data.trials
      .filter((t) => t.mode === mode && t.setup.setupRevisionId === setup?.id && t.ledgerRevisionId === ledgerId && t.status !== 'running' && !t.eventsPruned && t.counters.attempts > 0)
      .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
      .slice(0, 25);
    if (!store.repo || trials.length === 0) {
      setRecent([]);
      return;
    }
    void store.repo.loadEventsFor(trials.map((t) => t.id)).then((events) => {
      if (cancelled) return;
      setRecent(trials.map((t) => ({ trialId: t.id, blockId: t.blockId, endedAt: t.endedAt ?? t.startedAt, events: events.get(t.id) ?? [] })));
    });
    return () => {
      cancelled = true;
    };
    // Loaded once per block start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, setup?.id, ledgerId]);
  return recent;
}

export interface BlockRunnerProps {
  readonly mode: ModeId;
  readonly kind: BlockKind;
  readonly minutes: number | null;
  readonly sessionId: string;
  readonly blockId: string;
  readonly title: string;
  readonly fixedPlan?: (seed: number, index: number) => ExercisePlan | null;
  /** End as soon as the block time is used, without the interstitial. */
  readonly autoFinish?: boolean;
  readonly onEnd: (record: SessionBlockRecord) => void;
}

export function BlockRunner(props: BlockRunnerProps) {
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const overview = useMemo(() => modeOverview(state.data, props.mode, state.today, state.browserSession), [state.data, props.mode, state.today, state.browserSession]);
  const geometry = geometryFor(setup);
  const recent = useRecentEvents(props.mode);
  const startedAt = useRef(new Date().toISOString());
  const startedMs = useRef(Date.now());
  const [index, setIndex] = useState(0);
  const [exerciseKey, setExerciseKey] = useState(() => newId());
  const [trialIds, setTrialIds] = useState<string[]>([]);
  const [activeMs, setActiveMs] = useState(0);
  const [assistance, setAssistance] = useState<AssistanceLevel>(() => defaultAssistance(overview.level));
  const [calibrating, setCalibrating] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const avoid = useRef<string[]>([]);

  const plan = useMemo(() => {
    if (!recent) return null;
    const seed = randomSeed();
    const fixed = props.fixedPlan?.(seed, index);
    if (fixed) return fixed;
    return planExercise({
      blockKind: props.kind,
      level: overview.level,
      stageProgress: overview.state?.stageProgress ?? 0,
      layout: overview.layout,
      geometry,
      ledger: overview.ledger,
      seed,
      recent,
      weekday: isoWeekday(state.today),
      exerciseIndex: index,
      avoidPassages: avoid.current,
    });
    // A fresh plan per exercise key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseKey, recent]);

  const weak = useMemo(() => (recent ? weakTargetsFor({ recent, layout: overview.layout, geometry }) : { codes: [] as string[] }), [recent, overview.layout, geometry]);

  function finish(status: SessionBlockRecord['status'], extraTrial?: TrialRecord) {
    const ids = extraTrial ? [...trialIds, extraTrial.id] : trialIds;
    const ms = activeMs + (extraTrial?.activeMs ?? 0);
    props.onEnd({ blockId: props.blockId, kind: props.kind, mode: props.mode, startedAt: startedAt.current, endedAt: new Date().toISOString(), activeMs: ms, trialIds: ids, status });
  }

  if (!setup) return <Message kind="error">Complete setup first.</Message>;
  if (!isCalibrated(overview.calibration) || calibrating) {
    if (calibrating) {
      return (
        <main className="content">
          <CalibrationScreen layoutId={overview.layout.id} kind={overview.calibration.status === 'probe-required' ? 'probe' : 'full'} onDone={() => setCalibrating(false)} />
        </main>
      );
    }
    return (
      <div className="center-screen">
        <div className="panel panel-pad stack-sm" style={{ maxWidth: 620 }}>
          <h2>{props.title}</h2>
          <Message kind="short" tag="Calibration">
            {overview.calibration.status === 'probe-required'
              ? `${overview.calibration.reason} A short probe (about fifteen seconds) is enough.`
              : `${overview.layout.xkbName} needs calibration for this setup before ${props.mode} practice.`}
          </Message>
          <div className="inline-actions">
            <button type="button" className="btn btn-primary" onClick={() => setCalibrating(true)}>
              {overview.calibration.status === 'probe-required' ? 'Run the short probe' : 'Calibrate'}
            </button>
            <button type="button" className="btn" onClick={() => finish('skipped')}>
              Skip this block
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!plan) return <div className="center-screen muted">Preparing exercises…</div>;
  if (timeUp) {
    return (
      <div className="center-screen">
        <div className="panel panel-pad stack-sm" style={{ maxWidth: 560 }}>
          <h2>Block time reached</h2>
          <p>
            {props.title} used its {props.minutes} minutes. {trialIds.length} exercise{trialIds.length === 1 ? '' : 's'} recorded.
          </p>
          <div className="inline-actions">
            <button type="button" className="btn btn-primary" autoFocus onClick={() => finish('completed')}>
              Continue
            </button>
            <button type="button" className="btn" onClick={() => { setTimeUp(false); setExerciseKey(newId()); }}>
              One more exercise
            </button>
          </div>
        </div>
      </div>
    );
  }
  const minutesUsed = (Date.now() - startedMs.current) / 60_000;
  return (
    <ExerciseRun
      key={exerciseKey}
      mode={props.mode}
      plan={plan}
      layout={overview.layout}
      geometry={geometry}
      ledger={overview.ledger}
      setup={setup}
      calibrationId={overview.calibration.status === 'fresh' ? overview.calibration.record.id : null}
      sessionId={props.sessionId}
      blockId={props.blockId}
      title={props.title}
      subtitle={`${plan.protocol.timing.mode === 'fixed' ? `${plan.protocol.timing.durationMs / 1000} s` : 'untimed'} · goal: ${plan.goal}${props.minutes ? ` · ${Math.max(0, props.minutes - minutesUsed).toFixed(0)} min left in block` : ''}`}
      assistance={assistance}
      weakCodes={props.kind === 'weak-keys' ? weak.codes : []}
      showResult
      onEndBlock={(final) => finish('ended-early', final ?? undefined)}
      onFinished={(final) => {
        if (final.exercise.itemId) avoid.current = [...avoid.current, final.exercise.itemId];
        setTrialIds((ids) => [...ids, final.id]);
        setActiveMs((ms) => ms + (final.activeMs ?? 0));
        setAssistance(final.assistance.shown.at(-1) ?? assistance);
        setIndex((i) => i + 1);
        if (props.minutes !== null && (Date.now() - startedMs.current) / 60_000 >= props.minutes) {
          if (props.autoFinish) finish('completed', final);
          else setTimeUp(true);
        } else setExerciseKey(newId());
      }}
    />
  );
}
