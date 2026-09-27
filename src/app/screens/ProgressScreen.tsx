// Progress (SPEC.md "Progress"). Historical achievement stays separate from
// current performance; nothing unmeasured is shown as zero; a combined average
// across modes is deliberately not offered.
import { useEffect, useMemo, useState } from 'react';
import { keyStats, recentInsertions, slowBigrams, intrusionCandidates, type TrialEvents } from '../../domain/adaptive';
import { levelDefinition } from '../../domain/curriculum';
import { checkCoreCompletion, GATES, qualify, type SetEvaluation } from '../../domain/evidence';
import { LAYOUTS } from '../../domain/layouts/registry';
import { acquisitionBaseline, retentionChecks } from '../../domain/maintenance';
import { CORE_MODES, modeById, type ModeId } from '../../domain/modes';
import type { MilestoneRecord, TrialRecord } from '../../domain/records';
import { signatureDifferences, signatureFieldLabel } from '../../domain/signature';
import { PAIR_KIND_LABEL, pairKind, switchMatrix } from '../../domain/switching';
import { mediumDate, monthName, monthOf, shortDate } from '../../domain/time';
import { handOf, Message, ModeIdentity, NoEvidence, StatusMark } from '../components/basics';
import { LineChart } from '../components/Chart';
import { accuracyOf, fractionAccuracy, fractionWpm, glancesLabel, percent, seconds, wpmOf } from '../format';
import { downloadText, trialsCsv } from '../runtime/exporting';
import { href } from '../router';
import { CORE_IDS, currentSetup, geometryFor, hasMilestone, maintenanceFor, type ModeOverview } from '../store/derive';
import { useAppState, useOverviews, useStore } from '../store/react';

function milestoneLine(milestones: readonly MilestoneRecord[]): { mark: 'met' | 'pending' | 'none'; text: string } {
  const find = (k: string) => milestones.find((m) => m.kind === k);
  const showcase = find('showcase');
  const strong = find('strong');
  const acquired = find('acquired');
  const advance = find('advance');
  if (showcase) return { mark: 'met', text: `Showcase · ${shortDate(showcase.awardedLocalDate)}` };
  if (strong) return { mark: 'met', text: `Strong · ${shortDate(strong.awardedLocalDate)}` };
  if (acquired) return { mark: 'met', text: `Acquired · ${shortDate(acquired.awardedLocalDate)}` };
  if (advance) return { mark: 'met', text: `Advanced · ${shortDate(advance.awardedLocalDate)}` };
  return { mark: 'none', text: 'No milestone yet' };
}

function ModeCard({ o }: { o: ModeOverview }) {
  const state = useAppState();
  const primary = state.data.profile?.primaryMode ?? 'QL';
  const m = milestoneLine(o.milestones);
  const maintenance = maintenanceFor(state.data, o, primary, state.today);
  const latest = o.latestSet;
  const acquired = hasMilestone(o.milestones, o.mode, 'acquired');
  const latestTrial = latest?.contributing.at(-1);
  return (
    <article className="mode-card" data-hand={handOf(o.mode)} aria-labelledby={`card-${o.mode}`}>
      <div className="inline-actions" style={{ justifyContent: 'space-between' }}>
        <span id={`card-${o.mode}`} className="mode-mark">
          {o.mode}
        </span>
        <StatusMark mark={m.mark} label={m.text} />
      </div>
      <p className="small muted">
        {modeById(o.mode).layoutName} · {modeById(o.mode).handLabel}
      </p>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Latest accuracy</dt>
        <dd>{latest?.medianAccuracy ? <strong>{fractionAccuracy(latest.medianAccuracy)}%</strong> : <NoEvidence>No evidence{o.started ? '' : ' · not started'}</NoEvidence>}</dd>
        <dt>Median WPM</dt>
        <dd>{latest?.medianWpm ? fractionWpm(latest.medianWpm) : <NoEvidence />}</dd>
        <dt>Level</dt>
        <dd>{o.started ? `${o.level} · ${levelDefinition(o.level).name}${state.data.profile?.primaryMode === o.mode ? ' · primary' : ''}` : '—'}</dd>
        <dt>{acquired ? 'Stability' : 'Next gate'}</dt>
        <dd>
          {acquired
            ? o.stability.status === 'stable'
              ? `Current · ${o.stability.ageDays} days old`
              : o.stability.reasons[0]?.message ?? 'Needs a current set'
            : o.milestones.some((x) => x.kind === 'advance')
              ? `Acquisition ${o.gates.acquired.progress} of 3 qualifying dates${o.gates.acquired.pending ? ' · pending declaration' : ''}`
              : o.level >= 4
                ? `Advance at ${GATES.advance.wpm} / ${GATES.advance.accuracyPercent}%${o.gates.advance.latest ? ` · latest ${o.gates.advance.latest.result.status}` : ''}`
                : `Level ${o.level} → ${o.level + 1}: ${o.teaching?.summary ?? ''}`}
        </dd>
        <dt>Evidence</dt>
        <dd>{latest ? `${mediumDate(latest.localDate)} · ${glancesLabel(latestTrial?.declarations.glances ?? null)} glances · ${latest.contributing.some((t) => t.assistance.shown.some((s) => s !== 'none')) ? 'map shown' : 'no map'}` : <NoEvidence>never measured</NoEvidence>}</dd>
        <dt>Setup</dt>
        <dd>{o.calibration.status === 'fresh' ? `calibrated · ledger rev ${o.ledger?.revision ?? '—'}` : `${o.layout.xkbName}: ${o.calibration.status === 'none' ? 'not calibrated' : o.calibration.status.replace('-', ' ')}`}</dd>
        <dt>Maintenance</dt>
        <dd>{maintenance.kind === 'none' ? 'Nothing to maintain' : maintenance.kind === 'primary' ? 'Not applicable while primary' : `${maintenance.slotsPerWeek} slot${maintenance.slotsPerWeek === 1 ? '' : 's'} weekly · ${maintenance.due ? 'due now' : 'up to date'}`}</dd>
      </dl>
      <a className="btn btn-small" href={href(`/progress/${o.mode}`)} style={{ marginTop: 12 }}>
        {o.mode} detail
      </a>
    </article>
  );
}

function Overview() {
  const state = useAppState();
  const overviews = useOverviews();
  const evaluations = new Map(CORE_IDS.map((m) => [m, overviews.get(m)?.evaluations ?? []]));
  const acquired = new Set(CORE_IDS.filter((m) => hasMilestone(state.data.milestones, m, 'acquired')));
  const core = state.data.core[0];
  const check = checkCoreCompletion(CORE_IDS, acquired, evaluations, state.today);
  return (
    <div className="stack">
      <div className="mode-cards">
        {CORE_MODES.map((m) => (
          <ModeCard key={m.id} o={overviews.get(m.id) as ModeOverview} />
        ))}
      </div>
      <section className="panel panel-pad stack-sm" aria-labelledby="core-title">
        <h2 id="core-title">Core completion</h2>
        {core ? (
          <Message kind="met" tag="Completed">
            Core completion recorded on {mediumDate(core.awardedLocalDate)}, from four acquisition milestones and current sets within 14 days. A later decline triggers maintenance; it never
            erases this or re-locks the expansion area.
          </Message>
        ) : (
          <>
            <ul className="rows">
              {CORE_IDS.map((m) => {
                const pm = check.perMode[m];
                return (
                  <li key={m} className="row" data-hand={handOf(m)} style={{ gridTemplateColumns: '40px minmax(0,1fr)' }}>
                    <span className="mono" style={{ color: 'var(--hand)' }}>
                      {m}
                    </span>
                    <span>
                      <StatusMark mark={pm?.acquired ? (pm.stability.status === 'stable' ? 'met' : 'pending') : 'none'} label={pm?.acquired ? (pm.stability.status === 'stable' ? 'Acquired and currently stable' : 'Acquired · needs a current passing set') : `${overviews.get(m)?.gates.acquired.progress ?? 0} of 3 qualifying dates`} />
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="small muted">Colemak, Workman and the two-machine module unlock after core completion. A combined average across modes is deliberately not offered: it would conceal the unacquired one.</p>
          </>
        )}
      </section>
    </div>
  );
}

function Switching() {
  const state = useAppState();
  const matrix = switchMatrix(state.data.probes, CORE_IDS);
  return (
    <div className="stack">
      <p>Direction matters: median successful latency · successes of attempts · timeouts. A timeout is a 30-second lower bound, never a 30-second success.</p>
      <div className="table-wrap panel">
        <table className="data">
          <caption className="visually-hidden">Directional switching matrix</caption>
          <thead>
            <tr>
              <th>From ↓ To →</th>
              {CORE_IDS.map((m) => (
                <th key={m}>→ {m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CORE_IDS.map((from) => (
              <tr key={from}>
                <th scope="row">{from} →</th>
                {CORE_IDS.map((to) => {
                  if (from === to) return <td key={to}>—</td>;
                  const s = matrix.find((x) => x.from === from && x.to === to);
                  if (!s || s.attempts === 0) return <td key={to}><NoEvidence>Not measured</NoEvidence></td>;
                  return (
                    <td key={to}>
                      <strong>{s.medianMs === null ? 'no success' : seconds(s.medianMs)}</strong>
                      {s.preliminary && s.successes > 0 ? ' preliminary' : ''}
                      <div className="small muted">
                        {s.successes}/{s.attempts}
                        {s.timeouts ? ` · ${s.timeouts} timeout${s.timeouts === 1 ? '' : 's'}` : ''}
                        {s.interruptions ? ` · ${s.interruptions} interrupted` : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {PAIR_KIND_LABEL[pairKind('QL', 'QR')]}: QL → QR · {PAIR_KIND_LABEL[pairKind('QL', 'DL')]}: QL → DL · {PAIR_KIND_LABEL[pairKind('DL', 'DR')]}: DL → DR. Fewer than five successes is marked
        preliminary; an untested pair is never folded into an aggregate.
      </p>
    </div>
  );
}

function Monthly() {
  const state = useAppState();
  const monthly = state.data.trials.filter((t) => t.protocolId === 'monthly-fixed-passage-60-v1' && t.status !== 'running');
  const months = [...new Set([...monthly.map((t) => monthOf(t.localDate)), monthOf(state.today)])].sort().reverse();
  const acquired = CORE_IDS.filter((m) => hasMilestone(state.data.milestones, m, 'acquired'));
  return (
    <div className="stack">
      <p>
        The same fixed passage, once a month, in each acquired mode. It can be spread over several days (dates shown). Missing modes are recorded as missing and never extrapolated. This protocol
        does not feed the rotating-corpus acquisition gate.
      </p>
      <div className="table-wrap panel">
        <table className="data">
          <thead>
            <tr>
              <th>Month</th>
              {CORE_IDS.map((m) => (
                <th key={m}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month}>
                <th scope="row">{monthName(month)}</th>
                {CORE_IDS.map((m) => {
                  const t = monthly.filter((x) => x.mode === m && monthOf(x.localDate) === month && x.status === 'completed').sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
                  if (!t) return <td key={m}>{acquired.includes(m) ? <NoEvidence>Missing</NoEvidence> : <span className="muted small">not acquired</span>}</td>;
                  return (
                    <td key={m}>
                      <strong>{accuracyOf(t)}%</strong> · {wpmOf(t)} WPM
                      <div className="small muted">
                        {shortDate(t.localDate)} · offset {m.endsWith('L') ? t.setup.keyboardOffset.left || '—' : t.setup.keyboardOffset.right || '—'}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        {acquired.length === 0 ? 'No mode is acquired yet; the monthly comparison starts with the first acquisition.' : acquired.map((m) => <a key={m} className="btn btn-small" href={href(`/run/${m}/monthly`)} style={{ marginRight: 8 }}>Run {m}</a>)}
      </p>
    </div>
  );
}

function seriesOf(evaluations: readonly SetEvaluation[]): { hash: string; sets: SetEvaluation[] }[] {
  const map = new Map<string, SetEvaluation[]>();
  for (const e of evaluations.filter((x) => x.complete)) {
    const list = map.get(e.signatureHash) ?? [];
    list.push(e);
    map.set(e.signatureHash, list);
  }
  return [...map.entries()]
    .map(([hash, sets]) => ({ hash, sets: sets.sort((a, b) => (a.localDate === b.localDate ? a.createdAt.localeCompare(b.createdAt) : a.localDate.localeCompare(b.localDate))) }))
    .sort((a, b) => (b.sets.at(-1)?.localDate ?? '').localeCompare(a.sets.at(-1)?.localDate ?? ''));
}

function seriesLabel(sets: readonly SetEvaluation[]): string {
  const t = sets[0]?.contributing[0];
  if (!t) return 'series';
  return `${t.protocolId} · ${t.signature.layout.replace('@1', '')} · ${t.signature.geometry.replace('@1', '')} · setup rev ${t.setup.setupRevision} · ledger rev ${t.ledgerRevision ?? '—'} · ${t.inputPath}`;
}

function SeriesPanel({ series, mode, view }: { series: { hash: string; sets: SetEvaluation[] }; mode: ModeId; view: 'chart' | 'table' }) {
  const acc = series.sets.map((s) => ({ label: shortDate(s.localDate), value: s.medianAccuracy?.toNumber() ?? 0 }));
  const wpm = series.sets.map((s) => ({ label: shortDate(s.localDate), value: s.medianWpm?.toNumber() ?? 0 }));
  const maxWpm = Math.max(35, ...wpm.map((p) => Math.ceil(p.value / 5) * 5));
  const hand = handOf(mode);
  return (
    <div className="stack-sm">
      <p className="small mono muted">{seriesLabel(series.sets)}</p>
      {view === 'chart' ? (
        <>
          <div className="eyebrow">Median attempt accuracy · accuracy is charted first and taller</div>
          <LineChart points={acc} min={90} max={100} gate={98} height={200} title={`${mode} median accuracy`} unit="%" hand={hand} />
          <div className="eyebrow">Median WPM</div>
          <LineChart points={wpm} min={0} max={maxWpm} gate={30} height={150} title={`${mode} median WPM`} unit="WPM" hand={hand} />
        </>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Accuracy</th>
                <th className="num">WPM</th>
                <th className="num">Raw</th>
                <th>Glances</th>
                <th>Qualifies at 30 / 98</th>
              </tr>
            </thead>
            <tbody>
              {[...series.sets].reverse().map((s) => {
                const r = qualify(s, GATES.acquired);
                return (
                  <tr key={s.set.id}>
                    <td>{shortDate(s.localDate)}</td>
                    <td className="num">{fractionAccuracy(s.medianAccuracy)}</td>
                    <td className="num">{fractionWpm(s.medianWpm)}</td>
                    <td className="num">{fractionWpm(s.medianRawWpm)}</td>
                    <td>{s.contributing.map((t) => glancesLabel(t.declarations.glances)).join(' / ')}</td>
                    <td>{r.status === 'pass' ? 'Yes' : r.status === 'pending' ? 'Pending declaration' : `No · ${r.reasons[0]?.code === 'joint' ? `${r.jointPasses} of 3 trials passed both` : (r.reasons[0]?.code ?? '')}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ModeDetail({ mode }: { mode: ModeId }) {
  const store = useStore();
  const state = useAppState();
  const overviews = useOverviews();
  const o = overviews.get(mode) as ModeOverview;
  const setup = currentSetup(state.data.setups);
  const geometry = geometryFor(setup);
  const [tab, setTab] = useState<'trends' | 'errors' | 'assistance' | 'history'>('trends');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const series = useMemo(() => seriesOf(o.evaluations), [o.evaluations]);
  const [selected, setSelected] = useState(0);
  const [compare, setCompare] = useState<number | null>(null);
  const [events, setEvents] = useState<TrialEvents[] | null>(null);
  const acquired = hasMilestone(o.milestones, mode, 'acquired');
  const baseline = acquired ? acquisitionBaseline(acquired, o.evaluations) : null;
  const practice = o.trials
    .filter((t) => t.status !== 'running')
    .map((t) => ({ localDate: t.localDate, at: t.startedAt, setId: t.benchmarkSetId }))
    .reduce<{ localDate: string; at: string; setId: string | null }[]>((acc, p) => (acc.some((x) => x.localDate === p.localDate) ? acc : [...acc, p]), []);
  const retention = acquired ? retentionChecks(acquired, baseline, o.evaluations, practice) : [];

  useEffect(() => {
    if (tab !== 'errors' || events || !store.repo) return;
    const trials = o.trials.filter((t) => !t.eventsPruned && t.counters.attempts > 0).sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '')).slice(0, 40);
    void store.repo.loadEventsFor(trials.map((t) => t.id)).then((map) => setEvents(trials.map((t) => ({ trialId: t.id, blockId: t.blockId, endedAt: t.endedAt ?? '', events: map.get(t.id) ?? [] }))));
  }, [tab, events, store.repo, o.trials]);

  const insertions = events ? recentInsertions(events, 1000, 5000) : [];
  const byPosition = events ? keyStats(insertions, 'position', o.layout, geometry).slice(0, 12) : [];
  const bigrams = events ? slowBigrams(events).slice(0, 8) : [];
  const others = Object.values(LAYOUTS).filter((l) => l.id !== o.layout.id);
  const intrusions = events ? intrusionCandidates(insertions, o.layout, others, geometry) : [];
  const setupChanges = [...new Set(o.trials.map((t) => t.signatureHash))];
  const recentSets = [...o.evaluations].filter((e) => e.complete).slice(-10);

  return (
    <div className="stack" data-hand={handOf(mode)}>
      <div className="page-head">
        <div>
          <a className="small" href={href('/progress')}>
            ← Progress
          </a>
          <div style={{ marginTop: 8 }}>
            <ModeIdentity mode={mode} />
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            {milestoneLine(o.milestones).text} · level {o.level} · acquisition {o.gates.acquired.progress} of 3
          </p>
        </div>
        <button type="button" className="btn btn-small" onClick={() => downloadText(`typist-${mode}-trials.csv`, trialsCsv(o.trials, state.data.sessions), 'text/csv')}>
          Export {mode} CSV
        </button>
      </div>
      <div className="tabs" role="tablist">
        {(['trends', 'errors', 'assistance', 'history'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'trends' ? 'Trends' : t === 'errors' ? 'Errors' : t === 'assistance' ? 'Assistance' : 'Setup and ledger'}
          </button>
        ))}
      </div>

      {tab === 'trends' && (
        <div className="stack">
          {series.length === 0 ? (
            <Message kind="pending" tag="No evidence">
              No benchmark sets for {mode} yet. Nothing here counts as a zero.
            </Message>
          ) : (
            <>
              <div className="inline-actions">
                <label htmlFor="series" className="small">
                  Series
                </label>
                <select id="series" value={selected} onChange={(e) => setSelected(Number(e.target.value))} style={{ width: 'auto', maxWidth: 520 }}>
                  {series.map((s, i) => (
                    <option key={s.hash} value={i}>
                      {i === 0 ? 'Current · ' : ''}
                      {s.sets.length} sets · {seriesLabel(s.sets)}
                    </option>
                  ))}
                </select>
                {series.length > 1 && (
                  <>
                    <label htmlFor="compare" className="small">
                      Compare with
                    </label>
                    <select id="compare" value={compare ?? ''} onChange={(e) => setCompare(e.target.value === '' ? null : Number(e.target.value))} style={{ width: 'auto', maxWidth: 360 }}>
                      <option value="">—</option>
                      {series.map((s, i) => (i === selected ? null : <option key={s.hash} value={i}>{seriesLabel(s.sets)}</option>))}
                    </select>
                  </>
                )}
                <span style={{ marginLeft: 'auto' }} className="segmented" role="radiogroup" aria-label="Chart or table">
                  {(['chart', 'table'] as const).map((v) => (
                    <label key={v}>
                      <input type="radio" name="view" checked={view === v} onChange={() => setView(v)} />
                      <span>{v === 'chart' ? 'Chart' : 'Table'}</span>
                    </label>
                  ))}
                </span>
              </div>
              <div className={compare !== null ? 'split' : undefined}>
                {series[selected] && <SeriesPanel series={series[selected]} mode={mode} view={view} />}
                {compare !== null && series[compare] && <SeriesPanel series={series[compare]} mode={mode} view={view} />}
              </div>
              {compare !== null && series[compare] && series[selected] && (
                <p className="small muted">
                  These series differ in:{' '}
                  {signatureDifferences(series[selected].sets[0]?.contributing[0]?.signature ?? ({} as never), series[compare].sets[0]?.contributing[0]?.signature ?? ({} as never))
                    .map(signatureFieldLabel)
                    .join(', ')}
                  . They are shown side by side and never averaged together.
                </p>
              )}
            </>
          )}
          <section className="panel panel-pad">
            <dl className="kv">
              <dt>Acquisition baseline</dt>
              <dd>{baseline ? `${baseline.value.format(1)} WPM (mean of the three acquisition sets)` : acquired ? 'Unavailable for this series' : 'Set when acquired — not yet established'}</dd>
              <dt>Retention check</dt>
              <dd>
                {retention.length === 0
                  ? acquired
                    ? 'No 7-day break yet in this mode'
                    : 'After acquisition'
                  : retention.map((r) => `${shortDate(r.set.localDate)}: ${r.status} (${r.breakDays}-day break, loss ${percent(r.loss) ?? '—'}%, accuracy ${fractionAccuracy(r.accuracy) ?? '—'}%)`).join(' · ')}
              </dd>
              <dt>Current stability</dt>
              <dd>
                {!acquired
                  ? 'Checked after acquisition'
                  : o.stability.status === 'stable'
                    ? `Current (latest set ${o.stability.ageDays} days old)`
                    : o.stability.status === 'no-evidence'
                      ? 'No evidence'
                      : o.stability.reasons.map((r) => r.message).join(' ') || 'Not stable'}
              </dd>
            </dl>
          </section>
        </div>
      )}

      {tab === 'errors' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <section className="panel panel-pad stack-sm">
            <h2>Recurring errors by position</h2>
            {!events ? (
              <p className="muted">Loading recent keystrokes…</p>
            ) : byPosition.length === 0 ? (
              <NoEvidence>No practice keystrokes yet</NoEvidence>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Expected</th>
                    <th className="num">Missed</th>
                    <th className="num">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byPosition.map((s) => (
                    <tr key={s.key}>
                      <td className="mono">{s.key}</td>
                      <td className="mono">{(s.chars ?? []).join(' ')}</td>
                      <td className="num">
                        {s.errors} / {s.opportunities}
                      </td>
                      <td className="num">{s.rate === null ? 'not ranked' : `${(s.rate * 100).toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small muted">A position needs 20 opportunities before it is ranked. KeyF is a position, not the letter it happens to produce.</p>
          </section>
          <section className="panel panel-pad stack-sm">
            <h2>Slow bigrams</h2>
            {bigrams.length === 0 ? (
              <NoEvidence>Not enough samples yet</NoEvidence>
            ) : (
              <ul>
                {bigrams.map((b) => (
                  <li key={b.bigram}>
                    <code>{b.bigram.replace(/ /g, '␣')}</code> {Math.round(b.medianMs)} ms between correct insertions · {b.samples} samples
                  </li>
                ))}
              </ul>
            )}
            <p className="small muted">Pauses and switch preparation are excluded; ten samples is the minimum before a suggestion appears.</p>
            {intrusions.length > 0 && (
              <Message kind="tentative">
                {intrusions.length} wrong character{intrusions.length === 1 ? ' was' : 's were'} typed exactly where another layout you practise puts the expected letter (
                {[...new Set(intrusions.map((i) => i.candidateLayout))].join(', ')}). This may be layout interference; it is not a certainty
                {intrusions.some((i) => i.alternatives.length > 0) ? ', and some also fit an adjacent-key slip' : ''}. No finger or hand can be inferred from key events.
              </Message>
            )}
          </section>
        </div>
      )}

      {tab === 'assistance' && (
        <section className="panel panel-pad stack-sm">
          <h2>Assistance and declarations</h2>
          <ul>
            <li>{recentSets.filter((s) => s.contributing.every((t) => t.assistance.shown.every((a) => a === 'none') && !t.assistance.revealed)).length} of the last {recentSets.length} sets · no keymap</li>
            <li>{recentSets.filter((s) => s.contributing.some((t) => t.assistance.shown.some((a) => a !== 'none') || t.assistance.revealed)).length} sets · map shown, recorded automatically</li>
            <li>{recentSets.filter((s) => s.contributing.some((t) => t.declarations.glances === null || t.declarations.glances.kind === 'unknown')).length} sets · glance count unknown or pending</li>
          </ul>
          <FatigueSummary trials={o.trials} />
        </section>
      )}

      {tab === 'history' && (
        <section className="panel panel-pad stack-sm">
          <h2>Setup and ledger</h2>
          <p>
            {setupChanges.length} comparison series recorded for {mode}. A new keyboard, setup or ledger revision starts a new series; old milestones are preserved.
          </p>
          <p>
            Current ledger: revision {o.ledger?.revision ?? '—'} · <a href={href(`/setup/ledger/${mode}`)}>open ledger</a>
          </p>
          <ul className="small">
            {o.milestones.map((m) => (
              <li key={m.id}>
                {m.kind} · {mediumDate(m.awardedLocalDate)} · {m.protocolId} · sets {m.setIds.length} · target {m.target.wpm} WPM / {m.target.accuracyPercent}% · {m.gateRules}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FatigueSummary({ trials }: { trials: readonly TrialRecord[] }) {
  const state = useAppState();
  const sessionIds = new Set(trials.map((t) => t.sessionId));
  const sessions = state.data.sessions.filter((s) => sessionIds.has(s.id));
  const fatigue = sessions.map((s) => s.fatigueAfter).filter((f): f is number => f !== null);
  const effort = sessions.map((s) => s.effort).filter((f): f is number => f !== null);
  if (fatigue.length === 0 && effort.length === 0) return <p className="small muted">No fatigue or effort logged yet.</p>;
  const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : 'not recorded');
  const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  return (
    <p className="small">
      Fatigue after {range(fatigue)} across {fatigue.length} sessions · effort median {med(effort) ?? 'not recorded'}. These are self-ratings, never averaged into a health score.
    </p>
  );
}

export function ProgressScreen({ section }: { section: string | null }) {
  const state = useAppState();
  const overviews = useOverviews();
  const mode = section && overviews.has(section as ModeId) ? (section as ModeId) : null;
  if (mode) return <ModeDetail mode={mode} />;
  const tab = section === 'switching' ? 'switching' : section === 'monthly' ? 'monthly' : 'overview';
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            protocol typist-core-v1 · {state.data.sessions.length} sessions · {state.data.trials.length} trials
          </div>
          <h1 style={{ marginTop: 8 }}>Four modes, measured separately</h1>
        </div>
        <button type="button" className="btn btn-small" onClick={() => downloadText('typist-trials.csv', trialsCsv(state.data.trials, state.data.sessions), 'text/csv')}>
          Export CSV
        </button>
      </div>
      <nav className="tabs" aria-label="Progress views">
        <a href={href('/progress')} aria-current={tab === 'overview' ? 'page' : undefined}>
          Overview
        </a>
        <a href={href('/progress/switching')} aria-current={tab === 'switching' ? 'page' : undefined}>
          Switching
        </a>
        <a href={href('/progress/monthly')} aria-current={tab === 'monthly' ? 'page' : undefined}>
          Monthly
        </a>
      </nav>
      {tab === 'overview' && <Overview />}
      {tab === 'switching' && <Switching />}
      {tab === 'monthly' && <Monthly />}
    </div>
  );
}
