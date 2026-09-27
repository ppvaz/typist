// Application state: the loaded records plus runtime status (writer lease,
// save state, storage persistence, offline readiness). Every action writes
// through the repository first and updates memory only after the commit, so
// the UI never shows data as saved that is not.
import type { Level } from '../../domain/curriculum';
import type { DualRunRecord } from '../../domain/dual';
import { seedLedger, reviseLedger as reviseLedgerRecord } from '../../domain/fingering';
import { newId } from '../../domain/ids';
import type { GeometryId } from '../../domain/layouts/geometry';
import { geometryById } from '../../domain/layouts/geometry';
import type { LayoutId } from '../../domain/layouts/registry';
import { ALL_MODES, type ModeId } from '../../domain/modes';
import {
  type BenchmarkSetRecord,
  type CalibrationRecord,
  type CoreCompletionRecord,
  type CustomText,
  DEFAULT_UI,
  type Declarations,
  type FingeringLedger,
  type KeyboardSetup,
  type LedgerEntry,
  type MilestoneRecord,
  type ModeState,
  type PlanEvent,
  type Profile,
  RECORD_SCHEMA_VERSION,
  type SessionRecord,
  type SwitchProbeRecord,
  type TrialRecord,
  type Zone,
} from '../../domain/records';
import { currentTimeZone, localDateIn } from '../../domain/time';
import { openTypistDb, type TypistDB } from '../../storage/db';
import { type LeaseState, WriterLease } from '../../storage/lease';
import { recoverRunningTrials } from '../../storage/recovery';
import { Repository, type SaveState, type Snapshot } from '../../storage/repo';
import { browserLabel, browserSessionId, osLabel, tabId } from '../runtime/env';
import { currentLedger, currentSetup, pendingAwards } from './derive';

export interface UnsavedItem {
  readonly id: string;
  readonly label: string;
  readonly payload: unknown;
  readonly at: string;
}

export interface OfflineStatus {
  readonly state: 'unsupported' | 'installing' | 'ready' | 'partial' | 'error' | 'dev';
  readonly missing: readonly string[];
  readonly updateReady: boolean;
}

export interface AppState {
  readonly status: 'loading' | 'ready' | 'failed';
  readonly error: string | null;
  readonly data: Snapshot;
  readonly lease: LeaseState;
  readonly save: SaveState;
  readonly persisted: boolean | null;
  readonly browserSession: string;
  readonly recovered: readonly TrialRecord[];
  readonly unsaved: readonly UnsavedItem[];
  readonly today: string;
  readonly activeRun: boolean;
  readonly offline: OfflineStatus;
  readonly online: boolean;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  profile: null,
  setups: [],
  calibrations: [],
  ledgers: [],
  modeStates: [],
  sessions: [],
  trials: [],
  sets: [],
  milestones: [],
  core: [],
  probes: [],
  planEvents: [],
  customTexts: [],
  dualRuns: [],
};

export interface OnboardingInput {
  readonly preferredName: string | null;
  readonly dominantHand: Profile['dominantHand'];
  readonly practiceWeekdays: readonly number[];
  readonly dailyMinutes: number;
  readonly startDate: string;
  readonly primaryMode: ModeId;
  readonly planStyle: Profile['planStyle'];
  readonly geometryId: GeometryId;
  readonly keyboardLabel: string;
  readonly qwertyLayoutId: LayoutId;
  readonly modifierStrategy: KeyboardSetup['modifierStrategy'];
  readonly modifierNotes: string;
  readonly remaps: string;
  readonly keyboardOffset: { readonly left: string; readonly right: string };
  readonly chairDeskNotes: string;
  readonly sessionType: string | null;
}

type Listener = () => void;

function upsert<T>(list: readonly T[], items: readonly T[], key: (item: T) => string): T[] {
  if (items.length === 0) return list as T[];
  const map = new Map(list.map((i) => [key(i), i]));
  for (const item of items) map.set(key(item), item);
  return [...map.values()];
}

export interface Upserts {
  readonly profile?: Profile;
  readonly setups?: readonly KeyboardSetup[];
  readonly calibrations?: readonly CalibrationRecord[];
  readonly ledgers?: readonly FingeringLedger[];
  readonly modeStates?: readonly ModeState[];
  readonly sessions?: readonly SessionRecord[];
  readonly trials?: readonly TrialRecord[];
  readonly sets?: readonly BenchmarkSetRecord[];
  readonly milestones?: readonly MilestoneRecord[];
  readonly core?: readonly CoreCompletionRecord[];
  readonly probes?: readonly SwitchProbeRecord[];
  readonly planEvents?: readonly PlanEvent[];
  readonly customTexts?: readonly CustomText[];
  readonly dualRuns?: readonly DualRunRecord[];
}

export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  db: TypistDB | null = null;
  repo: Repository | null = null;
  lease: WriterLease | null = null;
  readonly tab = tabId();
  private clock: ReturnType<typeof setInterval> | null = null;
  /** Interrupts the active run when the writer lease is lost. */
  onLeaseLost: (() => void) | null = null;

  constructor() {
    this.state = {
      status: 'loading',
      error: null,
      data: EMPTY_SNAPSHOT,
      lease: 'read-only',
      save: { status: 'idle' },
      persisted: null,
      browserSession: browserSessionId(),
      recovered: [],
      unsaved: [],
      today: localDateIn(currentTimeZone(), Date.now()),
      activeRun: false,
      offline: { state: 'dev', missing: [], updateReady: false },
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
    };
  }

  getState = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get data(): Snapshot {
    return this.state.data;
  }

  get writable(): boolean {
    return this.state.lease === 'writer' && !!this.repo;
  }

  private requireRepo(): Repository {
    if (!this.repo || this.state.lease !== 'writer') throw new Error('This tab is read-only. Take over writing to make changes.');
    return this.repo;
  }

  timeZone(): string {
    return this.state.data.profile?.timeZone ?? currentTimeZone();
  }

  refreshToday(): void {
    const today = localDateIn(this.timeZone(), Date.now());
    if (today !== this.state.today) this.set({ today });
  }

  async init(dbName?: string): Promise<void> {
    try {
      this.db = await openTypistDb(dbName);
    } catch (error) {
      this.set({ status: 'failed', error: `Local storage could not be opened: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.` });
      return;
    }
    this.repo = new Repository(this.db, this.tab);
    this.repo.onSaveState((save) => this.set({ save }));
    this.lease = new WriterLease(this.db, this.tab);
    this.lease.onChange((lease) => {
      this.set({ lease });
      if (lease === 'lost') this.onLeaseLost?.();
    });
    const writer = await this.lease.acquireUnlessLive();
    let recovered: TrialRecord[] = [];
    if (writer) {
      try {
        recovered = await recoverRunningTrials(this.repo);
      } catch {
        // Recovery is retried next start; the journal stays untouched.
      }
    }
    const data = await this.repo.loadSnapshot();
    let persisted: boolean | null = null;
    try {
      persisted = (await navigator.storage?.persisted?.()) ?? null;
    } catch {
      persisted = null;
    }
    this.set({ status: 'ready', data, recovered, persisted, lease: this.lease.state });
    this.refreshToday();
    this.clock = setInterval(() => this.refreshToday(), 30_000);
    window.addEventListener('online', () => this.set({ online: true }));
    window.addEventListener('offline', () => this.set({ online: false }));
    window.addEventListener('pagehide', () => void this.lease?.release());
  }

  async takeover(): Promise<void> {
    if (!this.lease || !this.repo) return;
    const ok = await this.lease.acquire(true);
    if (!ok) return;
    const recovered = await recoverRunningTrials(this.repo, 'writer-lost');
    const data = await this.repo.loadSnapshot();
    this.set({ data, recovered: [...this.state.recovered, ...recovered] });
  }

  async reload(): Promise<void> {
    if (!this.repo) return;
    this.set({ data: await this.repo.loadSnapshot() });
  }

  /** Update memory after a successful commit elsewhere (trial controller). */
  applyUpserts(u: Upserts): void {
    const d = this.state.data;
    const byId = <T extends { id: string }>(x: T) => x.id;
    this.set({
      data: {
        profile: u.profile ?? d.profile,
        setups: upsert(d.setups, u.setups ?? [], byId),
        calibrations: upsert(d.calibrations, u.calibrations ?? [], byId),
        ledgers: upsert(d.ledgers, u.ledgers ?? [], byId),
        modeStates: upsert(d.modeStates, u.modeStates ?? [], (s) => s.mode),
        sessions: upsert(d.sessions, u.sessions ?? [], byId),
        trials: upsert(d.trials, u.trials ?? [], byId),
        sets: upsert(d.sets, u.sets ?? [], byId),
        milestones: upsert(d.milestones, u.milestones ?? [], byId),
        core: upsert(d.core, u.core ?? [], byId),
        probes: upsert(d.probes, u.probes ?? [], byId),
        planEvents: upsert(d.planEvents, u.planEvents ?? [], byId),
        customTexts: upsert(d.customTexts, u.customTexts ?? [], byId),
        dualRuns: upsert(d.dualRuns, u.dualRuns ?? [], byId),
      },
    });
  }

  /** Two-machine side records (docs/dual-machine.md). */
  async saveDualRuns(records: readonly DualRunRecord[]): Promise<void> {
    if (!this.repo || records.length === 0) return;
    await this.repo.putDualRuns(records);
    this.applyUpserts({ dualRuns: records });
  }

  setActiveRun(activeRun: boolean): void {
    if (activeRun !== this.state.activeRun) this.set({ activeRun });
  }

  setOffline(offline: OfflineStatus): void {
    this.set({ offline });
  }

  addUnsaved(item: Omit<UnsavedItem, 'id' | 'at'>): string {
    const id = newId();
    this.set({ unsaved: [...this.state.unsaved, { ...item, id, at: new Date().toISOString() }] });
    return id;
  }

  removeUnsaved(id: string): void {
    this.set({ unsaved: this.state.unsaved.filter((u) => u.id !== id) });
  }

  dismissRecovered(): void {
    this.set({ recovered: [] });
  }

  async requestPersistence(): Promise<boolean | null> {
    try {
      const granted = (await navigator.storage?.persist?.()) ?? null;
      this.set({ persisted: granted });
      return granted;
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------- setup

  async completeOnboarding(input: OnboardingInput): Promise<void> {
    const repo = this.requireRepo();
    const now = new Date().toISOString();
    const timeZone = currentTimeZone();
    const today = localDateIn(timeZone, Date.now());
    const profile: Profile = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: this.state.data.profile?.id ?? newId(),
      preferredName: input.preferredName,
      dominantHand: input.dominantHand,
      timeZone,
      practiceWeekdays: [...input.practiceWeekdays].sort(),
      dailyMinutes: input.dailyMinutes,
      primaryMode: input.primaryMode,
      startDate: input.startDate,
      planStyle: input.planStyle,
      ui: this.state.data.profile?.ui ?? DEFAULT_UI,
      createdAt: this.state.data.profile?.createdAt ?? now,
      updatedAt: now,
      onboardingComplete: true,
      showcaseTarget: this.state.data.profile?.showcaseTarget ?? null,
    };
    const geometry = geometryById(input.geometryId);
    const setup: KeyboardSetup = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: newId(),
      setupId: newId(),
      revision: 1,
      createdAt: now,
      geometryId: input.geometryId,
      geometryVersion: geometry.version,
      keyboardLabel: input.keyboardLabel,
      os: osLabel(),
      sessionType: input.sessionType,
      browser: browserLabel(),
      qwertyLayoutId: input.qwertyLayoutId,
      modifierStrategy: input.modifierStrategy,
      modifierNotes: input.modifierNotes,
      remaps: input.remaps,
      keyboardOffset: input.keyboardOffset,
      chairDeskNotes: input.chairDeskNotes,
      changeReason: null,
      geometryVerified: false,
    };
    const ledgers: FingeringLedger[] = ALL_MODES.map((m) =>
      seedLedger({ id: newId(), ledgerId: newId(), mode: m.id, setupId: setup.setupId, geometry, createdAt: now, effectiveDate: today }),
    );
    const modeStates: ModeState[] = ALL_MODES.map((m) => {
      const existing = this.state.data.modeStates.find((s) => s.mode === m.id);
      if (existing) return existing;
      const started = m.id === input.primaryMode;
      return {
        schemaVersion: RECORD_SCHEMA_VERSION,
        mode: m.id,
        level: 0,
        stageProgress: 0,
        startedAt: started ? now : null,
        history: started ? [{ level: 0, from: null, at: now, reason: 'start', evidenceIds: [], note: null }] : [],
        comfortConfirmedAt: null,
        controlsCompletedAt: null,
      };
    });
    await repo.putMany({ profile, setups: [setup], ledgers, modeStates });
    this.applyUpserts({ profile, setups: [setup], ledgers, modeStates });
    void this.requestPersistence();
  }

  async updateProfile(patch: Partial<Omit<Profile, 'id' | 'schemaVersion'>>): Promise<void> {
    const repo = this.requireRepo();
    const current = this.state.data.profile;
    if (!current) return;
    const profile: Profile = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await repo.putProfile(profile);
    this.applyUpserts({ profile });
  }

  /** Any setup edit is a new revision; history keeps the old one. */
  async reviseSetup(patch: Partial<Omit<KeyboardSetup, 'id' | 'setupId' | 'revision' | 'createdAt' | 'schemaVersion'>>, reason: string | null): Promise<KeyboardSetup | null> {
    const repo = this.requireRepo();
    const current = currentSetup(this.state.data.setups);
    if (!current) return null;
    const geometryChanged = patch.geometryId !== undefined && patch.geometryId !== current.geometryId;
    const next: KeyboardSetup = {
      ...current,
      ...patch,
      id: newId(),
      revision: current.revision + 1,
      createdAt: new Date().toISOString(),
      browser: browserLabel(),
      changeReason: reason,
      geometryVersion: patch.geometryId ? geometryById(patch.geometryId).version : current.geometryVersion,
      geometryVerified: geometryChanged ? false : current.geometryVerified,
    };
    await repo.putSetup(next);
    this.applyUpserts({ setups: [next] });
    return next;
  }

  async saveCalibration(record: CalibrationRecord, markGeometryVerified = false): Promise<void> {
    const repo = this.requireRepo();
    const setup = currentSetup(this.state.data.setups);
    const setups: KeyboardSetup[] = [];
    if (markGeometryVerified && setup && !setup.geometryVerified && record.setupRevisionId === setup.id) {
      // Verification is a fact about this revision; it does not start a new series.
      setups.push({ ...setup, geometryVerified: true });
    }
    await repo.putMany({ calibrations: [record], setups });
    this.applyUpserts({ calibrations: [record], setups });
  }

  async reviseLedger(mode: ModeId, changes: { entries?: readonly LedgerEntry[]; zones?: readonly Zone[] }, reason: string | null): Promise<FingeringLedger | null> {
    const repo = this.requireRepo();
    const setup = currentSetup(this.state.data.setups);
    const previous = currentLedger(this.state.data.ledgers, mode, setup?.setupId ?? null);
    if (!previous) return null;
    const next = reviseLedgerRecord(previous, {
      id: newId(),
      createdAt: new Date().toISOString(),
      effectiveDate: this.state.today,
      ...(changes.entries ? { entries: changes.entries } : {}),
      ...(changes.zones ? { zones: changes.zones } : {}),
      reason,
    });
    await repo.putLedger(next);
    this.applyUpserts({ ledgers: [next] });
    return next;
  }

  private modeState(mode: ModeId): ModeState {
    return (
      this.state.data.modeStates.find((s) => s.mode === mode) ?? {
        schemaVersion: RECORD_SCHEMA_VERSION,
        mode,
        level: 0,
        stageProgress: 0,
        startedAt: null,
        history: [],
        comfortConfirmedAt: null,
        controlsCompletedAt: null,
      }
    );
  }

  async startMode(mode: ModeId): Promise<void> {
    const repo = this.requireRepo();
    const state = this.modeState(mode);
    if (state.startedAt) return;
    const now = new Date().toISOString();
    const next: ModeState = { ...state, startedAt: now, history: [...state.history, { level: state.level, from: null, at: now, reason: 'start', evidenceIds: [], note: null }] };
    await repo.putModeState(next);
    this.applyUpserts({ modeStates: [next] });
  }

  /** Manual level changes are logged plan overrides and confer no skill milestone. */
  async setLevel(mode: ModeId, level: Level, reason: 'manual' | 'assessment', evidenceIds: readonly string[] = [], note: string | null = null): Promise<void> {
    const repo = this.requireRepo();
    const state = this.modeState(mode);
    if (state.level === level) return;
    const now = new Date().toISOString();
    const next: ModeState = {
      ...state,
      level,
      startedAt: state.startedAt ?? now,
      stageProgress: level === 2 ? 0 : state.stageProgress,
      history: [...state.history, { level, from: state.level, at: now, reason, evidenceIds, note }],
    };
    const events: PlanEvent[] =
      reason === 'manual' ? [{ schemaVersion: RECORD_SCHEMA_VERSION, id: newId(), at: now, kind: 'level-change', mode, from: String(state.level), to: String(level), note }] : [];
    await repo.putMany({ modeStates: [next], planEvents: events });
    this.applyUpserts({ modeStates: [next], planEvents: events });
  }

  async updateModeState(mode: ModeId, patch: Partial<Pick<ModeState, 'stageProgress' | 'comfortConfirmedAt' | 'controlsCompletedAt'>>): Promise<void> {
    const repo = this.requireRepo();
    const next: ModeState = { ...this.modeState(mode), ...patch };
    await repo.putModeState(next);
    this.applyUpserts({ modeStates: [next] });
  }

  async recordPlanEvent(event: Omit<PlanEvent, 'schemaVersion' | 'id' | 'at'>): Promise<void> {
    const repo = this.requireRepo();
    const record: PlanEvent = { schemaVersion: RECORD_SCHEMA_VERSION, id: newId(), at: new Date().toISOString(), ...event };
    await repo.putPlanEvent(record);
    this.applyUpserts({ planEvents: [record] });
  }

  async setPrimaryMode(mode: ModeId, note: string | null): Promise<void> {
    const profile = this.state.data.profile;
    if (!profile || profile.primaryMode === mode) return;
    await this.recordPlanEvent({ kind: 'primary-change', mode, from: profile.primaryMode, to: mode, note });
    await this.updateProfile({ primaryMode: mode });
    await this.startMode(mode);
  }

  // -------------------------------------------------------------- sessions

  async putSession(session: SessionRecord): Promise<void> {
    const repo = this.requireRepo();
    await repo.putSession(session);
    this.applyUpserts({ sessions: [session] });
  }

  async putSet(set: BenchmarkSetRecord): Promise<void> {
    const repo = this.requireRepo();
    await repo.putSet(set);
    this.applyUpserts({ sets: [set] });
  }

  /** Update declarations on trials; awards are re-evaluated in the same step. */
  async updateDeclarations(updates: readonly { trialId: string; declarations: Declarations }[]): Promise<void> {
    const repo = this.requireRepo();
    const byId = new Map(this.state.data.trials.map((t) => [t.id, t]));
    const trials = updates.flatMap((u) => {
      const t = byId.get(u.trialId);
      return t ? [{ ...t, declarations: { ...u.declarations, updatedAt: new Date().toISOString() } }] : [];
    });
    const staged: Snapshot = { ...this.state.data, trials: upsert(this.state.data.trials, trials, (t) => t.id) };
    const awards = pendingAwards(staged, this.state.today, new Date().toISOString(), newId);
    await repo.putMany({ trials, milestones: awards.milestones, modeStates: awards.modeStates, core: awards.core ? [awards.core] : [] });
    this.applyUpserts({ trials, milestones: awards.milestones, modeStates: awards.modeStates, core: awards.core ? [awards.core] : [] });
  }

  /** Evaluate and store any newly earned awards. */
  async applyAwards(): Promise<{ milestones: MilestoneRecord[]; core: CoreCompletionRecord | null }> {
    if (!this.writable) return { milestones: [], core: null };
    const awards = pendingAwards(this.state.data, this.state.today, new Date().toISOString(), newId);
    if (awards.milestones.length === 0 && awards.modeStates.length === 0 && !awards.core) return { milestones: [], core: null };
    const repo = this.requireRepo();
    await repo.putMany({ milestones: awards.milestones, modeStates: awards.modeStates, core: awards.core ? [awards.core] : [] });
    this.applyUpserts({ milestones: awards.milestones, modeStates: awards.modeStates, core: awards.core ? [awards.core] : [] });
    return { milestones: awards.milestones, core: awards.core };
  }

  async saveProbe(probe: SwitchProbeRecord): Promise<void> {
    const repo = this.requireRepo();
    await repo.putProbe(probe);
    this.applyUpserts({ probes: [probe] });
  }

  async saveCustomText(text: CustomText): Promise<void> {
    const repo = this.requireRepo();
    await repo.putCustomText(text);
    this.applyUpserts({ customTexts: [text] });
  }

  async updateUi(patch: Partial<Profile['ui']>): Promise<void> {
    const profile = this.state.data.profile;
    if (!profile) return;
    await this.updateProfile({ ui: { ...profile.ui, ...patch } });
  }

  dispose(): void {
    if (this.clock) clearInterval(this.clock);
    this.lease?.dispose();
    this.db?.close();
  }
}
