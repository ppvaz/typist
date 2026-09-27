// Switching practice (docs/training-protocol.md, "Switching").
// Blocked: a segment in one mode, a deliberate 5–10 s reset, then the other.
// Paired: alternate two acquired modes with directional latency probes.
// Randomized: cue acquired modes (seeded, no immediate repeats) before 30–60 s
// segments. Latency runs from the painted cue to ten consecutive correct
// insertions; OS switching and hand movement stay inside it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { introducedAt } from '../../domain/curriculum';
import { wordDrill } from '../../domain/exercises/generators';
import { newId } from '../../domain/ids';
import { InputInterpreter } from '../../domain/input/interpreter';
import { modeById, type ModeId } from '../../domain/modes';
import { randomSeed } from '../../domain/random';
import {
  type GlanceDeclaration,
  type PlannedBlock,
  RECORD_SCHEMA_VERSION,
  type SessionBlockRecord,
  type SessionRecord,
  type SwitchProbeRecord,
  type SwitchStage,
} from '../../domain/records';
import { PROBE_TIMEOUT_MS, pairKind, PAIR_KIND_LABEL, randomizedOrder, STREAK_LENGTH, SwitchProbeEngine, SWITCH_TIMINGS } from '../../domain/switching';
import { toGraphemes } from '../../domain/text/graphemes';
import { currentTimeZone, localDateIn } from '../../domain/time';
import { PROTOCOLS } from '../../domain/versions';
import { handOf, Message, ModeIdentity } from '../components/basics';
import { GlanceField } from '../components/Declarations';
import { seconds } from '../format';
import { CalibrationScreen } from '../screens/CalibrationScreen';
import { currentSetup, geometryFor, hasMilestone, layoutFor, switchingFor } from '../store/derive';
import { useAppState, useStore } from '../store/react';
import { BlockRunner } from './BlockRunner';
import type { ExercisePlan } from './exercises';
import { committedText, resetSurface } from './TrialController';

type Step =
  | { readonly kind: 'segment'; readonly mode: ModeId; readonly minutes: number; readonly fixedSeconds?: number }
  | { readonly kind: 'reset'; readonly from: ModeId; readonly to: ModeId; readonly seconds: number }
  | { readonly kind: 'probe'; readonly from: ModeId; readonly to: ModeId };

export function switchScript(stage: SwitchStage, pair: readonly [ModeId, ModeId], pool: readonly ModeId[], minutes: number, seed: number): Step[] {
  const [a, b] = pair;
  if (stage === 'blocked') {
    const half = Math.max(1, Math.round(minutes / 2));
    const reset = SWITCH_TIMINGS.resetSeconds[0] + (seed % (SWITCH_TIMINGS.resetSeconds[1] - SWITCH_TIMINGS.resetSeconds[0] + 1));
    return [{ kind: 'segment', mode: a, minutes: half }, { kind: 'reset', from: a, to: b, seconds: reset }, { kind: 'segment', mode: b, minutes: Math.max(1, minutes - half) }];
  }
  if (stage === 'paired') {
    const seg = Math.max(SWITCH_TIMINGS.pairedMinutes[0], Math.min(SWITCH_TIMINGS.pairedMinutes[1], Math.floor(minutes / 2)));
    return [{ kind: 'segment', mode: a, minutes: seg }, { kind: 'probe', from: a, to: b }, { kind: 'segment', mode: b, minutes: seg }, { kind: 'probe', from: b, to: a }];
  }
  const count = Math.max(2, Math.floor((minutes * 60) / 75));
  const order = randomizedOrder(pool, count, seed, a);
  const steps: Step[] = [];
  let previous: ModeId = a;
  for (const next of order) {
    steps.push({ kind: 'probe', from: previous, to: next }, { kind: 'segment', mode: next, minutes: 0, fixedSeconds: 45 });
    previous = next;
  }
  return steps;
}

function ProbeRun({ from, to, stage, seed, index, sessionId, blockId, onDone }: { from: ModeId; to: ModeId; stage: SwitchStage; seed: number; index: number; sessionId: string; blockId: string; onDone: (probe: SwitchProbeRecord) => void }) {
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const layout = layoutFor(to, setup);
  const geometry = geometryFor(setup);
  const prompt = useMemo(() => wordDrill({ seed: seed + index, charset: introducedAt(layout, geometry, 4).chars.filter((c) => /[a-z ]/.test(c)), length: 80, title: 'Switch probe' }).text, [seed, index, layout, geometry]);
  const target = useMemo(() => toGraphemes(prompt), [prompt]);
  const engineRef = useRef<SwitchProbeEngine | null>(null);
  const interpreter = useMemo(() => new InputInterpreter(layout, { reference: false }), [layout]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cueAt = useRef<string>(new Date().toISOString());
  const [, setTick] = useState(0);
  const finished = useRef(false);

  useLayoutEffect(() => {
    // The clock starts when the cue has been painted.
    requestAnimationFrame(() => {
      engineRef.current = new SwitchProbeEngine(target, performance.now());
      cueAt.current = new Date().toISOString();
      setTick((t) => t + 1);
    });
  }, [target]);

  useEffect(() => {
    const timer = setInterval(() => {
      engineRef.current?.tick(performance.now());
      setTick((t) => t + 1);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    resetSurface(el);
    el.focus();
    const apply = (actions: ReturnType<InputInterpreter['compositionEnd']>) => {
      const engine = engineRef.current;
      if (!engine) return;
      for (const a of actions) {
        if (a.type === 'insert') engine.insert(a.t, a.grapheme);
        if (a.type === 'delete') engine.deleteBackward(a.t);
      }
      setTick((t) => t + 1);
    };
    const obs = (e: KeyboardEvent) => ({ t: e.timeStamp, code: e.code, key: e.key, shiftKey: e.shiftKey, altGraph: e.getModifierState('AltGraph'), capsLock: e.getModifierState('CapsLock'), ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, isComposing: e.isComposing });
    const keydown = (e: KeyboardEvent) => {
      const d = interpreter.keydown(obs(e));
      if (d.preventDefault) e.preventDefault();
      apply(d.actions);
    };
    const keyup = (e: KeyboardEvent) => apply(interpreter.keyup(obs(e)));
    const before = (e: InputEvent) => {
      const d = interpreter.beforeInput({ t: e.timeStamp, inputType: e.inputType, data: e.data, isComposing: e.isComposing });
      if (d.preventDefault && e.cancelable) e.preventDefault();
      apply(d.actions);
    };
    const compStart = () => interpreter.compositionStart();
    const compEnd = (e: CompositionEvent) => {
      const t = e.timeStamp;
      setTimeout(() => {
        const text = committedText(el);
        resetSurface(el);
        apply(interpreter.compositionEnd(t, text));
      }, 0);
    };
    const blur = (e: FocusEvent) => {
      engineRef.current?.blur(e.timeStamp);
      setTick((t) => t + 1);
    };
    const focus = (e: FocusEvent) => engineRef.current?.focus(e.timeStamp);
    const visibility = () => {
      if (document.visibilityState === 'hidden') engineRef.current?.hidden(performance.now());
      setTick((t) => t + 1);
    };
    el.addEventListener('keydown', keydown);
    el.addEventListener('keyup', keyup);
    el.addEventListener('beforeinput', before);
    el.addEventListener('compositionstart', compStart);
    el.addEventListener('compositionend', compEnd);
    el.addEventListener('blur', blur);
    el.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      el.removeEventListener('keydown', keydown);
      el.removeEventListener('keyup', keyup);
      el.removeEventListener('beforeinput', before);
      el.removeEventListener('compositionstart', compStart);
      el.removeEventListener('compositionend', compEnd);
      el.removeEventListener('blur', blur);
      el.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [interpreter]);

  const engine = engineRef.current;
  const outcome = engine?.outcome();
  useEffect(() => {
    if (!engine || !outcome?.outcome || finished.current) return;
    finished.current = true;
    const timeZone = state.data.profile?.timeZone ?? currentTimeZone();
    onDone({
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: newId(),
      sessionId,
      blockId,
      stage,
      from,
      to,
      fromLayout: `${layoutFor(from, setup).id}@${layoutFor(from, setup).revision}`,
      toLayout: `${layout.id}@${layout.revision}`,
      setupRevisionId: setup?.id ?? '',
      cueAt: cueAt.current,
      localDate: localDateIn(timeZone, Date.now()),
      seed,
      sequenceIndex: index,
      prompt,
      outcome: outcome.outcome,
      latencyMs: outcome.latencyMs,
      lowerBoundMs: outcome.lowerBoundMs,
      firstInsertMs: outcome.firstInsertMs,
      resets: engine.resets,
      interruption: outcome.interruption,
      declarations: { glances: null },
      events: engine.events.map((e) => ({ atMs: Math.round(e.atMs - engine.cueAtMs), kind: e.kind, ...(e.grapheme !== undefined ? { grapheme: e.grapheme } : {}), ...(e.correct !== undefined ? { correct: e.correct } : {}) })),
      origin: 'native-run',
    });
  });

  const elapsed = engine ? performance.now() - engine.cueAtMs : 0;
  const def = modeById(to);
  return (
    <div className="practice-shell" data-hand={handOf(to)} style={{ ['--practice-size' as string]: '30px' }}>
      <header className="strip">
        <ModeIdentity mode={to} />
        <div className="block-info">
          <strong>
            Switch {from} → {to}
          </strong>
          <span className="mono">
            {stage} · {PAIR_KIND_LABEL[pairKind(from, to)]} · latency probe
          </span>
        </div>
        <div className="strip-metrics">
          <div className="strip-metric">
            <span className="eyebrow">Streak</span>
            <span className="v">
              {engine?.currentStreak ?? 0}/{STREAK_LENGTH}
            </span>
          </div>
          <div className="strip-metric">
            <span className="eyebrow">Elapsed</span>
            <span className="v num">{seconds(Math.min(elapsed, PROBE_TIMEOUT_MS), 1)}</span>
          </div>
        </div>
      </header>
      <main className="practice-main">
        <Message kind="pending" tag="Now">
          Switch to <strong>{def.layoutName}</strong> with the <strong>{def.handLabel.toLowerCase()}</strong>: select <code>{layout.xkbName}</code> in the OS if needed, then type ten characters in
          a row correctly. The clock is already running; it includes the OS switch and hand movement.
        </Message>
        <div className="target-box" style={{ marginTop: 16 }}>
          <pre className="target-text" aria-hidden="true" style={{ color: 'var(--ink)' }}>
            {target.map((c, i) => {
              const correct = engine?.isCorrectAt(i);
              const cls = correct === true ? 'c correct' : correct === false ? 'c wrong' : i === (engine?.bufferLength ?? 0) ? 'c current' : 'c';
              return (
                <span key={i} className={cls} style={correct === null && i !== (engine?.bufferLength ?? 0) ? { color: 'var(--ink-upcoming)' } : undefined}>
                  {c}
                </span>
              );
            })}
          </pre>
          <textarea ref={inputRef} className="typing-surface" aria-label={`Switch probe to ${to}. Type the text.`} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          A wrong character or Backspace restarts the streak, never the clock. After {PROBE_TIMEOUT_MS / 1000} seconds the probe records a timeout — a lower bound, not a success.
        </p>
      </main>
    </div>
  );
}

function EndWithoutProbes({ onEnd }: { onEnd: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    onEnd();
  }, [onEnd]);
  return null;
}

export function SwitchingFlow({ session, block, title, onEnd }: { session: SessionRecord; block: PlannedBlock; title: string; onEnd: (record: SessionBlockRecord) => void }) {
  const store = useStore();
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const primary = state.data.profile?.primaryMode ?? 'QL';
  const switching = switchingFor(state.data, primary);
  const pair = (block.switchPair ?? switching?.pair ?? [primary, primary]) as [ModeId, ModeId];
  const stage: SwitchStage = switching?.stage ?? 'blocked';
  const acquired = (['QL', 'QR', 'DL', 'DR'] as ModeId[]).filter((m) => hasMilestone(state.data.milestones, m, 'acquired'));
  const [seed] = useState(() => randomSeed());
  const script = useMemo(() => switchScript(stage, pair, acquired.length >= 2 ? acquired : pair, block.minutes, seed), [stage, pair, acquired, block.minutes, seed]);
  const layouts = [...new Set(script.flatMap((s) => (s.kind === 'segment' ? [s.mode] : s.kind === 'probe' ? [s.from, s.to] : [s.from, s.to])).map((m) => layoutFor(m, setup).id))];
  const [calibrated, setCalibrated] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [probes, setProbes] = useState<SwitchProbeRecord[]>([]);
  const [trialIds, setTrialIds] = useState<string[]>([]);
  const [activeMs, setActiveMs] = useState(0);
  const [resetLeft, setResetLeft] = useState<number | null>(null);
  const [glances, setGlances] = useState<GlanceDeclaration | null>(null);
  const startedAt = useRef(new Date().toISOString());
  const step = script[index];

  useEffect(() => {
    if (step?.kind !== 'reset') return;
    setResetLeft(step.seconds);
    const timer = setInterval(() => setResetLeft((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(timer);
  }, [step]);

  // Calibrate every participating layout once, before the scored sequence.
  const needs = layouts.find((l) => !calibrated.includes(l));
  if (needs && stage !== 'blocked') {
    return (
      <main className="content">
        <p className="small muted">
          {title} · before a scored switch sequence, each participating layout is checked once. No calibration is inserted after a cue.
        </p>
        <CalibrationScreen layoutId={needs as never} kind="probe" onDone={(r) => (r?.status === 'passed' ? setCalibrated((c) => [...c, needs]) : onEnd({ blockId: block.id, kind: block.kind, mode: pair[0], startedAt: startedAt.current, endedAt: new Date().toISOString(), activeMs: 0, trialIds: [], status: 'skipped' }))} />
      </main>
    );
  }

  if (!step) {
    if (probes.length === 0) return <EndWithoutProbes onEnd={() => onEnd({ blockId: block.id, kind: block.kind, mode: pair[0], startedAt: startedAt.current, endedAt: new Date().toISOString(), activeMs, trialIds, status: 'completed' })} />;
    const completed = probes.filter((p) => p.outcome === 'complete');
    return (
      <main className="content">
        <div className="stack" style={{ maxWidth: 820 }}>
          <h1>Switching results</h1>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Direction</th>
                  <th>Kind</th>
                  <th>Outcome</th>
                  <th className="num">Latency</th>
                </tr>
              </thead>
              <tbody>
                {probes.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.from} → {p.to}
                    </td>
                    <td>{PAIR_KIND_LABEL[pairKind(p.from, p.to)]}</td>
                    <td>{p.outcome === 'timeout' ? 'timeout (≥ 30 s)' : p.outcome}</td>
                    <td className="num">{p.latencyMs !== null ? seconds(p.latencyMs) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            {completed.length} of {probes.length} probes completed. Timeouts are lower bounds and never count as a latency.
          </p>
          <GlanceField value={glances} onChange={setGlances} legend="Physical glances during these switches (all probes)" />
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              for (const p of probes) await store.saveProbe({ ...p, declarations: { glances } }).catch(() => undefined);
              onEnd({ blockId: block.id, kind: block.kind, mode: pair[0], startedAt: startedAt.current, endedAt: new Date().toISOString(), activeMs, trialIds, status: 'completed' });
            }}
          >
            Save and continue
          </button>
        </div>
      </main>
    );
  }

  if (step.kind === 'reset') {
    return (
      <div className="center-screen" data-hand={handOf(step.to)}>
        <div className="stack" style={{ textAlign: 'center' }}>
          <div className="eyebrow">Deliberate reset · next mode</div>
          <ModeIdentity mode={step.to} />
          <div className="countdown num">{resetLeft ?? step.seconds}</div>
          <p>
            Select <code>{layoutFor(step.to, setup).xkbName}</code> and move to the {modeById(step.to).handLabel.toLowerCase()}.
          </p>
          <button type="button" className="btn btn-primary" disabled={(resetLeft ?? 1) > 0} onClick={() => setIndex((i) => i + 1)}>
            Continue in {step.to}
          </button>
        </div>
      </div>
    );
  }

  if (step.kind === 'probe') {
    return <ProbeRun key={`probe-${index}`} from={step.from} to={step.to} stage={stage} seed={seed} index={index} sessionId={session.id} blockId={block.id} onDone={(p) => { setProbes((list) => [...list, p]); setIndex((i) => i + 1); }} />;
  }

  const fixedPlan = step.fixedSeconds
    ? (s: number): ExercisePlan => {
        const layout = layoutFor(step.mode, setup);
        return {
          exercise: wordDrill({ seed: s, charset: introducedAt(layout, geometryFor(setup), 4).chars, length: 400, capitalFraction: 0.1, punctuationFraction: 0.05, title: 'Switching segment' }),
          protocol: PROTOCOLS['switch-segment-v1'],
          trialKind: 'switch-practice',
          assessmentLevel: null,
          initialAssistance: null,
          goal: 'Segment after the probe; its timer starts fresh',
        };
      }
    : undefined;
  return (
    <BlockRunner
      key={`segment-${index}`}
      mode={step.mode}
      kind="words"
      minutes={step.fixedSeconds ? 0 : step.minutes}
      sessionId={session.id}
      blockId={block.id}
      title={`${title} · ${step.mode} segment`}
      autoFinish
      {...(fixedPlan ? { fixedPlan } : {})}
      onEnd={(record) => {
        setTrialIds((ids) => [...ids, ...record.trialIds]);
        setActiveMs((ms) => ms + record.activeMs);
        if (record.status === 'ended-early' && !step.fixedSeconds) setIndex(script.length);
        else setIndex((i) => i + 1);
      }}
    />
  );
}
