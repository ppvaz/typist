// Full-screen parts of the two-machine module: the coordinated 60-second run
// on this machine's side (copy or free composition), the post-run
// self-report, and the cue-started solo baselines it is compared with.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DUAL_TRIAL_MS, type DualRunRecord, dualRecordId, type Interval, type Role, type SideResult, stalls, type StreamInsert } from '../../domain/dual';
import { newId } from '../../domain/ids';
import { modeById, type ModeId } from '../../domain/modes';
import { randomSeed } from '../../domain/random';
import type { TrialRecord } from '../../domain/records';
import type { TrialEvent } from '../../domain/scoring/engine';
import { toGraphemes } from '../../domain/text/graphemes';
import { PROTOCOLS } from '../../domain/versions';
import type { DualClient, DualClientState } from '../../dual/client';
import { matchedBaseline } from '../../dual/session';
import { dualSession } from '../../dual/session';
import { baselineExercise, COPY_TASK_CLASSES, dualTasks } from '../../dual/tasks';
import { handOf, Message, ModeIdentity } from '../components/basics';
import { StartCue } from '../components/StartCue';
import { ExerciseRun } from '../practice/ExerciseRun';
import type { ExercisePlan } from '../practice/exercises';
import type { TrialController } from '../practice/TrialController';
import { href, navigate } from '../router';
import { currentSetup, geometryFor, isCalibrated, modeOverview } from '../store/derive';
import { useAppState } from '../store/react';
import { CalibrationScreen } from './CalibrationScreen';

/** Cue lead for solo baselines: the target is visible, the interval starts at "Go". */
const CUE_LEAD_MS = 3000;

const noClient = () => () => undefined;

export function useDualSession() {
  useSyncExternalStore(dualSession.subscribe, dualSession.getVersion, dualSession.getVersion);
  const client = dualSession.client;
  const state = useSyncExternalStore(client ? client.subscribe : noClient, client ? client.getState : () => null, client ? client.getState : () => null);
  return { client, state };
}

interface Finished {
  readonly trialId: string;
  readonly composition: boolean;
  readonly status: SideResult['status'];
  readonly wpm: number | null;
  readonly accuracy: number | null;
  readonly productionWpm: number | null;
  readonly deletions: number | null;
  readonly stalls: readonly Interval[];
  readonly stream: readonly StreamInsert[] | null;
  readonly compositionText: string | null;
  readonly localDate: string;
}

function copyStatus(final: TrialRecord): SideResult['status'] {
  if (final.status === 'completed') return final.verification === 'verified' ? 'completed' : 'invalid';
  return final.status === 'invalid' ? 'invalid' : 'interrupted';
}

function streamOf(controller: TrialController | null): { stream: StreamInsert[]; times: number[] } {
  const events = controller?.engine.events ?? [];
  const start = controller?.engine.startAtMs ?? 0;
  const stream = events
    .filter((e): e is Extract<TrialEvent, { kind: 'insert' }> => e.kind === 'insert')
    .map((e) => ({ atMs: e.atMs - start, expected: e.expected, produced: e.grapheme, correct: e.correct }));
  return { stream, times: stream.map((s) => s.atMs) };
}

/** The coordinated run on this machine. */
export function DualRunScreen() {
  const state = useAppState();
  const { client, state: cs } = useDualSession();
  const controller = useRef<TrialController | null>(null);
  const lateness = useRef<number | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const manifest = cs?.manifest ?? null;
  const role = cs?.role ?? null;
  const submitted = !!manifest && dualSession.local?.runId === manifest.runId;

  // The other machine stopped: this side ends too. Neither timer freezes.
  useEffect(() => {
    if (cs?.phase === 'stopped' && cs.stoppedBy !== role) controller.current?.externalInterrupt('peer-stopped');
  }, [cs?.phase, cs?.stoppedBy, role]);
  // A cancelled schedule (missed acknowledgement, stale clock) returns to the room.
  useEffect(() => {
    if (cs?.phase === 'lobby' && !finished && !submitted) navigate('/dual');
  }, [cs?.phase, finished, submitted]);
  useEffect(() => {
    if (submitted) navigate('/dual');
  }, [submitted]);

  const tasks = useMemo(() => (manifest ? dualTasks(manifest.level, manifest.seed) : null), [manifest]);
  const setup = currentSetup(state.data.setups);

  if (!client || !cs || !manifest || !role || !tasks || !setup || (cs.localStart === null && !finished)) {
    return (
      <div className="center-screen">
        <div className="stack-sm" style={{ maxWidth: 560 }}>
          <Message kind="short">No coordinated run is scheduled on this machine.</Message>
          <a className="btn" href={href('/dual')}>
            Back to two machines
          </a>
        </div>
      </div>
    );
  }
  const side = manifest[role];
  const mode = side.mode;
  const task = tasks[role];
  const localStart = cs.localStart as number;
  const notifyStop = (reason: string) => {
    if (cs.phase === 'scheduled' || cs.phase === 'running') client.stop(reason);
  };

  if (finished) return <SelfReport client={client} state={cs} role={role} mode={mode} finished={finished} lateness={lateness.current} />;

  if (!task.exercise) {
    return (
      <CompositionRun
        localStart={localStart}
        role={role}
        mode={mode}
        stopped={cs.phase === 'stopped' ? cs.message : null}
        onCue={(l) => (lateness.current = l)}
        onStop={(reason) => notifyStop(reason)}
        onDone={(r) =>
          setFinished({
            trialId: newId(),
            composition: true,
            status: r.status,
            wpm: null,
            accuracy: null,
            productionWpm: r.productionWpm,
            deletions: r.deletions,
            stalls: stalls(r.insertTimes, 0, DUAL_TRIAL_MS),
            stream: null,
            compositionText: r.text,
            localDate: state.today,
          })
        }
      />
    );
  }

  const overview = modeOverview(state.data, mode, state.today, state.browserSession);
  const plan: ExercisePlan = { exercise: task.exercise, protocol: PROTOCOLS['dual-copy-60-v1'], trialKind: 'dual', assessmentLevel: null, initialAssistance: 'none', goal: `${manifest.level} · shared 60 s interval` };
  const finish = (final: TrialRecord | null, stoppedHere: boolean) => {
    const { stream, times } = streamOf(controller.current);
    if (final && !stoppedHere && final.status !== 'completed' && final.interruption !== 'peer-stopped') {
      notifyStop(`${(final.interruption ?? final.status).replace(/-/g, ' ')} on the ${role} machine`);
    }
    setFinished({
      trialId: final?.id ?? newId(),
      composition: false,
      status: final ? copyStatus(final) : 'interrupted',
      wpm: final ? (final.metrics.wpm ?? 0) : null,
      accuracy: final?.metrics.accuracy ?? null,
      productionWpm: null,
      deletions: null,
      stalls: stalls(times, 0, DUAL_TRIAL_MS),
      stream,
      compositionText: null,
      localDate: final?.localDate ?? state.today,
    });
  };
  return (
    <div data-hand={handOf(mode)}>
      {cs.phase === 'incomplete' && cs.message && (
        <div className="banner" role="status">
          {cs.message}
        </div>
      )}
      <StartCue at={localStart} onCue={(l) => (lateness.current = l)} />
      <ExerciseRun
        mode={mode}
        plan={plan}
        layout={overview.layout}
        geometry={geometryFor(setup)}
        ledger={overview.ledger}
        setup={setup}
        calibrationId={overview.calibration.status === 'fresh' ? overview.calibration.record.id : null}
        sessionId={null}
        blockId={null}
        title={`Two machines · ${manifest.level} · ${role} machine`}
        subtitle={`${task.taskClass} · shared 60 s interval, idle time included`}
        assistance="none"
        speedVisible={false}
        anchorAtPerfMs={localStart}
        onController={(c) => (controller.current = c)}
        endLabel="Stop both machines"
        onEndBlock={(final) => {
          notifyStop(`stopped on the ${role} machine`);
          finish(final, true);
        }}
        onFinished={(final) => finish(final, false)}
      />
    </div>
  );
}

/** Free composition (D5): production is measured; there is no target, so no accuracy. */
function CompositionRun({
  localStart,
  role,
  mode,
  stopped,
  onCue,
  onStop,
  onDone,
}: {
  localStart: number;
  role: Role;
  mode: ModeId;
  stopped: string | null;
  onCue: (latenessMs: number) => void;
  onStop: (reason: string) => void;
  onDone: (r: { status: SideResult['status']; productionWpm: number; deletions: number; text: string; insertTimes: number[] }) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [now, setNow] = useState(() => performance.now());
  const stats = useRef({ deletions: 0, insertTimes: [] as number[], interrupted: null as string | null });
  const done = useRef(false);
  const end = useRef(onDone);
  end.current = onDone;

  const conclude = (status: SideResult['status']) => {
    if (done.current) return;
    done.current = true;
    const text = ref.current?.value ?? '';
    // Retained characters per minute of the shared interval.
    end.current({ status, productionWpm: toGraphemes(text).length / 5 / (DUAL_TRIAL_MS / 60_000), deletions: stats.current.deletions, text, insertTimes: stats.current.insertTimes });
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const inside = (t: number) => t >= localStart && t < localStart + DUAL_TRIAL_MS;
    const before = (e: InputEvent) => {
      if (!inside(e.timeStamp)) {
        e.preventDefault();
        return;
      }
      if (e.inputType.startsWith('delete')) stats.current.deletions += 1;
      else if (e.inputType.startsWith('insert')) stats.current.insertTimes.push(e.timeStamp - localStart);
    };
    const lost = (reason: string) => {
      const t = performance.now();
      if (done.current || t < localStart || t >= localStart + DUAL_TRIAL_MS) return;
      onStop(`${reason} on the ${role} machine`);
      conclude('interrupted');
    };
    const onBlur = () => lost('focus lost');
    const onHidden = () => {
      if (document.visibilityState === 'hidden') lost('page hidden');
    };
    el.addEventListener('beforeinput', before);
    el.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      el.removeEventListener('beforeinput', before);
      el.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHidden);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStart]);
  useEffect(() => {
    if (now >= localStart + DUAL_TRIAL_MS) conclude('completed');
  });
  useEffect(() => {
    if (stopped) conclude('interrupted');
  });

  const remaining = Math.max(0, localStart + DUAL_TRIAL_MS - now);
  return (
    <main className="content" data-hand={handOf(mode)}>
      <StartCue at={localStart} onCue={onCue} />
      <div className="stack" style={{ maxWidth: 900 }}>
        <ModeIdentity mode={mode} />
        <div className="eyebrow">
          Free composition · {role} machine · {now < localStart ? `starts in ${Math.ceil((localStart - now) / 1000)} s` : `${Math.ceil(remaining / 1000)} s left`}
        </div>
        <p className="small muted">Write anything. Retained characters and deletions are recorded; there is no target, so accuracy is not measured. The text stays on this machine.</p>
        <label htmlFor="composition">Composition</label>
        <textarea id="composition" ref={ref} className="field" style={{ maxWidth: '100%', minHeight: 240 }} spellCheck={false} autoComplete="off" />
        <div className="inline-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              onStop(`stopped on the ${role} machine`);
              conclude('interrupted');
            }}
          >
            Stop both machines
          </button>
        </div>
      </div>
    </main>
  );
}

type GlanceChoice = 'none' | 'some' | 'unknown';

/** After the interval: glances, collapses and notes, then save locally and send the counters. */
function SelfReport({ client, state, role, mode, finished, lateness }: { client: DualClient; state: DualClientState; role: Role; mode: ModeId; finished: Finished; lateness: number | null }) {
  const app = useAppState();
  const [glances, setGlances] = useState<GlanceChoice | null>(null);
  const [count, setCount] = useState(1);
  const [coherence, setCoherence] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const manifest = state.manifest;
  const setup = currentSetup(app.data.setups);
  if (!manifest || !state.manifestHash || !setup) return null;
  const hash = state.manifestHash;
  const clock = state.startClock ?? state.clock;
  const submit = async () => {
    setSaving(true);
    const baseline = finished.composition ? null : matchedBaseline(app.data.trials, mode, manifest[role].taskClass, setup.id);
    const result: SideResult = {
      role,
      mode,
      trialId: finished.trialId,
      runId: manifest.runId,
      manifestHash: hash,
      status: finished.status,
      composition: finished.composition,
      wpm: finished.wpm,
      accuracy: finished.accuracy,
      productionWpm: finished.productionWpm,
      deletions: finished.deletions,
      glances: glances === 'none' ? 0 : glances === 'some' ? Math.max(1, count) : 'unknown',
      // A cue never painted inside the interval counts as a full interval late.
      sync: { uncertaintyMs: clock?.uncertaintyMs ?? DUAL_TRIAL_MS, startLatenessMs: lateness ?? DUAL_TRIAL_MS, samples: clock?.samples ?? 0 },
      stalls: finished.stalls,
      baseline,
      coherence: finished.composition ? coherence : null,
    };
    const record: DualRunRecord = {
      id: dualRecordId(manifest.runId, role),
      runId: manifest.runId,
      role,
      source: 'local',
      level: manifest.level,
      localDate: finished.localDate,
      manifestHash: hash,
      manifest,
      result,
      stream: finished.stream,
      coordinated: 'pending',
      stoppedBy: null,
      stopReason: null,
      placement: dualSession.choice.placement.trim() || null,
      notes: notes.trim() || null,
      compositionText: finished.compositionText,
      savedAt: new Date().toISOString(),
    };
    await dualSession.submit(record);
  };
  void client;
  return (
    <main className="content" data-hand={handOf(mode)}>
      <div className="stack" style={{ maxWidth: 720 }}>
        <ModeIdentity mode={mode} />
        <h1>{finished.status === 'completed' ? 'Shared minute over' : 'This side ended early'}</h1>
        {state.phase === 'stopped' && <Message kind="short">{state.message}</Message>}
        {state.phase === 'incomplete' && <Message kind="short">{state.message}</Message>}
        <p>
          {finished.composition
            ? `${finished.productionWpm?.toFixed(1)} production WPM · ${finished.deletions} deletions · accuracy not measured`
            : `${finished.wpm?.toFixed(1) ?? '0.0'} WPM · ${finished.accuracy === null ? 'no input' : `${finished.accuracy.toFixed(2)}% accuracy`}`}
          . The app cannot see your hands or attention; only you can report these.
        </p>
        <fieldset>
          <legend>Glances at this keyboard during the shared minute</legend>
          <div className="choice-row">
            {(
              [
                ['none', 'None'],
                ['some', 'One or more'],
                ['unknown', 'Not sure'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="choice">
                <input type="radio" name="glances" checked={glances === value} onChange={() => setGlances(value)} />
                {label}
              </label>
            ))}
          </div>
          {glances === 'some' && (
            <div className="field-row">
              <label htmlFor="glance-count">How many</label>
              <input id="glance-count" type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} style={{ maxWidth: 100 }} />
            </div>
          )}
        </fieldset>
        {finished.composition && (
          <fieldset>
            <legend>How coherent was what you wrote? (self-rated, not validated)</legend>
            <div className="choice-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="choice">
                  <input type="radio" name="coherence" checked={coherence === n} onChange={() => setCoherence(n)} />
                  {n}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="field-row">
          <label htmlFor="dual-notes">Collapses or notes (stays on this machine)</label>
          <textarea id="dual-notes" className="field" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
        <div className="inline-actions">
          <button type="button" className="btn btn-primary" disabled={glances === null || saving} onClick={() => void submit()}>
            Save and send this side's result
          </button>
          {glances === null && <span className="disabled-reason">Answer the glance question first; “Not sure” is fine.</span>}
        </div>
      </div>
    </main>
  );
}

/** Three cue-started solo trials (dual-solo-copy-60-v1) for one mode and task class. */
export function DualBaselineScreen({ mode, taskClass }: { mode: ModeId; taskClass: string }) {
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const [completed, setCompleted] = useState(0);
  const [key, setKey] = useState(() => newId());
  const [cueAt, setCueAt] = useState<number | null>(null);
  const [last, setLast] = useState<TrialRecord | null>(null);
  const seed = useMemo(() => randomSeed(), [key]);
  const known = (COPY_TASK_CLASSES as readonly string[]).includes(taskClass);
  const exists = (() => {
    try {
      modeById(mode);
      return true;
    } catch {
      return false;
    }
  })();
  if (!setup || !known || !exists) {
    return (
      <div className="center-screen">
        <div className="stack-sm" style={{ maxWidth: 560 }}>
          <Message kind="short">That baseline does not exist. Free composition has no copy baseline.</Message>
          <a className="btn" href={href('/dual')}>
            Back to two machines
          </a>
        </div>
      </div>
    );
  }
  const o = modeOverview(state.data, mode, state.today, state.browserSession);
  if (!isCalibrated(o.calibration)) {
    return (
      <main className="content">
        <CalibrationScreen layoutId={o.layout.id} kind={o.calibration.status === 'probe-required' ? 'probe' : 'full'} onDone={() => undefined} />
      </main>
    );
  }
  const baseline = matchedBaseline(state.data.trials, mode, taskClass, setup.id);
  if (completed >= 3) {
    return (
      <div className="center-screen" data-hand={handOf(mode)}>
        <div className="panel panel-pad stack-sm" style={{ maxWidth: 560 }}>
          <ModeIdentity mode={mode} />
          <h1>Baseline measured</h1>
          <p>{baseline ? `${baseline.medianWpm.toFixed(1)} WPM · median of the latest three cue-started trials (${taskClass}).` : 'The latest three trials do not form a matched baseline yet.'}</p>
          <a className="btn btn-primary" href={href('/dual')}>
            Back to two machines
          </a>
        </div>
      </div>
    );
  }
  if (cueAt === null) {
    return (
      <div className="center-screen" data-hand={handOf(mode)}>
        <div className="panel panel-pad stack-sm" style={{ maxWidth: 620 }}>
          <ModeIdentity mode={mode} />
          <div className="eyebrow">
            Solo baseline · trial {completed + 1} of 3 · {taskClass} · dual-solo-copy-60-v1
          </div>
          {last && (
            <Message kind={last.status === 'completed' ? 'observed' : 'short'}>
              {last.status === 'completed'
                ? `Last trial: ${(last.metrics.wpm ?? 0).toFixed(1)} WPM, ${last.metrics.accuracy === null ? 'no input' : `${last.metrics.accuracy.toFixed(2)}%`}.`
                : 'The last trial did not complete, so it does not count. Try it again.'}
            </Message>
          )}
          <p>The text appears with a three-second countdown. The minute starts at “Go” whether or not you have typed, so hesitation counts, exactly as in a coordinated run.</p>
          <div className="inline-actions">
            <button type="button" className="btn btn-primary" autoFocus onClick={() => setCueAt(performance.now() + CUE_LEAD_MS)}>
              Start trial {completed + 1}
            </button>
            <a className="btn" href={href('/dual')}>
              Back
            </a>
          </div>
        </div>
      </div>
    );
  }
  const exercise = baselineExercise(taskClass, seed);
  if (!exercise) return null;
  const plan: ExercisePlan = { exercise, protocol: PROTOCOLS['dual-solo-copy-60-v1'], trialKind: 'baseline', assessmentLevel: null, initialAssistance: 'none', goal: `Matched solo baseline (${taskClass})` };
  return (
    <div data-hand={handOf(mode)}>
      <StartCue at={cueAt} />
      <ExerciseRun
        key={key}
        mode={mode}
        plan={plan}
        layout={o.layout}
        geometry={geometryFor(setup)}
        ledger={o.ledger}
        setup={setup}
        calibrationId={o.calibration.status === 'fresh' ? o.calibration.record.id : null}
        sessionId={null}
        blockId={null}
        title={`Solo baseline ${completed + 1} of 3`}
        subtitle={`cue-started 60 s · ${taskClass}`}
        assistance="none"
        speedVisible={false}
        anchorAtPerfMs={cueAt}
        endLabel="Stop baselines"
        onEndBlock={() => navigate('/dual')}
        onFinished={(final) => {
          setLast(final);
          if (final.status === 'completed' && final.verification === 'verified') setCompleted((n) => n + 1);
          setCueAt(null);
          setKey(newId());
        }}
      />
    </div>
  );
}
