// Setup: profile, keyboard setup revisions, calibration, mode levels and
// fingering ledgers. Every configuration edit creates a new revision; old
// trials keep rendering with the setup and ledger they were measured with.
import { useState } from 'react';
import { type Level, LEVELS, levelDefinition } from '../../domain/curriculum';
import { FINGER_LABEL, fingersAssigned, isFrozen } from '../../domain/fingering';
import { type GeometryId, GEOMETRIES, geometryById } from '../../domain/layouts/geometry';
import { LAYOUTS, type LayoutId, layoutById, QWERTY_LAYOUT_CHOICES } from '../../domain/layouts/registry';
import { ALL_MODES, CORE_MODES, modeById, type ModeId } from '../../domain/modes';
import type { Finger, KeyboardSetup, LedgerEntry } from '../../domain/records';
import { ROADMAP, stageLabel } from '../../domain/roadmap';
import { mediumDate, shortDate, weekdayName } from '../../domain/time';
import { handOf, Message, ModeLabel, NoEvidence } from '../components/basics';
import { href, navigate } from '../router';
import { calibrationState, currentLedger, currentSetup, ledgerHistory, stageInfo } from '../store/derive';
import { useAppState, useOverviews, useSetup, useStore } from '../store/react';
import { CalibrationScreen } from './CalibrationScreen';

function ProfilePanel() {
  const store = useStore();
  const state = useAppState();
  const profile = state.data.profile;
  const [error, setError] = useState<string | null>(null);
  if (!profile) return null;
  const update = (patch: Parameters<typeof store.updateProfile>[0]) => store.updateProfile(patch).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  const ui = (patch: Partial<typeof profile.ui>) => store.updateUi(patch).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <section className="panel panel-pad stack-sm" aria-labelledby="profile-title">
      <h2 id="profile-title">Profile and preferences</h2>
      <fieldset>
        <legend>Practice days</legend>
        <div className="choice-row">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} className="choice">
              <input
                type="checkbox"
                checked={profile.practiceWeekdays.includes(d)}
                onChange={(e) => {
                  const days = e.target.checked ? [...profile.practiceWeekdays, d] : profile.practiceWeekdays.filter((x) => x !== d);
                  if (days.length > 0) void update({ practiceWeekdays: [...days].sort() });
                }}
              />
              {weekdayName(d).slice(0, 3)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Daily budget</legend>
        <div className="choice-row">
          {[20, 30, 45, 60].map((m) => (
            <label key={m} className="choice">
              <input type="radio" name="budget" checked={profile.dailyMinutes === m} onChange={() => void update({ dailyMinutes: m })} />
              {m} min
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Schedule</legend>
        <div className="choice-row">
          <label className="choice">
            <input type="radio" name="style" checked={profile.planStyle === 'sequential'} onChange={() => void update({ planStyle: 'sequential' })} />
            Sequential
          </label>
          <label className="choice">
            <input type="radio" name="style" checked={profile.planStyle === 'paired-hands'} onChange={() => void update({ planStyle: 'paired-hands' })} />
            Paired hands
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Theme</legend>
        <div className="choice-row">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <label key={t} className="choice">
              <input type="radio" name="theme" checked={profile.ui.theme === t} onChange={() => void ui({ theme: t })} />
              {t === 'system' ? 'Follow the system' : t === 'light' ? 'Light' : 'Dark'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="choice-row">
        <label className="choice">
          <input type="checkbox" checked={profile.ui.showSpeed} onChange={(e) => void ui({ showSpeed: e.target.checked })} />
          Show speed during practice (accuracy always stays visible)
        </label>
        <label className="choice">
          <input type="checkbox" checked={profile.ui.fingerLayer} onChange={(e) => void ui({ fingerLayer: e.target.checked })} />
          Finger numbers on the map (from your ledger only)
        </label>
      </div>
      <div className="split">
        <div className="field-row">
          <label htmlFor="practice-scale">Practice text size</label>
          <select id="practice-scale" value={profile.ui.practiceScale} onChange={(e) => void ui({ practiceScale: Number(e.target.value) })}>
            {[0.8, 0.9, 1, 1.15, 1.3, 1.5].map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 30)} px
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="ui-scale">Interface text size</label>
          <select id="ui-scale" value={profile.ui.uiScale} onChange={(e) => void ui({ uiScale: Number(e.target.value) })}>
            {[0.9, 1, 1.15, 1.3].map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <Message kind="error">{error}</Message>}
    </section>
  );
}

function SetupPanel() {
  const store = useStore();
  const state = useAppState();
  const setup = useSetup();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<KeyboardSetup | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!setup) return null;
  const history = [...state.data.setups].filter((s) => s.setupId === setup.setupId).sort((a, b) => b.revision - a.revision);
  const d = draft ?? setup;
  return (
    <section className="panel panel-pad stack-sm" aria-labelledby="setup-title">
      <div className="inline-actions" style={{ justifyContent: 'space-between' }}>
        <h2 id="setup-title">Keyboard setup · revision {setup.revision}</h2>
        {!editing && (
          <button type="button" className="btn btn-small" onClick={() => { setDraft(setup); setEditing(true); }}>
            Edit (creates revision {setup.revision + 1})
          </button>
        )}
      </div>
      {!editing ? (
        <dl className="kv">
          <dt>Geometry</dt>
          <dd>
            {geometryById(setup.geometryId).name} {setup.geometryVerified ? '· verified by calibration' : '· not yet verified by a full calibration'}
          </dd>
          <dt>Keyboard</dt>
          <dd>{setup.keyboardLabel || <NoEvidence>not described</NoEvidence>}</dd>
          <dt>QWERTY input source</dt>
          <dd>
            {layoutById(setup.qwertyLayoutId).name} <code>{layoutById(setup.qwertyLayoutId).xkbName}</code>
          </dd>
          <dt>Modifier strategy</dt>
          <dd>{setup.modifierStrategy}{setup.modifierNotes ? ` · ${setup.modifierNotes}` : ''}</dd>
          <dt>Offsets</dt>
          <dd>
            left: {setup.keyboardOffset.left || '—'} · right: {setup.keyboardOffset.right || '—'}
          </dd>
          <dt>Remaps</dt>
          <dd>{setup.remaps || '—'}</dd>
          <dt>Chair and desk</dt>
          <dd>{setup.chairDeskNotes || '—'}</dd>
          <dt>Recorded with</dt>
          <dd>
            {setup.os} · {setup.sessionType ?? 'session type not given'} · {setup.browser}
          </dd>
        </dl>
      ) : (
        <div className="stack-sm">
          <Message kind="observed" tag="New series">
            Saving creates revision {setup.revision + 1}. New results start a new comparison series; earlier trials keep revision {setup.revision}. Layouts need calibrating again for the new
            revision.
          </Message>
          <fieldset>
            <legend>Geometry</legend>
            <div className="choice-row">
              {Object.values(GEOMETRIES).map((g) => (
                <label key={g.id} className="choice">
                  <input type="radio" name="geo" checked={d.geometryId === g.id} onChange={() => setDraft({ ...d, geometryId: g.id as GeometryId })} />
                  {g.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>QWERTY input source</legend>
            <div className="choice-row">
              {QWERTY_LAYOUT_CHOICES.map((id: LayoutId) => (
                <label key={id} className="choice">
                  <input type="radio" name="qw" checked={d.qwertyLayoutId === id} onChange={() => setDraft({ ...d, qwertyLayoutId: id })} />
                  {layoutById(id).name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="split">
            <div className="field-row">
              <label htmlFor="kbl">Keyboard</label>
              <input id="kbl" type="text" value={d.keyboardLabel} onChange={(e) => setDraft({ ...d, keyboardLabel: e.target.value })} />
            </div>
            <div className="field-row">
              <label htmlFor="mod">Modifier strategy</label>
              <select id="mod" value={d.modifierStrategy} onChange={(e) => setDraft({ ...d, modifierStrategy: e.target.value as KeyboardSetup['modifierStrategy'] })}>
                <option value="hold-shift">Hold Shift</option>
                <option value="sticky-keys">OS Sticky Keys</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="ol">Offset, left hand</label>
              <input id="ol" type="text" value={d.keyboardOffset.left} onChange={(e) => setDraft({ ...d, keyboardOffset: { ...d.keyboardOffset, left: e.target.value } })} />
            </div>
            <div className="field-row">
              <label htmlFor="or">Offset, right hand</label>
              <input id="or" type="text" value={d.keyboardOffset.right} onChange={(e) => setDraft({ ...d, keyboardOffset: { ...d.keyboardOffset, right: e.target.value } })} />
            </div>
            <div className="field-row">
              <label htmlFor="rm">Remaps</label>
              <input id="rm" type="text" value={d.remaps} onChange={(e) => setDraft({ ...d, remaps: e.target.value })} />
            </div>
            <div className="field-row">
              <label htmlFor="cd">Chair and desk</label>
              <input id="cd" type="text" value={d.chairDeskNotes} onChange={(e) => setDraft({ ...d, chairDeskNotes: e.target.value })} />
            </div>
            <div className="field-row">
              <label htmlFor="st">Desktop session</label>
              <select id="st" value={d.sessionType ?? ''} onChange={(e) => setDraft({ ...d, sessionType: e.target.value || null })}>
                <option value="">Not sure</option>
                <option value="wayland">Wayland</option>
                <option value="x11">X11</option>
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="rs">Reason for the change (optional)</label>
              <input id="rs" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {error && <Message kind="error">{error}</Message>}
          <div className="inline-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await store.reviseSetup(
                    {
                      geometryId: d.geometryId,
                      qwertyLayoutId: d.qwertyLayoutId,
                      keyboardLabel: d.keyboardLabel,
                      modifierStrategy: d.modifierStrategy,
                      keyboardOffset: d.keyboardOffset,
                      remaps: d.remaps,
                      chairDeskNotes: d.chairDeskNotes,
                      sessionType: d.sessionType,
                    },
                    reason.trim() || null,
                  );
                  setEditing(false);
                  setReason('');
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Save revision {setup.revision + 1}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {history.length > 1 && (
        <details>
          <summary>Revision history ({history.length})</summary>
          <ul className="small">
            {history.map((h) => (
              <li key={h.id}>
                Revision {h.revision} · {mediumDate(h.createdAt.slice(0, 10))} · {geometryById(h.geometryId).name} · {layoutById(h.qwertyLayoutId).xkbName}
                {h.changeReason ? ` · ${h.changeReason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CalibrationPanel() {
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const layouts: LayoutId[] = [setup?.qwertyLayoutId ?? 'qwerty-us-intl', 'dvorak-left-us', 'dvorak-right-us'];
  return (
    <section className="panel" aria-labelledby="cal-title">
      <div className="panel-head">
        <h2 id="cal-title">Layouts and calibration</h2>
        <span className="small muted">Calibration is never practice evidence</span>
      </div>
      <ul className="rows">
        {layouts.map((id) => {
          const layout = layoutById(id);
          const c = calibrationState(state.data.calibrations, setup, id, state.browserSession);
          const status =
            c.status === 'fresh' ? `Calibrated ${shortDate(c.record.completedAt.slice(0, 10))} (${c.record.kind})` : c.status === 'probe-required' ? `Short probe needed · ${c.reason}` : c.status === 'failed' ? 'Last calibration found mismatches' : c.status === 'incomplete' ? 'Incomplete (skipped or absent keys)' : 'Not calibrated for this setup';
          return (
            <li key={id} className="row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <span>
                {layout.name} <code>{layout.xkbName}</code>
                <span className="detail" style={{ display: 'block' }}>
                  <span className={`status-mark ${c.status === 'fresh' ? 'met' : c.status === 'failed' ? 'missed' : 'pending'}`} aria-hidden="true" />
                  {status} · OS input source “{layout.os.inputSourceLabel ?? layout.xkbName}”
                </span>
              </span>
              <span className="inline-actions">
                <a className="btn btn-small" href={href(`/setup/calibrate/${id}?kind=full`)}>
                  Full
                </a>
                <a className="btn btn-small" href={href(`/setup/calibrate/${id}?kind=probe`)}>
                  Probe
                </a>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="small muted panel-pad" style={{ paddingTop: 8 }}>
        Tables come from xkeyboard-config ({String((LAYOUTS['dvorak-left-us'].source as { package?: string }).package ?? 'xkb-data')}); calibration checks them against your actual OS.
      </p>
    </section>
  );
}

function ModesPanel() {
  const store = useStore();
  const state = useAppState();
  const overviews = useOverviews();
  const stage = stageInfo(state.data, overviews, state.today);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <section className="panel" aria-labelledby="modes-title">
      <div className="panel-head">
        <h2 id="modes-title">Modes and levels</h2>
        <span className="small muted">
          {stageLabel(stage.stage)}
          {stage.override ? ' (manual override)' : ''}
        </span>
      </div>
      <ul className="rows">
        {ALL_MODES.map((m) => {
          const o = overviews.get(m.id);
          if (!o) return null;
          return (
            <li key={m.id} className="row" data-hand={handOf(m.id)} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <span>
                <ModeLabel mode={m.id} />
                <span className="detail" style={{ display: 'block' }}>
                  {o.started ? `Level ${o.level} · ${levelDefinition(o.level).name}` : 'Not started'} · ledger rev {o.ledger?.revision ?? '—'} ·{' '}
                  <a href={href(`/setup/ledger/${m.id}`)}>fingering ledger</a>
                </span>
              </span>
              <span className="inline-actions">
                {!o.started && (
                  <button type="button" className="btn btn-small" onClick={() => void store.startMode(m.id).catch((e: unknown) => setError(String(e)))}>
                    Start
                  </button>
                )}
                <label className="visually-hidden" htmlFor={`lvl-${m.id}`}>
                  Level for {m.id}
                </label>
                <select
                  id={`lvl-${m.id}`}
                  value={o.level}
                  onChange={(e) => void store.setLevel(m.id, Number(e.target.value) as Level, 'manual', [], note.trim() || 'manual level change').catch((err: unknown) => setError(String(err)))}
                  style={{ width: 'auto' }}
                >
                  {LEVELS.map((l) => (
                    <option key={l.level} value={l.level}>
                      Level {l.level} · {l.name}
                    </option>
                  ))}
                </select>
                {state.data.profile?.primaryMode !== m.id && m.countsTowardCore && (
                  <button type="button" className="btn btn-small btn-quiet" onClick={() => void store.setPrimaryMode(m.id, note.trim() || 'chosen in setup').catch((e: unknown) => setError(String(e)))}>
                    Make primary
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="panel-pad stack-sm">
        <p className="small muted">Changing a level or the stage by hand is logged as a plan override. It never creates a skill milestone; benchmarks and acquisition stay evidence-based.</p>
        <div className="field-row">
          <label htmlFor="override-note">Note for overrides (optional)</label>
          <input id="override-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {stage.stage < 5 && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void store.recordPlanEvent({ kind: 'stage-advance', mode: null, from: String(stage.stage), to: String(stage.stage + 1), note: note.trim() || 'manual stage advance' }).catch((e: unknown) => setError(String(e)))}
          >
            Advance the roadmap to {stageLabel(stage.stage + 1)} (no milestone)
          </button>
        )}
        <p className="small muted">
          Roadmap: {ROADMAP.map((r) => `weeks ${r.weeks[0]}–${r.weeks[1]} ${r.primary ?? 'all four'}`).join(' · ')}.
        </p>
        {error && <Message kind="error">{error}</Message>}
      </div>
    </section>
  );
}

const FINGERS: readonly (Finger | '')[] = ['', 'thumb', 'index', 'middle', 'ring', 'little'];

function LedgerEditor({ mode }: { mode: ModeId }) {
  const store = useStore();
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const ledger = currentLedger(state.data.ledgers, mode, setup?.setupId ?? null);
  const history = ledgerHistory(state.data.ledgers, mode, setup?.setupId ?? null);
  const geometry = geometryById(setup?.geometryId ?? 'ansi-us');
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [reason, setReason] = useState('');
  const [addCode, setAddCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!ledger) return <Message kind="short">No ledger for {mode} yet; complete setup first.</Message>;
  const list = entries ?? [...ledger.entries];
  const frozen = isFrozen(ledger, state.today);
  const edit = (i: number, patch: Partial<LedgerEntry>) => {
    setSaved(false);
    setEntries(list.map((e, j) => (j === i ? { ...e, ...patch, checklist: false } : e)));
  };
  return (
    <div className="stack" data-hand={handOf(mode)}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Fingering ledger · your plan for the hand, versioned and never rewritten in place</div>
          <h1 style={{ marginTop: 8 }}>
            {mode} · revision {ledger.revision}
          </h1>
        </div>
        <a className="btn" href={href('/setup')}>
          Back to setup
        </a>
      </div>
      {frozen && (
        <Message kind="observed" tag="Freeze">
          Suggested freeze until {mediumDate(ledger.freezeUntil)}: a stable mapping makes results comparable. Editing sooner is always allowed — especially for discomfort — and creates a new
          revision instead of changing old sessions.
        </Message>
      )}
      <p className="small muted">
        {fingersAssigned(ledger)} of {geometry.keys.length} positions have a preferred finger. {modeById(mode).family === 'qwerty' ? 'One-hand full-board QWERTY has no canonical fingering; the app will not invent one.' : 'The four home positions come from the dedicated one-hand Dvorak tutor; the rest is your configuration.'}
      </p>
      <div className="table-wrap panel">
        <table className="data">
          <thead>
            <tr>
              <th>Position</th>
              <th>Zone</th>
              <th>Finger</th>
              <th>Modifier</th>
              <th>Alternative</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {list.map((e, i) => (
              <tr key={e.code}>
                <td className="mono">
                  {e.code}
                  {e.checklist && <span className="small muted"> · checklist</span>}
                </td>
                <td>
                  <select aria-label={`Zone for ${e.code}`} value={e.zoneId ?? ''} onChange={(ev) => edit(i, { zoneId: ev.target.value || null })} style={{ width: 'auto' }}>
                    <option value="">—</option>
                    {ledger.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select aria-label={`Finger for ${e.code}`} value={e.finger ?? ''} onChange={(ev) => edit(i, { finger: (ev.target.value || null) as Finger | null })} style={{ width: 'auto' }}>
                    {FINGERS.map((f) => (
                      <option key={f} value={f}>
                        {f ? FINGER_LABEL[f] : 'Unset'}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="text" aria-label={`Modifier strategy for ${e.code}`} value={e.modifierStrategy ?? ''} onChange={(ev) => edit(i, { modifierStrategy: ev.target.value || null })} />
                </td>
                <td>
                  <input type="text" aria-label={`Alternative for ${e.code}`} value={e.alternative ?? ''} onChange={(ev) => edit(i, { alternative: ev.target.value || null })} />
                </td>
                <td>
                  <input type="text" aria-label={`Note for ${e.code}`} value={e.notes} onChange={(ev) => edit(i, { notes: ev.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="inline-actions">
        <label htmlFor="add-code" className="visually-hidden">
          Add a position
        </label>
        <select id="add-code" value={addCode} onChange={(e) => setAddCode(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Add a position…</option>
          {geometry.keys
            .filter((k) => !list.some((e) => e.code === k.code))
            .map((k) => (
              <option key={k.code} value={k.code}>
                {k.code}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="btn btn-small"
          disabled={!addCode}
          onClick={() => {
            setEntries([...list, { code: addCode, zoneId: ledger.zones.find((z) => z.codes.includes(addCode))?.id ?? null, finger: null, modifierStrategy: null, alternative: null, notes: '', checklist: false }]);
            setAddCode('');
          }}
        >
          Add
        </button>
      </div>
      <div className="field-row">
        <label htmlFor="ledger-reason">Reason for this revision (optional — e.g. discomfort)</label>
        <input id="ledger-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && <Message kind="error">{error}</Message>}
      {saved && <Message kind="met" tag="Saved">Revision {ledger.revision} saved. New results start a new comparison series.</Message>}
      <div className="inline-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!entries}
          onClick={async () => {
            try {
              await store.reviseLedger(mode, { entries: list }, reason.trim() || null);
              setEntries(null);
              setReason('');
              setSaved(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Save as revision {ledger.revision + 1}
        </button>
      </div>
      <section className="panel panel-pad">
        <h2>Revisions</h2>
        <ul className="small">
          {history.map((h) => (
            <li key={h.id}>
              rev {h.revision} · effective {mediumDate(h.effectiveDate)} · frozen until {mediumDate(h.freezeUntil)}
              {h.reason ? ` · ${h.reason}` : ''}
            </li>
          ))}
        </ul>
        <p className="small muted">Zones: {ledger.zones.map((z) => `${z.name}${z.anchor ? ` (anchor ${z.anchor})` : ''}`).join(' · ') || '—'}</p>
      </section>
    </div>
  );
}

export function SetupScreen({ section, arg }: { section: string | null; arg: string | null }) {
  const setup = useSetup();
  if (section === 'calibrate' && arg) {
    const kind = new URLSearchParams(location.hash.split('?')[1] ?? '').get('kind') === 'probe' ? 'probe' : 'full';
    return <CalibrationScreen layoutId={arg as LayoutId} kind={kind} onDone={() => navigate('/setup')} />;
  }
  if (section === 'ledger' && arg && ALL_MODES.some((m) => m.id === arg)) return <LedgerEditor mode={arg as ModeId} />;
  // Expansion modes are listed in Setup only after core completion (their overviews exist then).
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Setup</div>
          <h1 style={{ marginTop: 8 }}>Your keyboard, layouts and plan</h1>
        </div>
        <div className="aside small">{setup ? `${geometryById(setup.geometryId).name} · setup revision ${setup.revision}` : ''}</div>
      </div>
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="stack">
          <SetupPanel />
          <CalibrationPanel />
        </div>
        <div className="stack">
          <ModesPanel />
          <ProfilePanel />
        </div>
      </div>
      <p className="small muted">
        Core modes: {CORE_MODES.map((m) => m.id).join(', ')}. Q2 is the two-hand baseline and never counts toward the core four.
      </p>
    </div>
  );
}
