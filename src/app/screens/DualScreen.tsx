// Optional two-machine endgame (docs/dual-machine.md). One hand per keyboard
// on two machines: each runs Typist with its own keyboard, layout and text; a
// small coordinator on the local network schedules one shared 60-second
// interval. This screen is the room: this side's setup and matched solo
// baselines, the manifest both sides acknowledge, results, progress, and
// import-based cross-stream analysis.
import { useEffect, useMemo, useState } from 'react';
import {
  bothStalled,
  checkManifestForRole,
  COPY_ACCURACY_FLOOR,
  coordinatedRuns,
  DUAL_LEVEL_DEFINITIONS,
  DUAL_LEVELS,
  DUAL_TRIAL_MS,
  type DualLevel,
  type DualManifest,
  type DualRunRecord,
  type ImportOutcome,
  LEFT_MODES,
  levelReady,
  mergeImportedSide,
  RIGHT_MODES,
  type Role,
  runEfficiency,
  runValidity,
  type RunView,
  runViews,
  type SideResult,
  stallSummary,
  substitutionCandidates,
  synchronized,
  throughputMilestone,
} from '../../domain/dual';
import { newId } from '../../domain/ids';
import { modeById, type ModeId } from '../../domain/modes';
import { randomSeed } from '../../domain/random';
import { SCORER_VERSION } from '../../domain/versions';
import { announcementFor, baselineFresh, dualSession, matchedBaseline, type SideAnnouncement } from '../../dual/session';
import { dualTasks } from '../../dual/tasks';
import { handOf, Message, NoEvidence } from '../components/basics';
import { downloadText } from '../runtime/exporting';
import { href, navigate, useRoute } from '../router';
import { currentSetup, hasMilestone, isCalibrated, modeOverview } from '../store/derive';
import { useAppState, useStore } from '../store/react';
import { CalibrationScreen } from './CalibrationScreen';
import { useDualSession } from './DualRunScreen';

const SIDE_FILE_FORMAT = 'typist-dual-side';
/** Window for cross-stream substitution candidates. */
const SUBSTITUTION_WINDOW_MS = 400;

export function DualScreen() {
  const state = useAppState();
  if (!state.data.core[0]) {
    return (
      <div className="stack" style={{ maxWidth: 820 }}>
        <h1>Two machines</h1>
        <Message kind="pending" tag="Locked">
          The two-machine module opens after core completion (all four modes acquired and currently stable). <a href={href('/progress')}>See core completion</a>
        </Message>
      </div>
    );
  }
  return <DualLobby />;
}

function taskClassFor(level: DualLevel, role: Role): string {
  return dualTasks(level, 0)[role].taskClass;
}

function DualLobby() {
  const store = useStore();
  const state = useAppState();
  const route = useRoute();
  const { client, state: cs } = useDualSession();
  const choice = dualSession.choice;
  const [view, setView] = useState<'room' | 'calibrate'>('room');
  const [joinCode, setJoinCode] = useState(route.query.get('room') ?? '');
  const setup = currentSetup(state.data.setups);
  const acquired = (m: ModeId) => !!hasMilestone(state.data.milestones, m, 'acquired');
  const role = cs?.role ?? choice.role;
  const options = (role === 'left' ? LEFT_MODES : RIGHT_MODES).filter((m) => ['QL', 'DL', 'QR', 'DR'].includes(m) || acquired(m));
  const mode = choice.mode;
  const overview = modeOverview(state.data, mode, state.today, state.browserSession);
  const layoutRevision = `${overview.layout.id}@${overview.layout.revision}`;
  const announcement = useMemo(() => (setup ? announcementFor(state.data.trials, mode, setup.id, layoutRevision) : null), [state.data.trials, mode, setup, layoutRevision]);
  const announceKey = JSON.stringify(announcement);
  const views = useMemo(() => runViews(state.data.dualRuns), [state.data.dualRuns]);

  // A join link presets the vacant role.
  useEffect(() => {
    const preset = route.query.get('role');
    if (!dualSession.client && (preset === 'left' || preset === 'right') && preset !== dualSession.choice.role) {
      dualSession.setChoice({ role: preset, mode: preset === 'left' ? 'QL' : 'DR' });
    }
  }, [route.query]);
  // Tell the room about this side whenever it changes (mode, setup, baselines).
  useEffect(() => {
    if (client && cs?.room && announcement) client.announce(announcement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, cs?.room, announceKey]);
  // The left machine proposes the level; follow it here.
  useEffect(() => {
    if (cs?.manifest && cs.manifest.level !== dualSession.choice.level) dualSession.setChoice({ level: cs.manifest.level });
  }, [cs?.manifest]);
  // The scheduled start takes over the screen.
  useEffect(() => {
    if ((cs?.phase === 'scheduled' || cs?.phase === 'running') && dualSession.local?.runId !== cs.manifest?.runId) navigate('/dual/run');
  }, [cs?.phase, cs?.manifest?.runId]);

  if (!setup) return null;
  if (view === 'calibrate') {
    return <CalibrationScreen layoutId={overview.layout.id} kind={overview.calibration.status === 'probe-required' ? 'probe' : 'full'} onDone={() => setView('room')} />;
  }

  const level = choice.level;
  const taskClass = taskClassFor(level, role);
  const baseline = taskClass === 'composition' ? null : matchedBaseline(state.data.trials, mode, taskClass, setup.id);
  const twoHandClass = level === 'D5' ? 'prose' : taskClassFor(level, 'left');
  const twoHand = matchedBaseline(state.data.trials, 'Q2', twoHandClass, setup.id);
  const calibrated = isCalibrated(overview.calibration);
  const inRoom = !!cs?.room;
  const sidesKnown = cs?.sides as { left: SideAnnouncement | null; right: SideAnnouncement | null } | null;

  const composeManifest = () => {
    if (!client || !sidesKnown?.left || !sidesKnown.right) return;
    const seed = randomSeed();
    const tasks = dualTasks(level, seed);
    const side = (r: Role) => {
      const s = sidesKnown[r] as SideAnnouncement;
      const t = tasks[r];
      return {
        role: r,
        mode: s.mode,
        layoutRevision: s.layoutRevision,
        setupRevisionId: s.setupRevisionId,
        taskId: t.exercise?.id ?? 'free-composition',
        taskSha256: t.exercise?.sha256 ?? null,
        taskClass: t.taskClass,
        composition: t.exercise === null,
        baselineTrialIds: s.baselines[t.taskClass] ?? [],
      };
    };
    const manifest: DualManifest = { runId: newId(), protocolId: 'dual-copy-60-v1', scorerVersion: SCORER_VERSION, level, durationMs: DUAL_TRIAL_MS, seed, createdAt: new Date().toISOString(), left: side('left'), right: side('right') };
    client.sendManifest(manifest);
  };

  // Each machine checks its own role, mode, setup, layout and regenerated text against the manifest.
  const problems: string[] = [];
  const myRole = cs?.role ?? null;
  if (cs?.manifest && myRole) {
    problems.push(...checkManifestForRole(cs.manifest, myRole, { mode, setupRevisionId: setup.id }));
    const mine = dualTasks(cs.manifest.level, cs.manifest.seed)[myRole];
    const side = cs.manifest[myRole];
    if ((mine.exercise?.sha256 ?? null) !== side.taskSha256 || mine.taskClass !== side.taskClass) problems.push('This machine regenerated a different task than the manifest names.');
    if (side.layoutRevision !== layoutRevision) problems.push(`The manifest names layout ${side.layoutRevision}, but this machine uses ${layoutRevision}.`);
  }
  const current = dualSession.local ? views.find((v) => v.runId === dualSession.local?.runId) : undefined;
  const terminal = cs?.phase === 'complete' || cs?.phase === 'stopped' || cs?.phase === 'incomplete';

  return (
    <div className="stack" style={{ maxWidth: 1040 }} data-hand={role}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Optional two-machine endgame · after core completion</div>
          <h1 style={{ marginTop: 8 }}>One hand per keyboard, two machines</h1>
        </div>
        <span className="dual-role" data-hand={role} data-testid="dual-role">
          {role === 'left' ? 'Left machine · left hand' : 'Right machine · right hand'}
        </span>
      </div>
      <Message kind="observed" tag="How it works">
        Each machine runs Typist with its own keyboard, hand, layout and text. A small coordinator on your network starts both at the same moment; each side counts only what it types inside that shared
        minute, saves its own result, and sends only final counters. The app cannot see your hands or attention: glances and collapses are yours to report.
      </Message>

      <section className="panel panel-pad stack-sm" aria-labelledby="dual-this-machine">
        <h2 id="dual-this-machine">This machine</h2>
        <fieldset>
          <legend>Role</legend>
          <div className="choice-row">
            {(['left', 'right'] as const).map((r) => (
              <label key={r} className="choice">
                <input type="radio" name="dual-role" checked={role === r} disabled={inRoom} onChange={() => dualSession.setChoice({ role: r, mode: r === 'left' ? 'QL' : 'DR' })} />
                {r === 'left' ? 'Left machine (left hand)' : 'Right machine (right hand)'}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Mode on this machine</legend>
          <div className="choice-row">
            {options.map((m) => (
              <label key={m} className="choice" data-hand={handOf(m)}>
                <input type="radio" name="dual-mode" checked={mode === m} onChange={() => dualSession.setChoice({ mode: m })} />
                {m} · {modeById(m).layoutName}
                {!acquired(m) ? ' (not acquired)' : ''}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Level{role === 'right' && inRoom ? ' (the left machine proposes each run)' : ''}</legend>
          <div className="choice-row">
            {DUAL_LEVELS.map((l) => (
              <label key={l} className="choice">
                <input type="radio" name="dual-level" checked={level === l} onChange={() => dualSession.setChoice({ level: l })} />
                {l}
              </label>
            ))}
          </div>
          <p className="field-help">
            {DUAL_LEVEL_DEFINITIONS[level].tasks} — {DUAL_LEVEL_DEFINITIONS[level].measurement}. This side's task: <strong>{taskClass}</strong>.
          </p>
        </fieldset>
        <div className="field-row">
          <label htmlFor="dual-placement">Keyboard placement, angle, feel and screen arrangement</label>
          <textarea id="dual-placement" className="field" rows={2} value={choice.placement} onChange={(e) => dualSession.setChoice({ placement: e.target.value })} />
        </div>
        <dl className="kv">
          <dt>Calibration ({overview.layout.xkbName})</dt>
          <dd>
            {calibrated ? 'Fresh' : 'Needed before acknowledging a run'}{' '}
            {!calibrated && (
              <button type="button" className="btn btn-small" onClick={() => setView('calibrate')}>
                Calibrate
              </button>
            )}
          </dd>
          <dt>Solo baseline</dt>
          <dd data-testid="solo-baseline">
            {taskClass === 'composition' ? (
              'Not applicable to free composition'
            ) : baseline ? (
              <>
                {baseline.medianWpm.toFixed(1)} WPM · median of 3 · latest {baseline.latestDate}
                {!baselineFresh(baseline, state.today) && ' · older than 7 days, refresh it'}
              </>
            ) : (
              <NoEvidence>
                None yet for {mode} · {taskClass}
              </NoEvidence>
            )}{' '}
            {taskClass !== 'composition' && (
              <a className="btn btn-small" href={href(`/dual/baseline/${mode}/${taskClass}`)}>
                Measure 3 cue-started trials
              </a>
            )}
          </dd>
          <dt>Two-hand baseline (Q2 · {twoHandClass})</dt>
          <dd>
            {twoHand ? `${twoHand.medianWpm.toFixed(1)} WPM · latest ${twoHand.latestDate}` : <NoEvidence>None yet</NoEvidence>}{' '}
            <a className="btn btn-small" href={href(`/dual/baseline/Q2/${twoHandClass}`)}>
              Measure two-hand baseline
            </a>
          </dd>
        </dl>
      </section>

      <section className="panel panel-pad stack-sm" aria-labelledby="dual-room">
        <h2 id="dual-room">Room</h2>
        {!inRoom ? (
          <>
            <div className="field-row">
              <label htmlFor="coordinator">Coordinator address</label>
              <input id="coordinator" type="text" className="field" value={choice.url} onChange={(e) => dualSession.setChoice({ url: e.target.value })} />
            </div>
            <div className="inline-actions">
              <button type="button" className="btn btn-primary" onClick={() => void dualSession.open(store, 'create')}>
                Create a room
              </button>
              <label htmlFor="room-code" className="visually-hidden">
                Room code
              </label>
              <input id="room-code" type="text" className="field" placeholder="Room code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} style={{ maxWidth: 320 }} />
              <button type="button" className="btn" disabled={!joinCode.trim()} onClick={() => void dualSession.open(store, 'join', joinCode)}>
                Join as the {role} machine
              </button>
            </div>
            {cs?.phase === 'connecting' && <p className="small muted">Connecting…</p>}
            {cs?.message && <Message kind={cs.phase === 'error' ? 'error' : 'short'}>{cs.message}</Message>}
          </>
        ) : (
          <div className="stack-sm">
            <p>
              Room <code data-testid="room-code">{cs?.room}</code> · this is the <strong>{myRole}</strong> machine. On the other machine, open:
            </p>
            <p>
              <code style={{ overflowWrap: 'anywhere' }} data-testid="join-link">{`${location.origin}${location.pathname}#/dual?room=${cs?.room}&role=${myRole === 'left' ? 'right' : 'left'}`}</code>
            </p>
            <ul className="small" aria-label="Machines in this room">
              {(['left', 'right'] as const).map((r) => {
                const peer = cs?.peers?.[r];
                const spec = sidesKnown?.[r];
                return (
                  <li key={r} data-testid={`peer-${r}`}>
                    {r}: {peer?.present || r === myRole ? 'connected' : 'waiting'}
                    {spec ? ` · ${spec.mode}` : ''}
                    {peer?.clock ? ` · clock ±${Math.round(peer.clock.uncertaintyMs)} ms (${peer.clock.samples} samples)` : ''}
                    {peer?.ready ? ' · manifest acknowledged' : ''}
                    {peer?.armed ? ' · ready to start' : ''}
                  </li>
                );
              })}
            </ul>
            {cs?.message && <Message kind="short">{cs.message}</Message>}
            {myRole === 'left' ? (
              <div className="inline-actions">
                <button type="button" className="btn" disabled={!sidesKnown?.left || !sidesKnown.right || cs?.phase !== 'lobby'} onClick={composeManifest}>
                  Propose a {level} run
                </button>
                {!sidesKnown?.right && <span className="disabled-reason">Waiting for the right machine to join.</span>}
              </div>
            ) : (
              !cs?.manifest && <p className="small muted">Waiting for the left machine to propose a run.</p>
            )}
            {cs?.manifest && myRole && !terminal && (
              <ManifestPanel
                manifest={cs.manifest}
                hash={cs.manifestHash ?? ''}
                problems={problems}
                calibrated={calibrated}
                acknowledged={!!cs.peers?.[myRole].ready}
                bothAcknowledged={!!cs.peers?.left.ready && !!cs.peers?.right.ready}
                armed={!!cs.peers?.[myRole].armed}
                onAcknowledge={() => client?.acknowledge(cs.manifestHash as string)}
                onArm={() => void client?.arm()}
              />
            )}
            <div className="inline-actions">
              {client && terminal && myRole === 'left' && (
                <button type="button" className="btn" onClick={() => client.reset()}>
                  Set up another run
                </button>
              )}
              <button type="button" className="btn btn-small" onClick={() => dualSession.close()}>
                Leave the room
              </button>
            </div>
          </div>
        )}
      </section>

      {current && (
        <section className="panel panel-pad stack-sm" aria-labelledby="dual-latest">
          <h2 id="dual-latest">Latest run</h2>
          {current.coordinated === 'pending' && <p className="small muted">Saved on this machine. Waiting for the other machine's result…</p>}
          <RunSummary view={current} />
        </section>
      )}

      <Progress views={views} twoHandClass={twoHandClass} setupId={setup.id} />
      <History views={views} />
      <CrossStream views={views} />
    </div>
  );
}

function ManifestPanel(props: {
  manifest: DualManifest;
  hash: string;
  problems: readonly string[];
  calibrated: boolean;
  acknowledged: boolean;
  bothAcknowledged: boolean;
  armed: boolean;
  onAcknowledge: () => void;
  onArm: () => void;
}) {
  const { manifest: m } = props;
  return (
    <div className="stack-sm" data-testid="manifest">
      <h3>
        Proposed run · {m.level} · manifest <code>{props.hash.slice(0, 12)}</code>
      </h3>
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Side</th>
            <th scope="col">Mode</th>
            <th scope="col">Task</th>
            <th scope="col">Baseline trials</th>
          </tr>
        </thead>
        <tbody>
          {(['left', 'right'] as const).map((r) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              <td>{m[r].mode}</td>
              <td>
                {m[r].taskClass}
                {m[r].composition ? ' (free composition)' : ''}
              </td>
              <td>{m[r].composition ? '—' : m[r].baselineTrialIds.length > 0 ? m[r].baselineTrialIds.length : 'none'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.problems.length > 0 ? (
        <Message kind="error" tag="Mismatch">
          {props.problems.join(' ')} This machine cannot acknowledge it; change this side or ask the left machine to propose again.
        </Message>
      ) : (
        <div className="inline-actions">
          <button type="button" className="btn" disabled={!props.calibrated || props.acknowledged} onClick={props.onAcknowledge}>
            {props.acknowledged ? 'Acknowledged' : 'Acknowledge this manifest'}
          </button>
          <button type="button" className="btn btn-primary" disabled={!props.bothAcknowledged || props.armed} onClick={props.onArm}>
            {props.armed ? 'Waiting for the other machine' : 'Ready to start'}
          </button>
          {!props.calibrated && <span className="disabled-reason">Calibrate this machine's layout first.</span>}
        </div>
      )}
    </div>
  );
}

function sideLine(r: SideResult | undefined) {
  if (!r) return <NoEvidence>Not received</NoEvidence>;
  if (r.composition) {
    return `${r.productionWpm?.toFixed(1)} production WPM · ${r.deletions} deletions · accuracy not measured${r.coherence ? ` · coherence ${r.coherence}/5 (self-rated)` : ''} · ${r.status}`;
  }
  return `${(r.wpm ?? 0).toFixed(1)} WPM · ${r.accuracy === null ? 'no input' : `${r.accuracy.toFixed(2)}%`} · ${r.status}`;
}

function glanceLine(r: SideResult | undefined): string {
  if (!r) return '—';
  return r.glances === null ? 'not asked' : r.glances === 'unknown' ? 'not sure' : String(r.glances);
}

function verdictLine(view: RunView): string {
  const stopper = view.left?.stoppedBy ?? view.right?.stoppedBy ?? null;
  const reason = view.left?.stopReason ?? view.right?.stopReason ?? null;
  switch (view.coordinated) {
    case 'complete':
      return 'Complete: both results arrived for the shared interval.';
    case 'stopped':
      return `Stopped${stopper ? ` by the ${stopper} machine` : ''}${reason ? ` (${reason})` : ''}. Not a coordinated comparison.`;
    case 'pending':
      return 'Waiting for the other machine.';
    default:
      return 'Incomplete: a side disconnected or never reported. Local work is kept; imported files cannot complete it.';
  }
}

function RunSummary({ view }: { view: RunView }) {
  const left = view.left?.result;
  const right = view.right?.result;
  const sync = left && right ? synchronized(left.sync, right.sync) : null;
  const validity = left && right ? runValidity({ runId: view.runId, localDate: view.localDate, level: view.level, left, right }) : null;
  const efficiency = runEfficiency(view);
  const both = left && right ? bothStalled(left.stalls, right.stalls) : null;
  return (
    <div className="stack-sm" data-testid="run-summary">
      <p>
        <strong>{view.level}</strong> · {view.localDate} · run <code>{view.runId.slice(0, 8)}</code> · <span data-testid="run-verdict">{verdictLine(view)}</span>
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Side</th>
              <th scope="col">Mode · task</th>
              <th scope="col">Output</th>
              <th scope="col">Glances</th>
              <th scope="col">Stalls (2 s+)</th>
            </tr>
          </thead>
          <tbody>
            {(['left', 'right'] as const).map((r) => {
              const res = r === 'left' ? left : right;
              const s = res ? stallSummary(res.stalls) : null;
              return (
                <tr key={r} data-testid={`side-${r}`}>
                  <th scope="row">{r}</th>
                  <td>
                    {view.manifest[r].mode} · {view.manifest[r].taskClass}
                  </td>
                  <td>{sideLine(res)}</td>
                  <td>{glanceLine(res)}</td>
                  <td>{s ? `${s.count} · ${(s.totalMs / 1000).toFixed(1)} s` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {both && (
        <p className="small">
          Both stalled at once: {both.count} · {(both.totalMs / 1000).toFixed(1)} s. A stall is an observable pause, not a diagnosis of a collapse.
        </p>
      )}
      {sync && (
        <p className="small" data-testid="run-sync">
          {sync.ok ? 'Synchronized: clock uncertainty and start-cue lateness within 100 ms on both sides.' : `Unsynchronized: ${sync.reasons.join(' ')} Excluded from coordinated efficiency milestones.`}
        </p>
      )}
      {validity && !validity.valid && view.coordinated === 'complete' && <p className="small">Not counted: {validity.reasons.join(' ')}</p>}
      {efficiency && (
        <p data-testid="run-efficiency">
          {efficiency.available ? (
            <>
              Combined {efficiency.combinedWpm.toFixed(1)} WPM · dual efficiency <strong>{(efficiency.efficiency * 100).toFixed(2)}%</strong> · left cost {(efficiency.leftCost * 100).toFixed(1)}% · right cost{' '}
              {(efficiency.rightCost * 100).toFixed(1)}%
            </>
          ) : (
            <>
              {efficiency.combinedWpm !== null ? `Combined ${efficiency.combinedWpm.toFixed(1)} WPM. ` : ''}Efficiency unavailable: {efficiency.reasons.join(' ')}
            </>
          )}
        </p>
      )}
      <p className="small muted">Two separate documents remain two separate outputs; a combined total never hides one side stopping.</p>
    </div>
  );
}

function Progress({ views, twoHandClass, setupId }: { views: readonly RunView[]; twoHandClass: string; setupId: string }) {
  const state = useAppState();
  if (views.length === 0) return null;
  const runs = coordinatedRuns(views);
  const twoHand = matchedBaseline(state.data.trials, 'Q2', twoHandClass, setupId);
  const matched = coordinatedRuns(views.filter((v) => v.manifest.left.taskClass === twoHandClass && v.manifest.right.taskClass === twoHandClass));
  const throughput = throughputMilestone(matched, twoHand);
  const counted = (l: DualLevel) =>
    runs.filter((r) => r.level === l && runValidity(r).valid && !r.left.composition && !r.right.composition && (r.left.accuracy ?? 0) >= COPY_ACCURACY_FLOOR && (r.right.accuracy ?? 0) >= COPY_ACCURACY_FLOOR).length;
  return (
    <section className="panel panel-pad stack-sm" aria-labelledby="dual-progress">
      <h2 id="dual-progress">Progress</h2>
      <ul className="small">
        {(['D1', 'D2', 'D3', 'D4'] as const).map((l) => (
          <li key={l}>
            {l}: {Math.min(counted(l), 3)} of 3 completed, synchronized runs with both copy sides at {COPY_ACCURACY_FLOOR}%+
            {levelReady(runs, l) ? ' — ready to move on when the tasks feel manageable' : ''}
          </li>
        ))}
        <li>D5 has no automatic correctness gate: composition is not scored.</li>
      </ul>
      <p className="small" data-testid="throughput">
        Throughput milestone ({twoHandClass} on both sides): {throughput.met ? `met on ${throughput.dates.join(', ')}.` : `not met — ${throughput.reasons.join(' ')}`} It needs three coordinated copy runs on
        distinct dates, both sides at {COPY_ACCURACY_FLOOR}%+, zero declared glances, and combined WPM above the matched two-hand baseline.
      </p>
    </section>
  );
}

function sideFile(record: DualRunRecord): string {
  // Notes and composed text stay on this machine.
  return JSON.stringify({ format: SIDE_FILE_FORMAT, formatVersion: 1, record: { ...record, notes: null, compositionText: null } }, null, 2);
}

function History({ views }: { views: readonly RunView[] }) {
  if (views.length === 0) return null;
  return (
    <section className="panel panel-pad stack-sm" aria-labelledby="dual-history">
      <h2 id="dual-history">Runs on this machine</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Level</th>
              <th scope="col">Left</th>
              <th scope="col">Right</th>
              <th scope="col">Outcome</th>
              <th scope="col">Side file</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v) => {
              const e = runEfficiency(v);
              const local = [v.left, v.right].find((r) => r?.source === 'local');
              return (
                <tr key={v.runId}>
                  <td>{v.localDate}</td>
                  <td>{v.level}</td>
                  <td>{sideLine(v.left?.result)}</td>
                  <td>{sideLine(v.right?.result)}</td>
                  <td>
                    {v.coordinated}
                    {e?.available ? ` · ${(e.efficiency * 100).toFixed(2)}%` : ''}
                  </td>
                  <td>
                    {local && (
                      <button type="button" className="btn btn-small" onClick={() => downloadText(`typist-dual-${v.runId.slice(0, 8)}-${local.role}.json`, sideFile(local))}>
                        Export {local.role} side
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function isSideRecord(value: unknown): value is DualRunRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const result = r.result as Record<string, unknown> | undefined;
  return (
    typeof r.id === 'string' &&
    typeof r.runId === 'string' &&
    (r.role === 'left' || r.role === 'right') &&
    typeof r.manifestHash === 'string' &&
    !!r.manifest &&
    typeof r.manifest === 'object' &&
    !!result &&
    typeof result === 'object' &&
    typeof result.trialId === 'string' &&
    Array.isArray(result.stalls) &&
    !!result.sync &&
    (r.stream === null || Array.isArray(r.stream))
  );
}

type Outcome = ImportOutcome | { readonly kind: 'unreadable'; readonly id: string; readonly reason: string };

function outcomeText(o: Outcome): string {
  const [run = '', side = ''] = o.id.split(':');
  switch (o.kind) {
    case 'added':
      return `Added the ${side} side of run ${run.slice(0, 8)}.`;
    case 'upgraded':
      return `Added the detailed stream for the ${side} side of run ${run.slice(0, 8)}.`;
    case 'unchanged':
      return `Already stored: the ${side} side of run ${run.slice(0, 8)}.`;
    case 'rejected':
      return `Rejected: ${o.reason}`;
    default:
      return `${o.id}: ${o.reason}.`;
  }
}

function CrossStream({ views }: { views: readonly RunView[] }) {
  const store = useStore();
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const analysable = views.filter((v) => v.left?.stream && v.right?.stream);

  const importFiles = async (files: readonly File[]) => {
    const results: Outcome[] = [];
    let known: DualRunRecord[] = [...store.getState().data.dualRuns];
    const accepted: DualRunRecord[] = [];
    for (const f of files) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await f.text());
      } catch {
        results.push({ kind: 'unreadable', id: f.name, reason: 'not JSON' });
        continue;
      }
      const envelope = parsed as { format?: unknown; record?: unknown };
      if (envelope.format !== SIDE_FILE_FORMAT || !isSideRecord(envelope.record)) {
        results.push({ kind: 'unreadable', id: f.name, reason: 'not a Typist side file' });
        continue;
      }
      let merged: ReturnType<typeof mergeImportedSide>;
      try {
        merged = mergeImportedSide(known, { ...envelope.record, savedAt: new Date().toISOString() });
      } catch {
        results.push({ kind: 'unreadable', id: f.name, reason: 'the side file is damaged' });
        continue;
      }
      results.push(merged.outcome);
      const record = merged.record;
      if (record) {
        accepted.push(record);
        known = [...known.filter((r) => r.id !== record.id), record];
      }
    }
    await store.saveDualRuns(accepted);
    setOutcomes(results);
  };

  return (
    <section className="panel panel-pad stack-sm" aria-labelledby="dual-cross">
      <h2 id="dual-cross">Cross-stream analysis</h2>
      <p className="small">
        Import the other machine's side file (exported from its run list) to compare the two streams here. Files are matched by run ID and manifest hash; reimporting is harmless, and unrelated or
        conflicting files are rejected. Importing never turns an incomplete run into a coordinated one.
      </p>
      <label htmlFor="side-files">Side files</label>
      <input id="side-files" type="file" multiple accept="application/json,.json" onChange={(e) => void importFiles(Array.from(e.target.files ?? []))} />
      {outcomes.length > 0 && (
        <ul className="small" data-testid="import-outcomes">
          {outcomes.map((o, i) => (
            <li key={`${o.id}-${i}`}>{outcomeText(o)}</li>
          ))}
        </ul>
      )}
      {analysable.map((v) => {
        const left = v.left as DualRunRecord;
        const right = v.right as DualRunRecord;
        const uncertainty = left.result.sync.uncertaintyMs + right.result.sync.uncertaintyMs;
        const candidates = substitutionCandidates(left.stream ?? [], right.stream ?? [], SUBSTITUTION_WINDOW_MS, uncertainty);
        return (
          <div key={v.runId} className="stack-sm" data-testid="cross-stream-run">
            <h3>
              Run {v.runId.slice(0, 8)} · {v.level} · {v.localDate}
            </h3>
            <p className="small">
              {candidates.length} possible substitution{candidates.length === 1 ? '' : 's'} ({candidates.filter((c) => c.ambiguous).length} ambiguous) within {SUBSTITUTION_WINDOW_MS} ms; alignment uncertainty ±
              {Math.round(uncertainty)} ms. These are candidates, not confirmed substitutions: confirm any in your notes.
            </p>
            {candidates.length > 0 && (
              <ul className="small">
                {candidates.slice(0, 12).map((c) => (
                  <li key={`${c.side}-${c.atMs}`}>
                    {(c.atMs / 1000).toFixed(2)} s · {c.side} typed “{c.produced}” where “{c.expectedHere ?? '—'}” was expected; the other side expected “{c.otherExpected}”{c.ambiguous ? ' · ambiguous' : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
