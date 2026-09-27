// Review and log (SPEC.md "Review and log"). Results show immediately; they
// are labeled saved only after the local transaction. Missing declarations
// stay pending. The log asks for little: fatigue, effort, one sentence.
import { useEffect, useMemo, useState } from 'react';
import { keyStats, recentInsertions } from '../../domain/adaptive';
import { evaluateSet } from '../../domain/evidence';
import { modeById, type ModeId } from '../../domain/modes';
import { type Declarations, EMPTY_DECLARATIONS, type SessionRecord, type TrialRecord } from '../../domain/records';
import { formatAccuracy } from '../../domain/scoring/metrics';
import { longDate } from '../../domain/time';
import { handOf, Message, Ordinal, SaveBadge } from '../components/basics';
import { DeclarationFields } from '../components/Declarations';
import { SetResult } from '../components/SetResult';
import { nextGate } from '../practice/BenchmarkSetFlow';
import { downloadText, sessionCsv } from '../runtime/exporting';
import { href } from '../router';
import { currentSetup, geometryFor, modeOverview } from '../store/derive';
import { useAppState, useStore } from '../store/react';

function blockAccuracy(trials: readonly TrialRecord[]): string | null {
  const attempts = trials.reduce((s, t) => s + t.counters.attempts, 0);
  const correct = trials.reduce((s, t) => s + t.counters.attemptsCorrect, 0);
  return formatAccuracy(correct, attempts);
}

export function SessionLog({ session, endedEarly, onSaved }: { session: SessionRecord; endedEarly: boolean; onSaved: () => void }) {
  const store = useStore();
  const state = useAppState();
  const [fatigue, setFatigue] = useState<number | null>(session.fatigueAfter);
  const [effort, setEffort] = useState<number | null>(session.effort);
  const [note, setNote] = useState(session.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const trials = state.data.trials.filter((t) => t.sessionId === session.id);
  const minutes = session.blocks.reduce((s, b) => s + b.activeMs, 0) / 60_000;
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Log and notes · {longDate(session.localDate)}</div>
          <h1 style={{ marginTop: 8 }}>{endedEarly ? 'Ending early is fine' : 'Session done'}</h1>
        </div>
        <SaveBadge state={state.save} timeZone={state.data.profile?.timeZone} />
      </div>
      <p>
        {session.blocks.filter((b) => b.status !== 'skipped').length} of {session.plannedBlocks.length} blocks · {minutes.toFixed(0)} active minutes · {trials.length} exercises recorded.
        {endedEarly ? ' Stopping never creates a penalty or catch-up debt.' : ''}
      </p>
      <Ordinal label="Fatigue after the session" value={fatigue} onChange={setFatigue} low="none" high="high" />
      {session.fatigueBefore !== null && <p className="small muted">Before the session you reported {session.fatigueBefore}.</p>}
      <Ordinal label="Effort" value={effort} onChange={setEffort} low="easy" high="maximal" />
      <div className="field-row">
        <label htmlFor="note">Note · optional, one sentence</label>
        <input id="note" type="text" value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
      </div>
      {fatigue !== null && fatigue >= 3 && <Message kind="tentative" tag="Suggestion">Fatigue 3 or more suggests a shorter session tomorrow. Stopping early costs nothing.</Message>}
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
              await store.putSession({
                ...session,
                fatigueAfter: fatigue,
                effort,
                note: note.trim() ? note.trim() : null,
                status: endedEarly ? 'ended-early' : 'completed',
                endedAt: new Date().toISOString(),
              });
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          Save the log
        </button>
        <span className="small muted">Fatigue and effort are self-ratings; they are never averaged into a score.</span>
      </div>
    </div>
  );
}

function SetDeclarationsEditor({ trials, handLabel }: { trials: readonly TrialRecord[]; handLabel: string }) {
  const store = useStore();
  const [values, setValues] = useState<Record<string, Declarations>>({});
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack-sm">
      {trials.map((t, i) => (
        <details key={t.id} open={t.declarations.glances === null}>
          <summary>Trial {i + 1} declarations</summary>
          <DeclarationFields value={values[t.id] ?? t.declarations ?? EMPTY_DECLARATIONS} onChange={(v) => setValues((x) => ({ ...x, [t.id]: v }))} handLabel={handLabel} />
        </details>
      ))}
      {error && <Message kind="error">{error}</Message>}
      <button
        type="button"
        className="btn"
        disabled={Object.keys(values).length === 0}
        onClick={async () => {
          try {
            await store.updateDeclarations(Object.entries(values).map(([trialId, declarations]) => ({ trialId, declarations })));
            setValues({});
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Save declarations
      </button>
    </div>
  );
}

export function ReviewScreen({ sessionId }: { sessionId: string }) {
  const store = useStore();
  const state = useAppState();
  const session = state.data.sessions.find((s) => s.id === sessionId);
  const trials = useMemo(() => state.data.trials.filter((t) => t.sessionId === sessionId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)), [state.data.trials, sessionId]);
  const trialsById = useMemo(() => new Map(state.data.trials.map((t) => [t.id, t])), [state.data.trials]);
  const sets = state.data.sets.filter((s) => s.sessionId === sessionId);
  const [observation, setObservation] = useState<string | null>(null);
  const setup = currentSetup(state.data.setups);

  useEffect(() => {
    let cancelled = false;
    const practice = trials.filter((t) => t.kind !== 'benchmark' && !t.eventsPruned);
    if (!store.repo || practice.length === 0) return;
    void store.repo.loadEventsFor(practice.map((t) => t.id)).then((events) => {
      if (cancelled) return;
      let best: { text: string; rate: number } | null = null;
      const modes = [...new Set(practice.map((t) => t.mode))];
      for (const mode of modes) {
        const o = modeOverview(state.data, mode, state.today, state.browserSession);
        const insertions = recentInsertions(practice.filter((t) => t.mode === mode).map((t) => ({ trialId: t.id, blockId: t.blockId, endedAt: t.endedAt ?? '', events: events.get(t.id) ?? [] })), 100, 10_000);
        const top = keyStats(insertions, 'position', o.layout, geometryFor(setup)).find((s) => s.ranked && s.errors > 0);
        if (top && top.rate !== null && (!best || top.rate > best.rate)) best = { text: `${top.key} was missed ${top.errors} of ${top.opportunities} attempts in ${mode}.`, rate: top.rate };
      }
      setObservation(best?.text ?? null);
    });
    return () => {
      cancelled = true;
    };
    // Loaded once per session view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, trials.length]);

  if (!session) {
    return (
      <Message kind="short" tag="Not found">
        That session does not exist. <a href={href('/')}>Back to Today</a>
      </Message>
    );
  }
  const timeZone = state.data.profile?.timeZone;
  return (
    <div className="stack" style={{ maxWidth: 1040 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            Session · {Math.round(session.actualMinutes)} min · {session.status}
          </div>
          <h1 style={{ marginTop: 8 }}>{longDate(session.localDate)}</h1>
        </div>
        <div className="inline-actions">
          <SaveBadge state={state.save} timeZone={timeZone} />
          <button type="button" className="btn btn-small" onClick={() => downloadText(`typist-session-${session.localDate}.csv`, sessionCsv(trials, state.data.sets), 'text/csv')}>
            Export session CSV
          </button>
        </div>
      </div>
      {observation && <Message kind="observed">{observation}</Message>}
      {sets.map((set) => {
        const evaluation = evaluateSet(set, trialsById);
        const gate = nextGate(set.mode, state.data.milestones, state.data.profile);
        const o = modeOverview(state.data, set.mode, state.today, state.browserSession);
        return (
          <section key={set.id} className="panel panel-pad stack-sm" data-hand={handOf(set.mode)}>
            <div className="inline-actions" style={{ justifyContent: 'space-between' }}>
              <h2>
                <span className="mono" style={{ color: 'var(--hand)' }}>
                  {set.mode}
                </span>{' '}
                {modeById(set.mode).layoutName} · benchmark set
              </h2>
              <span className="badge">{set.purpose}</span>
            </div>
            {set.mode === ('Q2' as ModeId) && <p className="small muted">Two-hand baseline: context only, outside the four-mode count; never QL or QR evidence.</p>}
            <SetResult evaluation={evaluation} gate={gate} milestone={o.gates[gate.kind]} timeZone={timeZone} />
            {evaluation.contributing.length > 0 && <SetDeclarationsEditor trials={evaluation.contributing} handLabel={modeById(set.mode).handLabel} />}
          </section>
        );
      })}
      <section className="panel">
        <div className="panel-head">
          <span className="eyebrow">Blocks</span>
          <span className="small muted">Practice blocks are feedback only — untimed practice is not benchmark evidence</span>
        </div>
        <ul className="rows">
          {session.blocks.map((b) => {
            const bt = b.trialIds.map((id) => trialsById.get(id)).filter((t): t is TrialRecord => !!t);
            const planned = session.plannedBlocks.find((p) => p.id === b.blockId);
            const acc = blockAccuracy(bt);
            return (
              <li key={b.blockId} className="row" data-hand={b.mode ? handOf(b.mode) : undefined}>
                <span className="mono small" style={{ color: 'var(--hand, var(--ink-2))' }}>
                  {b.mode ?? '—'}
                </span>
                <span>
                  {planned?.title ?? b.kind}
                  <span className="detail"> · {b.status}</span>
                </span>
                <span className="num">{acc === null ? 'not measured' : `${acc}%`}</span>
                <span className="minutes">{(b.activeMs / 60_000).toFixed(1)} min</span>
              </li>
            );
          })}
          {session.blocks.length === 0 && (
            <li className="row summary">
              <span>No blocks were recorded.</span>
              <span />
            </li>
          )}
        </ul>
      </section>
      <section className="panel panel-pad">
        <dl className="kv">
          <dt>Fatigue</dt>
          <dd>
            before {session.fatigueBefore ?? 'not recorded'} · after {session.fatigueAfter ?? 'not recorded'}
          </dd>
          <dt>Effort</dt>
          <dd>{session.effort ?? 'not recorded'}</dd>
          <dt>Note</dt>
          <dd>{session.note ?? '—'}</dd>
          {session.deferred.length > 0 && (
            <>
              <dt>Deferred</dt>
              <dd>{session.deferred.map((d) => `${d.what} (${d.why})`).join('; ')}</dd>
            </>
          )}
        </dl>
      </section>
      <div className="inline-actions">
        <a className="btn btn-primary" href={href('/')}>
          Plan tomorrow
        </a>
        <a className="btn" href={href('/progress')}>
          Progress
        </a>
      </div>
    </div>
  );
}
