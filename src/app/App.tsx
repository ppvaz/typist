import { useEffect, type ReactNode } from 'react';
import { CORE_MODES, type ModeId } from '../domain/modes';
import { handOf, Message } from './components/basics';
import { href, navigate, useRoute } from './router';
import { currentSetup, isCalibrated } from './store/derive';
import { useAppState, useOverviews, useStore } from './store/react';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { TodayScreen } from './screens/TodayScreen';
import { PracticeHub } from './screens/PracticeHub';
import { SessionScreen } from './screens/SessionScreen';
import { SetupScreen } from './screens/SetupScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { DataScreen } from './screens/DataScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { ExpansionScreen } from './screens/ExpansionScreen';
import { DualScreen } from './screens/DualScreen';
import { DualBaselineScreen, DualRunScreen } from './screens/DualRunScreen';
import { geometryById } from '../domain/layouts/geometry';
import { shortDate } from '../domain/time';

function useTheme() {
  const state = useAppState();
  const pref = state.data.profile?.ui.theme ?? 'system';
  const uiScale = state.data.profile?.ui.uiScale ?? 1;
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [pref]);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }, [uiScale]);
}

const NAV: readonly { path: string; label: string }[] = [
  { path: '/', label: 'Today' },
  { path: '/practice', label: 'Practice' },
  { path: '/progress', label: 'Progress' },
  { path: '/setup', label: 'Setup' },
  { path: '/data', label: 'Data' },
];

function Rail({ path }: { path: string }) {
  const state = useAppState();
  const overviews = useOverviews();
  const core = state.data.core[0];
  return (
    <nav className="rail" aria-label="Main">
      {NAV.map((item) => (
        <a key={item.path} className="nav" href={href(item.path)} aria-current={(item.path === '/' ? path === '/' : path.startsWith(item.path)) ? 'page' : undefined}>
          {item.label}
        </a>
      ))}
      {core && (
        <a className="nav" href={href('/expansion')} aria-current={path.startsWith('/expansion') ? 'page' : undefined}>
          Expansion
        </a>
      )}
      <div className="rail-section">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Modes
        </div>
        {CORE_MODES.map((m) => {
          const o = overviews.get(m.id);
          const primary = state.data.profile?.primaryMode === m.id;
          const status = !o?.started ? 'Not started' : o.milestones.some((x) => x.kind === 'acquired') ? 'Acquired' : o.milestones.some((x) => x.kind === 'advance') ? 'Advanced' : `Level ${o.level}`;
          return (
            <a key={m.id} className="rail-mode" href={href(`/progress/${m.id}`)} data-hand={handOf(m.id)}>
              <span className="mono">{m.id}</span>
              <span>{status}</span>
              <span className="small muted">{primary ? 'NOW' : ''}</span>
            </a>
          );
        })}
      </div>
      <div className="rail-foot">
        <div className="eyebrow">Q2 baseline</div>
        <Q2Summary />
        <div className="small" style={{ marginTop: 4 }}>
          Context only — outside the core four.
        </div>
      </div>
    </nav>
  );
}

function Q2Summary() {
  const overviews = useOverviews();
  const q2 = overviews.get('Q2' as ModeId);
  const set = q2?.latestSet;
  if (!set?.medianWpm) return <div className="no-evidence">No evidence</div>;
  return <div>{set.medianWpm.format(1)} WPM two-hand</div>;
}

function TopBar() {
  const state = useAppState();
  const setup = currentSetup(state.data.setups);
  const overviews = useOverviews();
  const primary = state.data.profile?.primaryMode;
  const calibration = primary ? overviews.get(primary)?.calibration : undefined;
  const offline = state.offline;
  const offlineLabel = !state.online
    ? offline.state === 'ready'
      ? 'Working offline'
      : 'Offline · some assets are not cached'
    : offline.state === 'ready'
      ? 'Available offline'
      : offline.state === 'installing'
        ? 'Caching for offline use…'
        : offline.state === 'partial' || offline.state === 'error'
          ? 'Offline cache incomplete'
          : offline.state === 'dev'
            ? 'Development build · offline cache off'
            : 'Offline use not supported here';
  return (
    <header className="topbar">
      <a className="brand" href={href('/')}>
        <span className="brand-mark" aria-hidden="true">
          T
        </span>
        Typist
      </a>
      <div className="topbar-status">
        <span>
          <span className={`status-mark ${offline.state === 'ready' ? 'met' : 'pending'}`} aria-hidden="true" />
          {offlineLabel}
        </span>
        {setup && (
          <span className="mono small">
            {setup.os} · {geometryById(setup.geometryId).name}
            {calibration && isCalibrated(calibration) && calibration.status === 'fresh' ? ` · calibrated ${shortDate(calibration.record.completedAt.slice(0, 10))}` : ' · calibration needed'}
          </span>
        )}
        {state.lease !== 'writer' && <span>Read-only tab</span>}
      </div>
    </header>
  );
}

function Banners() {
  const state = useAppState();
  const store = useStore();
  const items: ReactNode[] = [];
  if (state.lease === 'read-only' || state.lease === 'lost') {
    items.push(
      <div key="lease" className="banner" role="status">
        <span>
          {state.lease === 'lost'
            ? 'Another tab took over writing. This tab now shows progress read-only; any run here was interrupted.'
            : 'Typist is open in another tab, which is the only one allowed to write. This tab is read-only.'}
        </span>
        <button type="button" className="btn btn-small" onClick={() => void store.takeover()}>
          Take over writing here (interrupts the other tab's run)
        </button>
      </div>,
    );
  }
  if (state.recovered.length > 0) {
    items.push(
      <div key="recovered" className="banner" role="status">
        <span>
          {state.recovered.length} run{state.recovered.length === 1 ? ' was' : 's were'} still open when Typist last closed and {state.recovered.length === 1 ? 'is' : 'are'} saved as interrupted. An
          interrupted benchmark needs a fresh trial; the partial record is kept.
        </span>
        <button type="button" className="btn btn-small" onClick={() => store.dismissRecovered()}>
          Dismiss
        </button>
      </div>,
    );
  }
  if (state.unsaved.length > 0) {
    items.push(
      <div key="unsaved" className="banner error" role="alert">
        <span>{state.unsaved.length} result(s) could not be saved and are held in memory. Scored trials are paused until saving works.</span>
        <a className="btn btn-small" href={href('/data')}>
          Recovery download
        </a>
      </div>,
    );
  }
  if (state.offline.updateReady && !state.activeRun) {
    items.push(
      <div key="update" className="banner" role="status">
        <span>An update is ready. It never activates during a timed block.</span>
        <button type="button" className="btn btn-small" onClick={() => window.dispatchEvent(new CustomEvent('typist:apply-update'))}>
          Apply update now
        </button>
      </div>,
    );
  }
  return <>{items}</>;
}

function Shell({ children, path }: { children: ReactNode; path: string }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app-shell">
        <TopBar />
        <Rail path={path} />
        <div style={{ minWidth: 0 }}>
          <Banners />
          <main className="content" id="main">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}

export function App() {
  useTheme();
  const state = useAppState();
  const route = useRoute();
  if (state.status === 'loading') return <div className="center-screen muted">Opening local data…</div>;
  if (state.status === 'failed') {
    return (
      <div className="center-screen">
        <div style={{ maxWidth: 560 }}>
          <Message kind="error" tag="Storage unavailable">
            {state.error}
          </Message>
        </div>
      </div>
    );
  }
  const profile = state.data.profile;
  if (!profile?.onboardingComplete) {
    return (
      <>
        <Banners />
        <OnboardingScreen />
      </>
    );
  }
  const [first, second, third] = route.segments;
  // Full-screen practice flows have their own shell, but still show banners
  // (lost writer lease, unsaved results, recovered runs).
  if (first === 'session' || first === 'run') {
    return (
      <>
        <Banners />
        {first === 'session' ? <SessionScreen sessionId={second ?? null} /> : <PracticeHub runMode={(second as ModeId | undefined) ?? null} activity={third ?? null} />}
      </>
    );
  }
  // Two-machine runs and their solo baselines are full-screen too.
  if (first === 'dual' && (second === 'run' || second === 'baseline') && state.data.core[0]) {
    return (
      <>
        <Banners />
        {second === 'run' ? <DualRunScreen /> : <DualBaselineScreen mode={(third ?? '') as ModeId} taskClass={route.segments[3] ?? ''} />}
      </>
    );
  }
  let content: ReactNode;
  switch (first) {
    case undefined:
      content = <TodayScreen />;
      break;
    case 'practice':
      content = <PracticeHub runMode={null} activity={null} />;
      break;
    case 'progress':
      content = <ProgressScreen section={second ?? null} />;
      break;
    case 'setup':
      content = <SetupScreen section={second ?? null} arg={third ?? null} />;
      break;
    case 'data':
      content = <DataScreen />;
      break;
    case 'review':
      content = <ReviewScreen sessionId={second ?? ''} />;
      break;
    case 'expansion':
      content = <ExpansionScreen />;
      break;
    case 'dual':
      content = <DualScreen />;
      break;
    default:
      content = (
        <Message kind="short" tag="Not found">
          That page does not exist. <a href={href('/')}>Go to Today</a>.
        </Message>
      );
  }
  return <Shell path={route.path}>{content}</Shell>;
}

export { navigate };
