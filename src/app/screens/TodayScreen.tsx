// Today: one primary action. The plan's block count, current block and total
// always come from the same plan data; the plan is editable before starting.
import { useEffect, useState } from 'react';
import { levelDefinition } from '../../domain/curriculum';
import { GATES } from '../../domain/evidence';
import { newId } from '../../domain/ids';
import type { MaintenanceStatus } from '../../domain/maintenance';
import { modeById, type ModeId } from '../../domain/modes';
import { type DailyPlan, removeBlock, resizeBlock } from '../../domain/planner';
import { RECORD_SCHEMA_VERSION, type SessionRecord } from '../../domain/records';
import { PROGRAM_WEEKS, programWeek, ROADMAP, stageLabel, suggestedStage } from '../../domain/roadmap';
import { longDate, shortDate } from '../../domain/time';
import { APP_VERSION, CORE_PROTOCOL_ID } from '../../domain/versions';
import { handOf, Message, ModeIdentity, NoEvidence, StatusMark } from '../components/basics';
import { fractionAccuracy, fractionWpm } from '../format';
import { useRecentEvents } from '../practice/BlockRunner';
import { href, navigate } from '../router';
import { CORE_IDS, hasMilestone, isCalibrated, type ModeOverview } from '../store/derive';
import { useToday } from '../store/plan';
import { useAppState, useOverviews, useStore } from '../store/react';

function headline(mode: ModeId): string {
  const def = modeById(mode);
  if (def.hand === 'both') return 'Today you measure both hands.';
  const layout = def.family === 'qwerty' ? '' : ' on Dvorak';
  return `Today you build the ${def.hand} hand${layout}.`;
}

function nextGateText(o: ModeOverview): { gate: string; detail: string } {
  if (o.level <= 3) return { gate: `Level ${o.level} · ${levelDefinition(o.level).name}`, detail: o.teaching?.summary ?? levelDefinition(o.level).evidence };
  const has = (k: string) => o.milestones.some((m) => m.kind === k);
  if (!has('advance')) return { gate: `Advance · ${GATES.advance.wpm} WPM at ${GATES.advance.accuracyPercent}%`, detail: 'One qualifying set, no looking' };
  if (!has('acquired')) return { gate: `Acquisition · ${GATES.acquired.wpm} WPM at ${GATES.acquired.accuracyPercent}%`, detail: `${o.gates.acquired.progress} of 3 qualifying dates` };
  if (!has('strong')) return { gate: `Strong · ${GATES.strong.wpm} WPM at ${GATES.strong.accuracyPercent}%`, detail: `${o.gates.strong.progress} of 3 qualifying dates` };
  return { gate: 'Showcase', detail: `${o.gates.showcase.progress} of 3 qualifying dates` };
}

function MaintenanceRow({ mode, status, overview }: { mode: ModeId; status: MaintenanceStatus; overview: ModeOverview }) {
  let text: string;
  let sub: string;
  let minutes = '—';
  if (status.kind === 'primary') {
    text = 'Primary mode — not maintained';
    sub = 'Practised every session this stage';
  } else if (status.kind === 'none') {
    text = overview.started ? 'Nothing to maintain yet' : 'Not started';
    sub = overview.started ? `Level ${overview.level}` : 'Begins at its roadmap stage';
  } else {
    text = status.due ? `Due today · slot ${status.doneThisWeek + 1} of ${status.slotsPerWeek} this week` : `${status.doneThisWeek} of ${status.slotsPerWeek} slots done this week`;
    sub = status.message;
    minutes = status.due ? `${status.slotMinutes} min` : '—';
  }
  return (
    <li className="row" data-hand={handOf(mode)} style={{ gridTemplateColumns: '40px minmax(0,1fr) auto' }}>
      <span className="mono" style={{ color: 'var(--hand)', fontWeight: 500 }}>
        {mode}
      </span>
      <span>
        {text}
        <span className="detail" style={{ display: 'block' }}>
          {sub}
        </span>
      </span>
      <span className="minutes">{minutes}</span>
    </li>
  );
}

function GettingStarted({ overviews }: { overviews: Map<ModeId, ModeOverview> }) {
  const state = useAppState();
  const profile = state.data.profile;
  if (!profile) return null;
  const qwerty = overviews.get('QL');
  const q2 = overviews.get('Q2' as ModeId);
  const qCalibrated = qwerty ? isCalibrated(qwerty.calibration) : false;
  const baselineDone = (q2?.evaluations.length ?? 0) > 0;
  const skipped = state.data.planEvents.some((e) => e.kind === 'plan-edit' && e.note === 'skip-q2-baseline');
  const practised = state.data.trials.some((t) => t.mode !== 'Q2' && t.status === 'completed');
  if (qCalibrated && practised) return baselineDone || skipped ? null : <BaselineOffer />;
  return <GettingStartedList qCalibrated={qCalibrated} baselineDone={baselineDone} skipped={skipped} practised={practised} primary={profile.primaryMode} calibrationStatus={qwerty?.calibration.status ?? 'none'} />;
}

function BaselineOffer() {
  const store = useStore();
  return (
    <Message kind="observed" tag="Optional">
      A two-hand QWERTY baseline (Q2) gives context for the one-hand modes. It is stored as Q2 — never QL or QR evidence — and stays outside the four-mode count.{' '}
      <a className="btn btn-small" href={href('/run/Q2/benchmark')}>
        Measure Q2
      </a>{' '}
      <button type="button" className="btn btn-small btn-quiet" onClick={() => void store.recordPlanEvent({ kind: 'plan-edit', mode: 'Q2' as ModeId, from: null, to: null, note: 'skip-q2-baseline' })}>
        Skip
      </button>
    </Message>
  );
}

function GettingStartedList({ qCalibrated, baselineDone, skipped, practised, primary, calibrationStatus }: { qCalibrated: boolean; baselineDone: boolean; skipped: boolean; practised: boolean; primary: ModeId; calibrationStatus: string }) {
  const store = useStore();
  const overviews = useOverviews();
  const layout = overviews.get('QL')?.layout;
  return (
    <section className="panel" aria-labelledby="gs-title">
      <div className="panel-head">
        <span className="eyebrow" id="gs-title">
          Getting started
        </span>
        <span className="small muted">No history yet — calibration and spatial practice come first</span>
      </div>
      <ol className="rows">
        <li className="row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
          <StatusMark mark={qCalibrated ? 'met' : 'pending'} label="" />
          <span>
            Calibrate your QWERTY input source {layout && <code>{layout.xkbName}</code>}
            <span className="detail" style={{ display: 'block' }}>
              {qCalibrated ? 'Done for this setup.' : calibrationStatus === 'probe-required' ? 'A short probe is enough after a restart.' : 'Required before QWERTY practice. It is never scored.'}
            </span>
          </span>
          {!qCalibrated && (
            <a className="btn btn-small" href={href(`/setup/calibrate/${layout?.id ?? 'qwerty-us-intl'}`)}>
              Calibrate
            </a>
          )}
        </li>
        <li className="row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
          <StatusMark mark={baselineDone ? 'met' : skipped ? 'none' : 'pending'} label="" />
          <span>
            Optional two-hand QWERTY baseline (Q2)
            <span className="detail" style={{ display: 'block' }}>
              Stored as Q2 — context only, never QL or QR evidence and outside the four-mode count.
            </span>
          </span>
          {!baselineDone && !skipped && (
            <span className="inline-actions">
              <a className="btn btn-small" href={href('/run/Q2/benchmark')} aria-disabled={!qCalibrated}>
                Measure
              </a>
              <button type="button" className="btn btn-small btn-quiet" onClick={() => void store.recordPlanEvent({ kind: 'plan-edit', mode: 'Q2' as ModeId, from: null, to: null, note: 'skip-q2-baseline' })}>
                Skip
              </button>
            </span>
          )}
        </li>
        <li className="row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
          <StatusMark mark={practised ? 'met' : 'pending'} label="" />
          <span>
            First {primary} session at level 0
            <span className="detail" style={{ display: 'block' }}>
              Find the letters, the anchors and the zones. Start today's session below.
            </span>
          </span>
          <span />
        </li>
      </ol>
    </section>
  );
}

export function TodayScreen() {
  const store = useStore();
  const state = useAppState();
  const overviews = useOverviews();
  const profile = state.data.profile;
  const primary = profile?.primaryMode ?? 'QL';
  const recent = useRecentEvents(primary);
  const model = useToday(state, overviews, recent);
  const [edited, setEdited] = useState<DailyPlan | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setEdited(null), [model?.plan.date, model?.plan.blocks.length, primary]);
  if (!profile || !model) return null;
  const plan = edited ?? model.plan;
  const o = overviews.get(primary) as ModeOverview;
  const week = programWeek(profile.startDate, state.today);
  const gate = nextGateText(o);
  const latest = o.latestSet;
  const calibrated = isCalibrated(o.calibration);
  const recommended = model.stage.recommendedPrimary;

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const blocks = plan.blocks.map((b) => ({ ...b, id: newId() }));
      const session: SessionRecord = {
        schemaVersion: RECORD_SCHEMA_VERSION,
        id: newId(),
        startedAt: now,
        endedAt: null,
        timeZone: profile?.timeZone ?? 'UTC',
        localDate: state.today,
        template: plan.template === 'rest' ? 'custom' : plan.template,
        plannedBlocks: blocks,
        plannedMinutes: blocks.reduce((s, b) => s + b.minutes, 0),
        blocks: [],
        actualMinutes: 0,
        fatigueBefore: null,
        fatigueAfter: null,
        effort: null,
        note: null,
        status: 'active',
        appVersion: APP_VERSION,
        protocolId: CORE_PROTOCOL_ID,
        deferred: plan.deferred,
      };
      await store.putSession(session);
      if (edited) await store.recordPlanEvent({ kind: 'plan-edit', mode: primary, from: String(model?.plan.totalMinutes ?? ''), to: String(plan.totalMinutes), note: 'plan edited before starting' });
      navigate(`/session/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  }

  const stageNow = model.stage.stage;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">{longDate(state.today)}</div>
          <h1 style={{ marginTop: 8 }}>{headline(primary)}</h1>
        </div>
        <div className="aside">
          <div className="eyebrow">
            Week {Math.min(week, PROGRAM_WEEKS)} of {PROGRAM_WEEKS} · {stageLabel(stageNow)}
            {model.stage.override ? ' (manual)' : ''}
          </div>
          <div className="small">
            {plan.focus} · {profile.dailyMinutes} minutes
          </div>
        </div>
      </div>

      {model.unfinished && model.unfinished.id !== model.todaysSession?.id && (
        <Message kind="pending" tag="Unfinished">
          A session from {shortDate(model.unfinished.localDate)} was not finished. Untimed blocks can continue; any interrupted benchmark needs a fresh trial.{' '}
          <a className="btn btn-small" href={href(`/session/${model.unfinished.id}`)}>
            Resume
          </a>{' '}
          <button type="button" className="btn btn-small btn-quiet" onClick={() => void store.putSession({ ...(model.unfinished as SessionRecord), status: 'ended-early', endedAt: new Date().toISOString() })}>
            Discard
          </button>
        </Message>
      )}

      <GettingStarted overviews={overviews} />

      <div className="grid-main">
        <div className="stack">
          <section className="panel panel-raised" data-hand={handOf(primary)} aria-label="Primary mode">
            <div className="panel-pad stack-sm">
              <div className="inline-actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <ModeIdentity mode={primary} />
                  <p className="muted" style={{ marginTop: 12 }}>
                    Level {o.level} · {levelDefinition(o.level).name} — {levelDefinition(o.level).exercises}.
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {model.todaysSession?.status === 'active' ? (
                    <a className="btn btn-primary btn-large" href={href(`/session/${model.todaysSession.id}`)}>
                      Continue today's session
                    </a>
                  ) : (
                    <button type="button" className="btn btn-primary btn-large" disabled={starting || !store.writable || plan.blocks.length === 0} onClick={() => void start()}>
                      Start today's session
                    </button>
                  )}
                  <div className="mono small muted" style={{ marginTop: 6 }}>
                    {plan.totalMinutes} min · {plan.blocks.length} block{plan.blocks.length === 1 ? '' : 's'}
                  </div>
                  {!store.writable && <span className="disabled-reason">This tab is read-only.</span>}
                  {plan.blocks.length === 0 && (
                    <span className="disabled-reason">
                      Not a practice day — <a href={href('/practice')}>free practice</a> is still available.
                    </span>
                  )}
                  {!calibrated && <span className="disabled-reason">{o.layout.xkbName} needs {o.calibration.status === 'probe-required' ? 'a short probe' : 'calibration'}; the session starts with it.</span>}
                </div>
              </div>
              <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '12px 0' }} />
              <div className="split">
                <div>
                  <div className="eyebrow">Next unmet gate</div>
                  <div style={{ font: 'var(--type-heading)', marginTop: 4 }}>{gate.gate}</div>
                  <div className="small muted">{gate.detail}</div>
                </div>
                <div>
                  <div className="eyebrow">Latest comparable</div>
                  {latest?.medianAccuracy ? (
                    <>
                      <div style={{ font: 'var(--type-heading)', marginTop: 4 }}>
                        {fractionAccuracy(latest.medianAccuracy)}% · {fractionWpm(latest.medianWpm)} WPM
                      </div>
                      <div className="small muted">{shortDate(latest.localDate)} · benchmark set</div>
                    </>
                  ) : (
                    <div style={{ marginTop: 4 }}>
                      <NoEvidence>No evidence yet</NoEvidence>
                      <div className="small muted">Benchmarks begin at level 4</div>
                    </div>
                  )}
                </div>
              </div>
              {recommended !== primary && (
                <Message kind="observed" tag="Roadmap">
                  The evidence suggests {recommended} as the primary mode now.{' '}
                  <button type="button" className="btn btn-small" onClick={() => void store.setPrimaryMode(recommended, 'roadmap stage change')}>
                    Switch to {recommended}
                  </button>
                </Message>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="plan-title">
            <div className="panel-head">
              <span>
                <span className="eyebrow" id="plan-title">
                  Session plan
                </span>{' '}
                <span className="small muted">Editable before you start</span>
              </span>
              {edited && (
                <button type="button" className="btn btn-small" onClick={() => setEdited(null)}>
                  Reset plan
                </button>
              )}
            </div>
            <ul className="rows">
              {plan.blocks.map((b) => (
                <li key={b.id} className={`row${b.kind === 'maintenance' ? ' current' : ''}`}>
                  <span className="bullet" aria-hidden="true" />
                  <span>
                    {b.title} {b.detail && <span className="detail">· {b.detail}</span>}
                  </span>
                  <span className="mono small" data-hand={b.mode ? handOf(b.mode) : undefined} style={{ color: 'var(--hand, var(--ink-2))' }}>
                    {b.mode ?? '—'}
                  </span>
                  <span className="inline-actions" style={{ justifyContent: 'flex-end' }}>
                    {b.kind !== 'log' && b.kind !== 'benchmark' && (
                      <>
                        <button type="button" className="btn btn-small btn-quiet" aria-label={`Shorten ${b.title} by one minute`} onClick={() => setEdited(resizeBlock(plan, b.id, b.minutes - 1))} disabled={b.minutes <= 1}>
                          −
                        </button>
                        <button type="button" className="btn btn-small btn-quiet" aria-label={`Lengthen ${b.title} by one minute`} onClick={() => setEdited(resizeBlock(plan, b.id, b.minutes + 1))} disabled={plan.totalMinutes >= plan.budget}>
                          +
                        </button>
                      </>
                    )}
                    <span className="minutes">{b.minutes} min</span>
                    {b.kind !== 'log' && (
                      <button type="button" className="btn btn-small btn-quiet" aria-label={`Remove ${b.title}`} onClick={() => setEdited(removeBlock(plan, b.id))}>
                        ×
                      </button>
                    )}
                  </span>
                </li>
              ))}
              <li className="row summary">
                <span>{plan.notes[0] ?? (plan.blocks.length > 0 ? 'Warm-up and logging are reserved first; nothing is added beyond the budget.' : '')}</span>
                <span className="minutes">{plan.totalMinutes} min</span>
              </li>
            </ul>
            {plan.deferred.length > 0 && (
              <div className="panel-pad" style={{ paddingTop: 12 }}>
                <div className="eyebrow">Deferred, and why</div>
                <ul className="small">
                  {plan.deferred.map((d) => (
                    <li key={d.what}>
                      {d.what}: {d.why}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.notes.slice(1).map((n) => (
              <p key={n} className="small muted panel-pad" style={{ paddingTop: 0 }}>
                {n}
              </p>
            ))}
          </section>
          {error && <Message kind="error">{error}</Message>}
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="maint-title">
            <div className="panel-head">
              <span className="eyebrow" id="maint-title">
                Maintenance
              </span>
              <span className="small muted">Inside today's budget</span>
            </div>
            <ul className="rows">
              {CORE_IDS.map((m) => (
                <MaintenanceRow key={m} mode={m} status={model.maintenance.get(m) as MaintenanceStatus} overview={overviews.get(m) as ModeOverview} />
              ))}
            </ul>
          </section>

          <section className="panel panel-pad stack-sm" aria-labelledby="timeline-title">
            <div className="inline-actions" style={{ justifyContent: 'space-between' }}>
              <span className="eyebrow" id="timeline-title">
                Suggested timeline
              </span>
              <span className="small muted">a forecast, not a deadline</span>
            </div>
            <div className="timeline">
              {ROADMAP.map((s) => {
                const here = s.stage === Math.min(stageNow, 5);
                const done = s.stage < stageNow;
                return (
                  <div key={s.stage} data-hand={s.primary ? handOf(s.primary) : undefined}>
                    <div className={`seg${here ? ' here' : done ? ' done' : ''}`} aria-hidden="true">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} />
                      ))}
                    </div>
                    <div className="cap">
                      {s.weeks[0]}–{s.weeks[1]} {s.primary ?? 'all'}
                      {here ? ' · here' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="small muted">
              The calendar suggests stage {suggestedStage(week)}; the evidence puts you at {stageLabel(stageNow)}. Stages end when their gate is met, not when the calendar says so. Missed
              days move the plan forward rather than doubling up.
            </p>
          </section>

          <section className="panel panel-pad stack-sm" aria-labelledby="last-title">
            <span className="eyebrow" id="last-title">
              Last session{model.lastSession ? ` · ${shortDate(model.lastSession.localDate)}` : ''}
            </span>
            {model.lastSession ? (
              <p className="small">
                {Math.round(model.lastSession.actualMinutes)} minutes, {model.lastSession.blocks.length} blocks. Effort {model.lastSession.effort ?? 'not recorded'}, fatigue after{' '}
                {model.lastSession.fatigueAfter ?? 'not recorded'}.{' '}
                <a href={href(`/review/${model.lastSession.id}`)}>Review</a>
              </p>
            ) : (
              <p className="small">
                <NoEvidence>No sessions yet</NoEvidence>
              </p>
            )}
            {CORE_IDS.filter((m) => hasMilestone(state.data.milestones, m, 'acquired')).length > 0 && (
              <a className="small" href={href('/progress/monthly')}>
                Monthly fixed passage
              </a>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
