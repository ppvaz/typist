// Free practice outside the daily plan: choose a mode and an activity. Runs
// belong to a "free" session for the day, so benchmark sets still come from
// one practice session. Custom text never becomes a reference benchmark.
import { useEffect, useMemo, useState } from 'react';
import { CODE, MONTHLY, PROSE, SYMBOLS } from '../../content/corpus';
import { choosePassage } from '../../domain/exercises/generators';
import { levelDefinition } from '../../domain/curriculum';
import { corpusExercise, customExercise } from '../../domain/exercises/exercise';
import { newId } from '../../domain/ids';
import { BASE_MODES, EXPANSION_MODES, modeById, type ModeId } from '../../domain/modes';
import { RECORD_SCHEMA_VERSION, type BlockKind, type SessionBlockRecord, type SessionRecord } from '../../domain/records';
import { APP_VERSION, CORE_PROTOCOL_ID, PROTOCOLS } from '../../domain/versions';
import { handOf, Message, ModeLabel } from '../components/basics';
import { BenchmarkSetFlow } from '../practice/BenchmarkSetFlow';
import { BlockRunner } from '../practice/BlockRunner';
import { ControlsExercise } from '../practice/ControlsExercise';
import type { ExercisePlan } from '../practice/exercises';
import { href, navigate } from '../router';
import { hasMilestone, isCalibrated, type ModeOverview } from '../store/derive';
import { useAppState, useOverviews, useStore } from '../store/react';

interface Activity {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly available: (o: ModeOverview, acquired: boolean) => string | null;
}

const ACTIVITIES: readonly Activity[] = [
  { id: 'lesson', label: 'Lesson for your level', detail: 'New keys, spatial finding or weak keys, whichever the level calls for', available: () => null },
  { id: 'words', label: 'Words', detail: 'Untimed real words from the keys you have learned', available: () => null },
  { id: 'relocation', label: 'Relocation', detail: 'Whole-hand moves between zones and back to the anchors', available: () => null },
  { id: 'prose', label: 'Prose, untimed', detail: 'Sentences, case and punctuation; practice feedback only', available: (o) => (o.level < 3 ? 'Prose is suggested from level 3; you can still try it.' : null) },
  { id: 'timed', label: 'Prose, 60 seconds', detail: 'Timed practice runs; never benchmark evidence', available: () => null },
  { id: 'code', label: 'Code', detail: 'Small original code exercises with newlines and symbols', available: () => null },
  { id: 'symbols', label: 'Numbers and symbols', detail: 'Original text with digits and punctuation', available: () => null },
  { id: 'custom', label: 'Custom text', detail: 'Your own English or Portuguese text; composition allowed', available: () => null },
  { id: 'assessment', label: 'Level assessment', detail: 'Recommended evidence for the next level (levels 0–3)', available: (o) => (o.level > 3 ? 'Levels 4+ move with benchmark gates.' : null) },
  { id: 'benchmark', label: 'Benchmark set', detail: 'english-prose-60-v1: three 60 s trials, rests, no map', available: (o) => (o.mode !== 'Q2' && o.level < 4 ? 'Benchmarks begin at level 4 (you can move levels in Setup).' : null) },
  { id: 'monthly', label: 'Monthly fixed passage', detail: 'The same passage each month in every acquired mode', available: (_o, acquired) => (acquired ? null : 'Offered once the mode is acquired.') },
];

function useFreeSession(): SessionRecord | null {
  const state = useAppState();
  return useMemo(() => state.data.sessions.filter((s) => s.template === 'free' && s.localDate === state.today && s.status === 'active').at(-1) ?? null, [state.data.sessions, state.today]);
}

async function ensureFreeSession(store: ReturnType<typeof useStore>, existing: SessionRecord | null, today: string, timeZone: string): Promise<SessionRecord> {
  if (existing) return existing;
  const session: SessionRecord = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: newId(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    timeZone,
    localDate: today,
    template: 'free',
    plannedBlocks: [],
    plannedMinutes: 0,
    blocks: [],
    actualMinutes: 0,
    fatigueBefore: null,
    fatigueAfter: null,
    effort: null,
    note: null,
    status: 'active',
    appVersion: APP_VERSION,
    protocolId: CORE_PROTOCOL_ID,
    deferred: [],
  };
  await store.putSession(session);
  return session;
}

function CustomTextForm({ onStart }: { onStart: (text: string, language: string) => void }) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('pt');
  return (
    <div className="center-screen">
      <div className="panel panel-pad stack-sm" style={{ width: 'min(760px, 100%)' }}>
        <h2>Custom text</h2>
        <p className="small muted">
          Composition is allowed here (accents via dead keys or an input method count as one character each). Custom text is practice only; it never changes a reference benchmark.
        </p>
        <fieldset>
          <legend>Language</legend>
          <div className="choice-row">
            {[
              ['pt', 'Portuguese'],
              ['en', 'English'],
              ['other', 'Other'],
            ].map(([v, l]) => (
              <label key={v} className="choice">
                <input type="radio" name="lang" checked={language === v} onChange={() => setLanguage(v as string)} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="custom-text">Text to practise</label>
        <textarea id="custom-text" className="field" style={{ maxWidth: '100%', minHeight: 180 }} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="inline-actions">
          <button type="button" className="btn btn-primary" disabled={text.trim().length === 0} onClick={() => onStart(text, language)}>
            Start
          </button>
          <a className="btn" href={href('/practice')}>
            Cancel
          </a>
          {text.trim().length === 0 && <span className="disabled-reason">Enter some text first.</span>}
        </div>
      </div>
    </div>
  );
}

function FreeRun({ mode, activity }: { mode: ModeId; activity: string }) {
  const store = useStore();
  const state = useAppState();
  const overviews = useOverviews();
  const existing = useFreeSession();
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [custom, setCustom] = useState<{ text: string; language: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = overviews.get(mode) as ModeOverview;
  const timeZone = state.data.profile?.timeZone ?? 'UTC';

  useEffect(() => {
    let cancelled = false;
    ensureFreeSession(store, existing, state.today, timeZone)
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // Created once per run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Message kind="error">{error}</Message>;
  if (!session) return <div className="center-screen muted">Preparing…</div>;

  const blockId = newIdOnce(session.id + activity + mode);
  const back = () => navigate('/practice');
  const recordBlock = async (record: SessionBlockRecord) => {
    const latest = store.data.sessions.find((s) => s.id === session.id) ?? session;
    const next: SessionRecord = { ...latest, blocks: [...latest.blocks, record], actualMinutes: latest.actualMinutes + record.activeMs / 60_000 };
    await store.putSession(next).catch(() => undefined);
    await store.applyAwards().catch(() => undefined);
    back();
  };

  if (activity === 'benchmark') {
    return <BenchmarkSetFlow mode={mode} sessionId={session.id} blockId={blockId} purpose={mode === 'Q2' ? 'baseline' : 'stage'} onCancel={back} onDone={() => void store.applyAwards().finally(back)} />;
  }
  if (activity === 'assessment' && o.level === 1 && (!o.state?.controlsCompletedAt || !o.state?.comfortConfirmedAt)) {
    return <ControlsExercise mode={mode} onDone={back} />;
  }
  if (activity === 'custom' && !custom) return <CustomTextForm onStart={(text, language) => setCustom({ text, language })} />;

  const kindFor: Record<string, BlockKind> = {
    lesson: 'weak-keys',
    words: 'words',
    relocation: 'warmup',
    timed: 'timed-text',
    assessment: 'assessment',
    monthly: 'monthly',
  };
  const fixedPlan = (seed: number, index: number): ExercisePlan | null => {
    const untimed = PROTOCOLS['drill-untimed-practice-v1'];
    switch (activity) {
      case 'prose':
        return { exercise: corpusExercise(PROSE, choosePassage(PROSE, seed)), protocol: PROTOCOLS['english-prose-untimed-practice-v1'], trialKind: 'practice', assessmentLevel: null, initialAssistance: null, goal: 'Prose practice; feedback only' };
      case 'code': {
        const item = CODE.items[(seed + index) % CODE.items.length] ?? CODE.items[0];
        return item ? { exercise: corpusExercise(CODE, item), protocol: untimed, trialKind: 'practice', assessmentLevel: null, initialAssistance: null, goal: 'Code: symbols, indentation, Enter' } : null;
      }
      case 'symbols': {
        const item = SYMBOLS.items[0];
        return item ? { exercise: corpusExercise(SYMBOLS, item), protocol: untimed, trialKind: 'practice', assessmentLevel: null, initialAssistance: null, goal: 'Numbers and symbols' } : null;
      }
      case 'custom':
        return custom ? { exercise: customExercise(custom.text, custom.language), protocol: PROTOCOLS['custom-text-practice-v1'], trialKind: 'custom', assessmentLevel: null, initialAssistance: null, goal: `Custom ${custom.language === 'pt' ? 'Portuguese' : custom.language === 'en' ? 'English' : ''} text` } : null;
      case 'monthly':
        return { exercise: corpusExercise(MONTHLY, MONTHLY.items[0] as (typeof MONTHLY.items)[number]), protocol: PROTOCOLS['monthly-fixed-passage-60-v1'], trialKind: 'monthly', assessmentLevel: null, initialAssistance: 'none', goal: 'Monthly fixed passage' };
      default:
        return null;
    }
  };
  const kind: BlockKind = kindFor[activity] ?? 'words';
  const title = ACTIVITIES.find((a) => a.id === activity)?.label ?? 'Practice';
  return (
    <BlockRunner
      mode={mode}
      kind={kind}
      minutes={null}
      sessionId={session.id}
      blockId={blockId}
      title={`Free practice · ${title}`}
      fixedPlan={fixedPlan}
      onEnd={(record) => void recordBlock(record)}
    />
  );
}

const onceIds = new Map<string, string>();
function newIdOnce(key: string): string {
  let id = onceIds.get(key);
  if (!id) {
    id = newId();
    onceIds.set(key, id);
  }
  return id;
}

export function PracticeHub({ runMode, activity }: { runMode: ModeId | null; activity: string | null }) {
  const state = useAppState();
  const overviews = useOverviews();
  const [mode, setMode] = useState<ModeId>(state.data.profile?.primaryMode ?? 'QL');
  if (runMode && activity) return <FreeRun mode={runMode} activity={activity} />;
  // Expansion modes appear only after core completion, once started.
  const offered = [...BASE_MODES, ...(state.data.core.length > 0 ? EXPANSION_MODES.filter((m) => overviews.get(m.id)?.started) : [])];
  const o = (overviews.get(mode) ?? overviews.get('QL')) as ModeOverview;
  const acquired = !!hasMilestone(state.data.milestones, mode, 'acquired');
  const calibrated = isCalibrated(o.calibration);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Free practice</div>
          <h1 style={{ marginTop: 8 }}>Practise any mode</h1>
        </div>
        <div className="aside small">Free practice is recorded like any other; only reference benchmarks count toward gates.</div>
      </div>
      <fieldset>
        <legend>Mode</legend>
        <div className="choice-row">
          {offered.map((m) => (
            <label key={m.id} className="choice" data-hand={handOf(m.id)}>
              <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
              <ModeLabel mode={m.id} />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="panel panel-pad" data-hand={handOf(mode)}>
        <p>
          {modeById(mode).id} is at level {o.level} · {levelDefinition(o.level).name}. Input source <code>{o.layout.xkbName}</code>:{' '}
          {calibrated ? 'calibrated' : o.calibration.status === 'probe-required' ? 'needs the short probe (asked before practice)' : 'not calibrated yet (asked before practice)'}.{' '}
          <a href={href(`/setup/calibrate/${o.layout.id}`)}>Calibrate</a>
        </p>
      </div>
      <ul className="rows panel">
        {ACTIVITIES.filter((a) => (mode === 'Q2' ? ['benchmark', 'prose', 'timed', 'words', 'custom'].includes(a.id) : true)).map((a) => {
          const reason = a.available(o, acquired);
          const blocked = a.id === 'monthly' && !acquired;
          return (
            <li key={a.id} className="row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <span>
                {a.label}
                <span className="detail" style={{ display: 'block' }}>
                  {a.detail}
                  {reason ? ` · ${reason}` : ''}
                </span>
              </span>
              {blocked ? (
                <button type="button" className="btn btn-small" disabled>
                  Start
                </button>
              ) : (
                <a className="btn btn-small" href={href(`/run/${mode}/${a.id}`)}>
                  Start
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {!state.data.profile && <Message kind="short">Complete setup first.</Message>}
    </div>
  );
}
