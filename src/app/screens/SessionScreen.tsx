// Runs a planned session block by block. Changing to a different OS layout
// between blocks runs the short probe; QL ↔ QR needs only a hand
// confirmation. The session ends with a short log; stopping early is fine.
import { useState } from 'react';
import { modeById, type ModeId } from '../../domain/modes';
import type { PlannedBlock, SessionBlockRecord, SessionRecord } from '../../domain/records';
import { handOf, Message, ModeIdentity, Ordinal } from '../components/basics';
import { BenchmarkSetFlow } from '../practice/BenchmarkSetFlow';
import { BlockRunner } from '../practice/BlockRunner';
import { ControlsExercise } from '../practice/ControlsExercise';
import { SwitchingFlow } from '../practice/SwitchingFlow';
import { href, navigate } from '../router';
import { layoutFor, currentSetup, isCalibrated, modeOverview } from '../store/derive';
import { useAppState, useStore } from '../store/react';
import { CalibrationScreen } from './CalibrationScreen';
import { SessionLog } from './ReviewScreen';

/** The layout last practised in this tab; a different one needs the short probe. */
let lastLayoutInTab: string | null = null;

export function SessionScreen({ sessionId }: { sessionId: string | null }) {
  const store = useStore();
  const state = useAppState();
  const session = state.data.sessions.find((s) => s.id === sessionId);
  const [phase, setPhase] = useState<'intro' | 'between' | 'probe' | 'block' | 'log'>('intro');
  const [handConfirmed, setHandConfirmed] = useState<string | null>(null);
  const [fatigue, setFatigue] = useState<number | null>(session?.fatigueBefore ?? null);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <div className="center-screen">
        <Message kind="short" tag="Not found">
          That session does not exist. <a href={href('/')}>Back to Today</a>
        </Message>
      </div>
    );
  }
  if (session.status !== 'active') {
    navigate(`/review/${session.id}`);
    return null;
  }
  const setup = currentSetup(state.data.setups);
  const nextIndex = session.blocks.length;
  const block: PlannedBlock | undefined = session.plannedBlocks[nextIndex];
  const previous = session.plannedBlocks[nextIndex - 1];

  async function save(next: SessionRecord) {
    try {
      await store.putSession(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function recordBlock(record: SessionBlockRecord) {
    const latest = store.data.sessions.find((s) => s.id === session?.id) ?? (session as SessionRecord);
    await save({ ...latest, blocks: [...latest.blocks, record], actualMinutes: latest.actualMinutes + record.activeMs / 60_000 });
    await store.applyAwards().catch(() => undefined);
    setHandConfirmed(null);
    setPhase('between');
  }

  const skip = (b: PlannedBlock) =>
    void recordBlock({ blockId: b.id, kind: b.kind, mode: b.mode, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), activeMs: 0, trialIds: [], status: 'skipped' });

  if (phase === 'intro' && session.blocks.length === 0) {
    const hasBenchmark = session.plannedBlocks.some((b) => b.benchmark);
    return (
      <div className="center-screen">
        <div className="panel panel-pad stack" style={{ width: 'min(680px, 100%)' }}>
          <div>
            <div className="eyebrow">
              Session · {session.plannedMinutes} min · {session.plannedBlocks.length} blocks
            </div>
            <h1 style={{ marginTop: 8 }}>Before you start</h1>
          </div>
          <Ordinal label="Fatigue before the session" value={fatigue} onChange={setFatigue} low="none" high="high" />
          {fatigue !== null && fatigue >= 4 && (
            <Message kind="tentative" tag="Consider">
              Fatigue is already high. A shorter session is a good choice{hasBenchmark ? ', and a fresh benchmark on another day will be more representative' : ''}. Stopping early costs
              nothing.
            </Message>
          )}
          <p className="small muted">Optional — leave it blank to skip. Discomfort is a reason to stop or adjust, never to push on.</p>
          {error && <Message kind="error">{error}</Message>}
          <div className="inline-actions">
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={() => {
                void save({ ...session, fatigueBefore: fatigue }).then(() => setPhase('between'));
              }}
            >
              Begin
            </button>
            <a className="btn" href={href('/')}>
              Not now
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!block || phase === 'log' || block.kind === 'log') {
    return (
      <main className="content">
        <SessionLog
          session={session}
          endedEarly={!!block && block.kind !== 'log'}
          onSaved={() => {
            lastLayoutInTab = null;
            navigate(`/review/${session.id}`);
          }}
        />
      </main>
    );
  }

  const mode = (block.mode ?? state.data.profile?.primaryMode ?? 'QL') as ModeId;
  const overview = modeOverview(state.data, mode, state.today, state.browserSession);
  const layout = layoutFor(mode, setup);
  const layoutChanged = lastLayoutInTab !== null && lastLayoutInTab !== layout.id;
  const handSwitch = previous?.mode && previous.mode !== mode && modeById(previous.mode).family === modeById(mode).family;

  if (phase === 'probe') {
    return (
      <main className="content">
        <CalibrationScreen
          layoutId={layout.id}
          kind={overview.calibration.status === 'none' || overview.calibration.status === 'failed' || overview.calibration.status === 'incomplete' ? 'full' : 'probe'}
          onDone={(record) => {
            if (record && record.status === 'passed') {
              lastLayoutInTab = layout.id;
              setPhase('block');
            } else setPhase('between');
          }}
        />
      </main>
    );
  }

  if (phase === 'block') {
    const done = (record: SessionBlockRecord) => {
      lastLayoutInTab = layout.id;
      void recordBlock(record);
    };
    const title = `Block ${nextIndex + 1} of ${session.plannedBlocks.length} · ${block.title}`;
    if (block.kind === 'switching' && block.switchPair) {
      return <SwitchingFlow session={session} block={block} title={title} onEnd={done} />;
    }
    if (block.kind === 'benchmark' || (block.kind === 'maintenance' && block.benchmark)) {
      return (
        <BenchmarkSetFlow
          mode={mode}
          sessionId={session.id}
          blockId={block.id}
          purpose={block.kind === 'maintenance' ? 'maintenance' : 'stage'}
          onCancel={() => setPhase('between')}
          onDone={(set) => {
            const trials = (set?.trialIds ?? []).map((id) => state.data.trials.find((t) => t.id === id)).filter((t) => !!t);
            done({ blockId: block.id, kind: block.kind, mode, startedAt: set?.createdAt ?? new Date().toISOString(), endedAt: new Date().toISOString(), activeMs: trials.reduce((s, t) => s + (t?.activeMs ?? 0), 0), trialIds: set?.trialIds ?? [], status: set?.status === 'complete' ? 'completed' : 'ended-early' });
          }}
        />
      );
    }
    if (block.kind === 'assessment' && overview.level === 1 && (!overview.state?.controlsCompletedAt || !overview.state?.comfortConfirmedAt)) {
      return <ControlsExercise mode={mode} onDone={() => done({ blockId: block.id, kind: block.kind, mode, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), activeMs: 0, trialIds: [], status: 'completed' })} />;
    }
    return <BlockRunner mode={mode} kind={block.kind} minutes={block.kind === 'assessment' ? 0 : block.minutes} sessionId={session.id} blockId={block.id} title={title} onEnd={done} />;
  }

  // Between blocks: say what comes next and what to change in the OS.
  return (
    <div className="center-screen">
      <div className="panel panel-pad stack" style={{ width: 'min(720px, 100%)' }} data-hand={handOf(mode)}>
        <div className="eyebrow">
          Block {nextIndex + 1} of {session.plannedBlocks.length} · {block.minutes} min
        </div>
        <ModeIdentity mode={mode} />
        <h2>
          {block.title}
          {block.detail ? <span className="muted"> · {block.detail}</span> : null}
        </h2>
        {layoutChanged ? (
          <Message kind="pending" tag="Switch input source">
            Select <strong>{layout.os.inputSourceLabel ?? layout.xkbName}</strong> (<code>{layout.xkbName}</code>) in your OS now. A short probe checks it before practice.
          </Message>
        ) : (
          <p className="small muted">
            Input source: <code>{layout.xkbName}</code>. Typist does not change your OS layout.
          </p>
        )}
        {handSwitch && (
          <label className="choice" style={{ maxWidth: 560 }}>
            <input type="checkbox" checked={handConfirmed === block.id} onChange={(e) => setHandConfirmed(e.target.checked ? block.id : null)} />
            I have moved to the {modeById(mode).hand} hand for {mode}.
          </label>
        )}
        {error && <Message kind="error">{error}</Message>}
        <div className="inline-actions">
          <button
            type="button"
            className="btn btn-primary btn-large"
            disabled={!!handSwitch && handConfirmed !== block.id}
            onClick={() => setPhase(layoutChanged || !isCalibrated(overview.calibration) ? 'probe' : 'block')}
          >
            Start block
          </button>
          <button type="button" className="btn" onClick={() => skip(block)}>
            Skip this block
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setPhase('log')}>
            End session here
          </button>
          {!!handSwitch && handConfirmed !== block.id && <span className="disabled-reason">Confirm the hand change first.</span>}
        </div>
        <ol className="small muted">
          {session.plannedBlocks.map((b, i) => (
            <li key={b.id} style={{ fontWeight: i === nextIndex ? 600 : 400 }}>
              {b.title} · {b.mode ?? '—'} · {b.minutes} min{session.blocks[i] ? ` · ${session.blocks[i]?.status}` : ''}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
