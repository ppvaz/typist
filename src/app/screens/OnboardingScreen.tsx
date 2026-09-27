// First use (SPEC.md, "First use"): profile, the four modes, the keyboard
// setup, and the primary mode. Calibration, the optional two-hand baseline and
// level 0 follow from Today's getting-started list.
import { useState } from 'react';
import { type GeometryId, GEOMETRIES } from '../../domain/layouts/geometry';
import { type LayoutId, layoutById, QWERTY_LAYOUT_CHOICES } from '../../domain/layouts/registry';
import { CORE_MODES, type ModeId } from '../../domain/modes';
import { currentTimeZone, localDateIn, weekdayName } from '../../domain/time';
import { Message, ModeLabel } from '../components/basics';
import { RestorePanel } from '../components/RestorePanel';
import type { OnboardingInput } from '../store/AppStore';
import { useStore } from '../store/react';

function GeometryDetector({ onDetected }: { onDetected: (id: GeometryId) => void }) {
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="panel panel-pad stack-sm">
      <p>
        Click the box, then press the key <strong>immediately right of your left Shift</strong>. If your left Shift is long and has no key beside it, press <strong>Z</strong> instead.
      </p>
      <input
        type="text"
        aria-label="Keyboard geometry check: press the key right of the left Shift"
        autoComplete="off"
        onKeyDown={(e) => {
          e.preventDefault();
          if (e.code === 'IntlBackslash' || e.code === 'IntlRo') {
            setResult('Your keyboard has an extra key beside left Shift: an ISO-style board such as ABNT2.');
            onDetected('abnt2');
          } else if (e.code === 'KeyZ') {
            setResult('No key beside left Shift: a US ANSI board.');
            onDetected('ansi-us');
          } else setResult(`That was ${e.code}; press the key right of the left Shift, or Z.`);
        }}
        style={{ maxWidth: 260 }}
      />
      {result && <p role="status">{result} Full calibration confirms every position later.</p>}
    </div>
  );
}

export function OnboardingScreen() {
  const store = useStore();
  const today = localDateIn(currentTimeZone(), Date.now());
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OnboardingInput>({
    preferredName: null,
    dominantHand: null,
    practiceWeekdays: [1, 2, 3, 4, 5],
    dailyMinutes: 30,
    startDate: today,
    primaryMode: 'QL',
    planStyle: 'sequential',
    geometryId: 'ansi-us',
    keyboardLabel: '',
    qwertyLayoutId: 'qwerty-us-intl',
    modifierStrategy: 'hold-shift',
    modifierNotes: '',
    remaps: '',
    keyboardOffset: { left: '', right: '' },
    chairDeskNotes: '',
    sessionType: null,
  });
  const set = <K extends keyof OnboardingInput>(key: K, value: OnboardingInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const steps = ['About you', 'The four modes', 'Keyboard and setup', 'Where to start'];

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await store.completeOnboarding(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="content" id="main" style={{ maxWidth: 920, margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            Setting up · step {step + 1} of {steps.length} · {steps[step]}
          </div>
          <h1 style={{ marginTop: 8 }}>Typist</h1>
        </div>
        <div className="aside small">Everything stays on this device. No account, no network needed to practise.</div>
      </div>

      {step === 0 && (
        <details className="panel panel-pad" style={{ marginBottom: 24 }}>
          <summary>Restoring from a Typist backup instead?</summary>
          <div style={{ marginTop: 12 }}>
            <RestorePanel empty />
          </div>
        </details>
      )}

      {step === 0 && (
        <section className="stack">
          <div className="field-row">
            <label htmlFor="name">Preferred name (optional)</label>
            <input id="name" type="text" value={form.preferredName ?? ''} onChange={(e) => set('preferredName', e.target.value.trim() ? e.target.value : null)} />
          </div>
          <fieldset>
            <legend>Dominant hand (a profile fact, never a reason to combine the hands into one score)</legend>
            <div className="choice-row">
              {(['left', 'right', 'both'] as const).map((h) => (
                <label key={h} className="choice">
                  <input type="radio" name="dominant" checked={form.dominantHand === h} onChange={() => set('dominantHand', h)} />
                  {h === 'both' ? 'No clear preference' : `${h[0]?.toUpperCase()}${h.slice(1)}`}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Practice days</legend>
            <div className="choice-row">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <label key={d} className="choice">
                  <input
                    type="checkbox"
                    checked={form.practiceWeekdays.includes(d)}
                    onChange={(e) => set('practiceWeekdays', e.target.checked ? [...form.practiceWeekdays, d] : form.practiceWeekdays.filter((x) => x !== d))}
                  />
                  {weekdayName(d).slice(0, 3)}
                </label>
              ))}
            </div>
            <p className="field-help">Default: five weekdays. Missed days move the plan forward; they never create catch-up work.</p>
          </fieldset>
          <fieldset>
            <legend>Daily time budget</legend>
            <div className="choice-row">
              {[30, 45].map((m) => (
                <label key={m} className="choice">
                  <input type="radio" name="budget" checked={form.dailyMinutes === m} onChange={() => set('dailyMinutes', m)} />
                  {m} minutes{m === 30 ? ' (standard)' : ' (deep)'}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field-row">
            <label htmlFor="start">Start date</label>
            <input id="start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value || today)} style={{ maxWidth: 220 }} />
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="stack">
          <p>
            Typist trains four independent skills. Each keeps its own level, lessons, fingering plan, benchmarks and maintenance. A combined average is never shown, because it would hide
            the mode that is not acquired yet.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Layout</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {CORE_MODES.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <ModeLabel mode={m.id} />
                    </td>
                    <td>{m.family === 'qwerty' ? 'Your ordinary QWERTY' : layoutById(m.defaultLayoutId).name}</td>
                    <td>{m.family === 'qwerty' ? 'One hand covers the whole ordinary board, relocating between zones' : 'A dedicated one-hand layout: the whole alphabet sits under one hand'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Message kind="observed" tag="Two Dvorak layouts">
            Dvorak Left-Handed and Dvorak Right-Handed are two separate layouts, not mirror images of each other or of two-hand Dvorak. You select them in your operating system; Typist
            never remaps your keys.
          </Message>
          <p className="muted">Success means 30 WPM at 98% accuracy with no looking, on three separate days, in each mode. The suggested program takes 20 weeks; gates matter more than dates.</p>
        </section>
      )}

      {step === 2 && (
        <section className="stack">
          <fieldset>
            <legend>Keyboard geometry</legend>
            <div className="choice-row">
              {Object.values(GEOMETRIES).map((g) => (
                <label key={g.id} className="choice">
                  <input type="radio" name="geometry" checked={form.geometryId === g.id} onChange={() => set('geometryId', g.id)} />
                  {g.name}
                </label>
              ))}
            </div>
            <p className="field-help">{GEOMETRIES[form.geometryId].description} Not sure? Use the check below.</p>
          </fieldset>
          <GeometryDetector onDetected={(id) => set('geometryId', id)} />
          <div className="field-row">
            <label htmlFor="kb">Keyboard model or label</label>
            <input id="kb" type="text" placeholder="e.g. laptop keyboard, or the model name" value={form.keyboardLabel} onChange={(e) => set('keyboardLabel', e.target.value)} />
          </div>
          <fieldset>
            <legend>Your QWERTY input source (used for QL, QR and the two-hand baseline)</legend>
            <div className="choice-row">
              {QWERTY_LAYOUT_CHOICES.map((id: LayoutId) => (
                <label key={id} className="choice">
                  <input type="radio" name="qwerty" checked={form.qwertyLayoutId === id} onChange={() => set('qwertyLayoutId', id)} />
                  {layoutById(id).name} <span className="mono small">({layoutById(id).xkbName})</span>
                </label>
              ))}
            </div>
            <p className="field-help">
              With US International, <code>'</code> <code>"</code> <code>`</code> <code>~</code> <code>^</code> are dead keys: an apostrophe is <kbd>'</kbd> then <kbd>Space</kbd>. Typist
              counts that as ordinary native typing.
            </p>
          </fieldset>
          <fieldset>
            <legend>Modifier strategy</legend>
            <div className="choice-row">
              {(
                [
                  ['hold-shift', 'Hold Shift'],
                  ['sticky-keys', 'OS Sticky Keys'],
                  ['other', 'Other'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="choice">
                  <input type="radio" name="modifier" checked={form.modifierStrategy === value} onChange={() => set('modifierStrategy', value)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="split">
            <div className="field-row">
              <label htmlFor="off-l">Keyboard offset for the left hand</label>
              <input id="off-l" type="text" placeholder="e.g. keyboard 10 cm left of centre" value={form.keyboardOffset.left} onChange={(e) => set('keyboardOffset', { ...form.keyboardOffset, left: e.target.value })} />
            </div>
            <div className="field-row">
              <label htmlFor="off-r">Keyboard offset for the right hand</label>
              <input id="off-r" type="text" value={form.keyboardOffset.right} onChange={(e) => set('keyboardOffset', { ...form.keyboardOffset, right: e.target.value })} />
            </div>
          </div>
          <div className="field-row">
            <label htmlFor="remaps">Hardware or OS remaps (optional)</label>
            <input id="remaps" type="text" value={form.remaps} onChange={(e) => set('remaps', e.target.value)} />
          </div>
          <div className="field-row">
            <label htmlFor="chair">Chair and desk notes (optional)</label>
            <input id="chair" type="text" value={form.chairDeskNotes} onChange={(e) => set('chairDeskNotes', e.target.value)} />
          </div>
          <fieldset>
            <legend>Desktop session (for your records; optional)</legend>
            <div className="choice-row">
              {['wayland', 'x11'].map((s) => (
                <label key={s} className="choice">
                  <input type="radio" name="session" checked={form.sessionType === s} onChange={() => set('sessionType', s)} />
                  {s === 'x11' ? 'X11' : 'Wayland'}
                </label>
              ))}
              <label className="choice">
                <input type="radio" name="session" checked={form.sessionType === null} onChange={() => set('sessionType', null)} />
                Not sure
              </label>
            </div>
          </fieldset>
        </section>
      )}

      {step === 3 && (
        <section className="stack">
          <fieldset>
            <legend>Primary mode</legend>
            <div className="choice-row">
              {CORE_MODES.map((m) => (
                <label key={m.id} className="choice">
                  <input type="radio" name="primary" checked={form.primaryMode === m.id} onChange={() => set('primaryMode', m.id as ModeId)} />
                  <ModeLabel mode={m.id} />
                </label>
              ))}
            </div>
            <p className="field-help">The roadmap starts with QL at level 0. Starting elsewhere is fine; no prior skill is ever assumed — any mode starts at level 0 and existing skill shows up in its assessments.</p>
          </fieldset>
          <fieldset>
            <legend>Schedule</legend>
            <div className="choice-row">
              <label className="choice">
                <input type="radio" name="style" checked={form.planStyle === 'sequential'} onChange={() => set('planStyle', 'sequential')} />
                Sequential (default): QL, then QR, DL, DR
              </label>
              <label className="choice">
                <input type="radio" name="style" checked={form.planStyle === 'paired-hands'} onChange={() => set('planStyle', 'paired-hands')} />
                Paired hands: alternate QL/QR by day, then DL/DR
              </label>
            </div>
          </fieldset>
          <Message kind="observed" tag="Next">
            After this, Today lists three things: calibrate your QWERTY input source, an optional two-hand QWERTY baseline (stored as Q2, never as QL or QR), and your first level-0
            session.
          </Message>
          {error && <Message kind="error">{error}</Message>}
        </section>
      )}

      <div className="inline-actions" style={{ marginTop: 32 }}>
        {step > 0 && (
          <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
        )}
        {step < steps.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)} disabled={step === 0 && form.practiceWeekdays.length === 0}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-large" disabled={saving || !store.writable} onClick={() => void finish()}>
            {saving ? 'Saving…' : 'Create my plan'}
          </button>
        )}
        {step === 0 && form.practiceWeekdays.length === 0 && <span className="disabled-reason">Choose at least one practice day.</span>}
        {!store.writable && <span className="disabled-reason">This tab is read-only.</span>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          Time zone {currentTimeZone()}
        </span>
      </div>
    </main>
  );
}
