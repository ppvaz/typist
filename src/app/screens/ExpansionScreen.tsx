// Optional expansion (docs/build-plan.md, milestone 5). Offered only after
// core completion. Expansion modes keep their own curricula, ledgers and
// evidence; they never change the four-mode completion denominator, and no
// optional layout is needed to finish the program. Half-QWERTY runs as a
// separately labeled in-app emulation whose evidence never mixes with native.
import { levelDefinition } from '../../domain/curriculum';
import { EXPANSION_MODES, modeById, type ModeId } from '../../domain/modes';
import { mediumDate } from '../../domain/time';
import { handOf, Message, ModeIdentity, NoEvidence, StatusMark } from '../components/basics';
import { fractionAccuracy, fractionWpm } from '../format';
import { href } from '../router';
import { hasMilestone, isCalibrated, type ModeOverview } from '../store/derive';
import { useAppState, useOverviews, useStore } from '../store/react';

function ExpansionCard({ o }: { o: ModeOverview }) {
  const store = useStore();
  const def = modeById(o.mode);
  const acquired = hasMilestone(o.milestones, o.mode, 'acquired');
  const advanced = hasMilestone(o.milestones, o.mode, 'advance');
  const emulated = def.inputPath === 'emulated';
  return (
    <article className="mode-card" data-hand={handOf(o.mode)} aria-labelledby={`x-${o.mode}`}>
      <div id={`x-${o.mode}`}>
        <ModeIdentity mode={o.mode} size="small" />
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        {emulated ? 'Hold Space to mirror the keyboard; tap Space for a space. In-app emulation: results are labeled emulated.' : `${o.layout.name} (${o.layout.xkbName}): an ordinary full-board layout, one hand relocating between zones.`}
      </p>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Milestone</dt>
        <dd>
          <StatusMark mark={acquired || advanced ? 'met' : 'none'} label={acquired ? `Acquired · ${mediumDate(acquired.awardedLocalDate)}` : advanced ? `Advanced · ${mediumDate(advanced.awardedLocalDate)}` : 'No milestone yet'} />
        </dd>
        <dt>Latest</dt>
        <dd>{o.latestSet?.medianAccuracy ? `${fractionAccuracy(o.latestSet.medianAccuracy)}% · ${fractionWpm(o.latestSet.medianWpm)} WPM` : <NoEvidence />}</dd>
        <dt>Level</dt>
        <dd>{o.started ? `${o.level} · ${levelDefinition(o.level).name}` : 'Not started'}</dd>
        <dt>Input</dt>
        <dd>{emulated ? 'Emulated (physical positions; OS layout not used)' : isCalibrated(o.calibration) ? 'Native · calibrated' : `Native · ${o.layout.xkbName} needs calibration`}</dd>
      </dl>
      <div className="inline-actions" style={{ marginTop: 12 }}>
        {!o.started ? (
          <button type="button" className="btn btn-small" onClick={() => void store.startMode(o.mode)}>
            Start {o.mode}
          </button>
        ) : (
          <>
            <a className="btn btn-small" href={href(`/run/${o.mode}/lesson`)}>
              Practise
            </a>
            {o.level >= 4 && (
              <a className="btn btn-small" href={href(`/run/${o.mode}/benchmark`)}>
                Benchmark
              </a>
            )}
            <a className="btn btn-small btn-quiet" href={href(`/progress/${o.mode}`)}>
              Detail
            </a>
          </>
        )}
        {!emulated && !isCalibrated(o.calibration) && (
          <a className="btn btn-small btn-quiet" href={href(`/setup/calibrate/${o.layout.id}?kind=full`)}>
            Calibrate
          </a>
        )}
      </div>
    </article>
  );
}

export function ExpansionScreen() {
  const state = useAppState();
  const overviews = useOverviews();
  const core = state.data.core[0];
  if (!core) {
    return (
      <div className="stack" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <div>
            <div className="eyebrow">Optional expansion</div>
            <h1 style={{ marginTop: 8 }}>After core completion</h1>
          </div>
        </div>
        <Message kind="pending" tag="Locked">
          Colemak, Workman, Half-QWERTY and the two-machine module open once QL, QR, DL and DR are all acquired and currently stable. None of them is needed to finish the program.{' '}
          <a href={href('/progress')}>See core completion</a>
        </Message>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Optional expansion · core completed {mediumDate(core.awardedLocalDate)}</div>
          <h1 style={{ marginTop: 8 }}>More layouts, same method</h1>
        </div>
        <div className="aside small">These results live here and never change the four-mode completion.</div>
      </div>
      <p>
        Each mode below has its own level, lessons, fingering ledger and benchmarks, and the same curriculum as the core. Standard Colemak is not Colemak-DH, and standard Workman is not
        one of its variants. Actual training stays on the core modes until you choose otherwise.
      </p>
      <div className="mode-cards">
        {EXPANSION_MODES.map((m) => {
          const o = overviews.get(m.id as ModeId);
          return o ? <ExpansionCard key={m.id} o={o} /> : null;
        })}
      </div>
      <Message kind="observed" tag="Two machines">
        The optional two-machine endgame trains one hand per keyboard on two computers at once. <a href={href('/dual')}>Open the two-machine module</a>. Restoring current stability in the
        core modes first is recommended.
      </Message>
    </div>
  );
}
