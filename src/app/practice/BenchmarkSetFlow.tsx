// The reference benchmark set: three 60-second native-layout prose trials,
// one-minute rests, no map, speed withheld until each trial ends. Invalid or
// interrupted trials stay in history; a replacement always gets a new ID.
import { useEffect, useMemo, useState } from 'react';
import { PROSE } from '../../content/corpus';
import { evaluateSet, type Gate, GATES, TRIALS_PER_SET, isTechnicallyValid } from '../../domain/evidence';
import { corpusExercise } from '../../domain/exercises/exercise';
import { choosePassage } from '../../domain/exercises/generators';
import { newId } from '../../domain/ids';
import { modeById, type ModeId } from '../../domain/modes';
import { randomSeed } from '../../domain/random';
import { type BenchmarkSetRecord, type Declarations, EMPTY_DECLARATIONS, RECORD_SCHEMA_VERSION, type TrialRecord } from '../../domain/records';
import { currentTimeZone, localDateIn } from '../../domain/time';
import { PROTOCOLS } from '../../domain/versions';
import { Message, ModeIdentity, SaveBadge } from '../components/basics';
import { DeclarationFields, declarationsComplete } from '../components/Declarations';
import { SetResult } from '../components/SetResult';
import { CalibrationScreen } from '../screens/CalibrationScreen';
import { benchmarkProtocolFor, currentSetup, gateFor, geometryFor, hasMilestone, isCalibrated, modeOverview } from '../store/derive';
import { useAppState, useStore } from '../store/react';
import { ExerciseRun } from './ExerciseRun';

const REST_MS = 60_000;

export function nextGate(mode: ModeId, milestones: readonly { mode: ModeId; kind: string }[], profile: Parameters<typeof gateFor>[1]): Gate {
  const has = (kind: string) => milestones.some((m) => m.mode === mode && m.kind === kind);
  if (!has('advance')) return GATES.advance;
  if (!has('acquired')) return GATES.acquired;
  if (!has('strong')) return GATES.strong;
  return gateFor('showcase', profile);
}

type Phase = 'intro' | 'calibrate' | 'countdown' | 'trial' | 'rest' | 'declare' | 'result';

export function BenchmarkSetFlow({
  mode,
  sessionId,
  blockId,
  purpose,
  onDone,
  onCancel,
}: {
  mode: ModeId;
  sessionId: string;
  blockId: string | null;
  purpose: BenchmarkSetRecord['purpose'];
  onDone: (set: BenchmarkSetRecord | null) => void;
  onCancel: () => void;
}) {
  const store = useStore();
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const overview = useMemo(() => modeOverview(state.data, mode, state.today, state.browserSession), [state.data, mode, state.today, state.browserSession]);
  const geometry = geometryFor(setup);
  const timeZone = state.data.profile?.timeZone ?? currentTimeZone();
  const [set, setSet] = useState<BenchmarkSetRecord>(() => ({
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: newId(),
    sessionId,
    mode,
    protocolId: benchmarkProtocolFor(mode),
    localDate: localDateIn(timeZone, Date.now()),
    timeZone,
    createdAt: new Date().toISOString(),
    signatureHash: '',
    trialIds: [],
    status: 'in-progress',
    purpose,
  }));
  const [phase, setPhase] = useState<Phase>('intro');
  const [count, setCount] = useState(3);
  const [restUntil, setRestUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [trialKey, setTrialKey] = useState(() => newId());
  const [replaces, setReplaces] = useState<string | null>(null);
  const [decl, setDecl] = useState<Record<string, Declarations>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trialsById = useMemo(() => new Map(state.data.trials.map((t) => [t.id, t])), [state.data.trials]);
  const attempts = set.trialIds.map((id) => trialsById.get(id)).filter((t): t is TrialRecord => !!t);
  const valid = attempts.filter(isTechnicallyValid).slice(0, TRIALS_PER_SET);
  const evaluation = evaluateSet(set, trialsById);
  // The set is judged against the gate in effect when it started; its own award must not move the goalposts.
  const [gate] = useState(() => nextGate(mode, state.data.milestones, state.data.profile));
  const usedPassages = attempts.map((t) => t.exercise.itemId ?? '');

  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'rest') return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count <= 0) {
      setPhase('trial');
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, count]);

  const plan = useMemo(() => {
    const seed = randomSeed();
    const passage = choosePassage(PROSE, seed, usedPassages);
    const protocol = modeById(mode).inputPath === 'emulated' ? PROTOCOLS['emulated-half-qwerty-prose-60-v1'] : PROTOCOLS['english-prose-60-v1'];
    return { exercise: corpusExercise(PROSE, passage), protocol, trialKind: 'benchmark' as const, assessmentLevel: null, initialAssistance: 'none' as const, goal: 'Reference benchmark trial' };
    // A new passage for each new trial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trialKey]);

  if (!setup || !state.data.profile) return <Message kind="error">Complete setup first.</Message>;

  if (phase === 'calibrate') {
    return (
      <main className="content">
        <CalibrationScreen layoutId={overview.layout.id} kind={overview.calibration.status === 'probe-required' ? 'probe' : 'full'} onDone={() => setPhase('intro')} />
      </main>
    );
  }

  if (phase === 'intro') {
    const calibrated = isCalibrated(overview.calibration);
    return (
      <div className="center-screen">
        <div className="panel panel-pad stack" style={{ maxWidth: 720 }} data-hand={modeById(mode).hand === 'both' ? undefined : modeById(mode).hand}>
          <ModeIdentity mode={mode} />
          <div>
            <div className="eyebrow">Benchmark set · english-prose-60-v1</div>
            <h1 style={{ marginTop: 8 }}>Three 60-second trials, one-minute rests</h1>
          </div>
          <p>
            The keyboard map is off and speed is withheld until each trial ends. The clock starts at your first key. Leaving the page, switching windows, or pressing Esc interrupts a
            trial; it stays in history and a fresh one replaces it. The first three valid trials form the set.
          </p>
          <p className="muted">
            Next gate for {mode}: {gate.kind === 'advance' ? 'advance' : gate.kind} at {gate.wpm} WPM and {gate.accuracyPercent}%, no looking.
          </p>
          {!calibrated && (
            <Message kind="short" tag="Calibration">
              {overview.calibration.status === 'probe-required' ? overview.calibration.reason : `${overview.layout.xkbName} has not been calibrated for this setup.`} A benchmark is armed only after
              calibration.
            </Message>
          )}
          {!store.writable && <Message kind="error">This tab is read-only; take over writing to measure.</Message>}
          {state.unsaved.length > 0 && <Message kind="error">A previous result is not saved. Scored trials are disabled until saving works again (Data screen).</Message>}
          <div className="inline-actions">
            {calibrated ? (
              <button
                type="button"
                className="btn btn-primary btn-large"
                disabled={!store.writable || state.unsaved.length > 0}
                onClick={() => {
                  setCount(3);
                  setPhase('countdown');
                }}
              >
                Start trial {valid.length + 1} of 3
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-large" onClick={() => setPhase('calibrate')}>
                {overview.calibration.status === 'probe-required' ? 'Run the short probe' : 'Calibrate now'}
              </button>
            )}
            <button type="button" className="btn" onClick={attempts.length > 0 ? () => onDone(set) : onCancel}>
              {attempts.length > 0 ? 'Stop this set' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'countdown') {
    return (
      <div className="center-screen" data-hand={modeById(mode).hand === 'both' ? undefined : modeById(mode).hand}>
        <div className="stack" style={{ textAlign: 'center' }}>
          <ModeIdentity mode={mode} />
          <div className="countdown" aria-live="assertive">
            {count}
          </div>
          <p className="muted">
            Trial {valid.length + 1} of 3 · hands on the anchors · map off · input source {overview.layout.xkbName}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'trial') {
    return (
      <ExerciseRun
        key={trialKey}
        mode={mode}
        plan={plan}
        layout={overview.layout}
        geometry={geometry}
        ledger={overview.ledger}
        setup={setup}
        calibrationId={overview.calibration.status === 'fresh' ? overview.calibration.record.id : null}
        sessionId={sessionId}
        blockId={blockId}
        title={`Benchmark trial ${valid.length + 1} of 3 · ${benchmarkProtocolFor(mode)}`}
        subtitle="60 s · tail backspace · no adaptive text"
        assistance="none"
        speedVisible={false}
        benchmarkSetId={set.id}
        setIndex={attempts.length}
        replacesTrialId={replaces}
        endLabel="End trial"
        onEndBlock={undefined}
        commitExtras={(final) => {
          const trialIds = [...set.trialIds, final.id];
          const validCount = trialIds.map((id) => (id === final.id ? final : trialsById.get(id))).filter((t): t is TrialRecord => !!t && isTechnicallyValid(t)).length;
          const next: BenchmarkSetRecord = { ...set, trialIds, signatureHash: set.signatureHash || final.signatureHash, status: validCount >= TRIALS_PER_SET ? 'complete' : 'in-progress' };
          return { set: next };
        }}
        onFinished={(final) => {
          const trialIds = [...set.trialIds, final.id];
          const nextSet: BenchmarkSetRecord = { ...set, trialIds, signatureHash: set.signatureHash || final.signatureHash };
          const validCount = [...valid, ...(isTechnicallyValid(final) ? [final] : [])].length;
          const complete = validCount >= TRIALS_PER_SET;
          setSet({ ...nextSet, status: complete ? 'complete' : 'in-progress' });
          setReplaces(isTechnicallyValid(final) ? null : final.id);
          setTrialKey(newId());
          if (complete) {
            setPhase('declare');
            return;
          }
          if ((final.counters.attempts ?? 0) > 0) {
            setRestUntil(Date.now() + REST_MS);
            setPhase('rest');
          } else setPhase('intro');
        }}
      />
    );
  }

  if (phase === 'rest') {
    const left = Math.max(0, restUntil - now);
    const last = attempts.at(-1);
    return (
      <div className="center-screen">
        <div className="panel panel-pad stack" style={{ maxWidth: 640, textAlign: 'center' }}>
          <div className="eyebrow">Rest · one minute between trials</div>
          <div className="countdown num" aria-live="off">
            {Math.ceil(left / 1000)}
          </div>
          {last && (
            <p>
              {isTechnicallyValid(last)
                ? `Trial ${valid.length} recorded.`
                : `That trial was ${last.status}${last.interruption ? ` (${last.interruption.replace(/-/g, ' ')})` : ''}; it stays in history and a fresh trial replaces it.`}
            </p>
          )}
          <p className="muted">Shake out the hand, then return to the anchors. Results are shown after the set.</p>
          <div className="inline-actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary btn-large" disabled={left > 0} onClick={() => { setCount(3); setPhase('countdown'); }}>
              {left > 0 ? 'Resting…' : `Start trial ${valid.length + 1} of 3`}
            </button>
            <button type="button" className="btn" onClick={() => onDone(set)}>
              Stop this set
            </button>
          </div>
          {left > 0 && <span className="disabled-reason">The protocol's one-minute rest is still running.</span>}
        </div>
      </div>
    );
  }

  if (phase === 'declare') {
    const handLabel = modeById(mode).handLabel;
    const values = valid.map((t) => decl[t.id] ?? t.declarations ?? EMPTY_DECLARATIONS);
    const all = values.every(declarationsComplete);
    return (
      <main className="content">
        <div className="stack" style={{ maxWidth: 980 }}>
          <div className="page-head">
            <div>
              <div className="eyebrow">What the app cannot see</div>
              <h1>Declarations for this set</h1>
            </div>
          </div>
          <p>Answer for each trial. Anything left blank stays pending — it is never assumed to be zero.</p>
          {valid.map((t, i) => (
            <section key={t.id} className="panel panel-pad stack-sm">
              <div className="inline-actions" style={{ justifyContent: 'space-between' }}>
                <h2>Trial {i + 1}</h2>
                {i === 0 && valid.length > 1 && (
                  <button type="button" className="btn btn-small" onClick={() => setDecl(Object.fromEntries(valid.map((v) => [v.id, values[0] ?? EMPTY_DECLARATIONS])))}>
                    Apply trial 1 answers to all
                  </button>
                )}
              </div>
              <DeclarationFields value={values[i] ?? EMPTY_DECLARATIONS} onChange={(v) => setDecl((d) => ({ ...d, [t.id]: v }))} handLabel={handLabel} />
            </section>
          ))}
          {error && <Message kind="error">{error}</Message>}
          <div className="inline-actions">
            <button
              type="button"
              className="btn btn-primary btn-large"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  await store.updateDeclarations(valid.map((t, i) => ({ trialId: t.id, declarations: values[i] ?? EMPTY_DECLARATIONS })));
                  setPhase('result');
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {all ? 'Save declarations' : 'Save — some stay pending'}
            </button>
            <SaveBadge state={state.save} timeZone={timeZone} />
          </div>
        </div>
      </main>
    );
  }

  const milestoneEval = overview.gates[gate.kind];
  const awarded = hasMilestone(state.data.milestones, mode, gate.kind);
  return (
    <main className="content">
      <div className="stack" style={{ maxWidth: 980 }}>
        <div className="page-head">
          <div>
            <div className="eyebrow">Benchmark set · {set.localDate}</div>
            <h1>{mode} set result</h1>
          </div>
          <SaveBadge state={state.save} timeZone={timeZone} />
        </div>
        <div className="panel panel-pad">
          <SetResult evaluation={evaluation} gate={gate} milestone={milestoneEval} timeZone={timeZone} />
        </div>
        {awarded && <Message kind="met">Milestone recorded: {awarded.kind} on {awarded.awardedLocalDate}, with its supporting sets and protocol version.</Message>}
        <div className="inline-actions">
          <button type="button" className="btn btn-primary" onClick={() => onDone(set)}>
            Continue
          </button>
        </div>
      </div>
    </main>
  );
}
