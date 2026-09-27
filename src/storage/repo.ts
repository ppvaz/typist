// Repository over IndexedDB. Every write runs in one transaction that first
// verifies this tab still holds the writer lease, so a second tab can never
// write a competing active trial. "Saved" is reported only after a
// transaction commits; failures are surfaced, never swallowed.
import type { IDBPTransaction, StoreNames } from 'idb';
import type {
  BenchmarkSetRecord,
  CalibrationRecord,
  CoreCompletionRecord,
  CustomText,
  EventChunk,
  FingeringLedger,
  KeyboardSetup,
  MilestoneRecord,
  ModeState,
  PlanEvent,
  Profile,
  SessionRecord,
  StoredExercise,
  SwitchProbeRecord,
  TrialRecord,
} from '../domain/records';
import type { DualRunRecord } from '../domain/dual';
import type { Exercise } from '../domain/exercises/exercise';
import type { TrialEvent } from '../domain/scoring/engine';
import type { LeaseRecord, TypistDB, TypistSchema } from './db';

export type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'saved'; readonly at: number }
  | { readonly status: 'failed'; readonly at: number; readonly error: string };

export class LeaseLostError extends Error {
  constructor() {
    super('This tab is no longer the active writer for Typist.');
    this.name = 'LeaseLostError';
  }
}

export class StorageWriteError extends Error {
  constructor(message: string, readonly original: unknown) {
    super(message);
    this.name = 'StorageWriteError';
  }
}

export interface Snapshot {
  readonly profile: Profile | null;
  readonly setups: readonly KeyboardSetup[];
  readonly calibrations: readonly CalibrationRecord[];
  readonly ledgers: readonly FingeringLedger[];
  readonly modeStates: readonly ModeState[];
  readonly sessions: readonly SessionRecord[];
  readonly trials: readonly TrialRecord[];
  readonly sets: readonly BenchmarkSetRecord[];
  readonly milestones: readonly MilestoneRecord[];
  readonly core: readonly CoreCompletionRecord[];
  readonly probes: readonly SwitchProbeRecord[];
  readonly planEvents: readonly PlanEvent[];
  readonly customTexts: readonly CustomText[];
  readonly dualRuns: readonly DualRunRecord[];
}

export const LEASE_TTL_MS = 10_000;

type Stores = StoreNames<TypistSchema>;
type WriteTx<S extends Stores[]> = IDBPTransaction<TypistSchema, S, 'readwrite'>;

/** Extra records written atomically with a trial's final state. */
export interface TrialCommit {
  readonly trial: TrialRecord;
  readonly chunk?: EventChunk | null;
  readonly set?: BenchmarkSetRecord | null;
  readonly session?: SessionRecord | null;
  readonly milestones?: readonly MilestoneRecord[];
  readonly core?: CoreCompletionRecord | null;
  readonly modeState?: ModeState | null;
}

function describe(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'The browser refused to store more data (storage is full).';
    return `${error.name}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export class Repository {
  readonly db: TypistDB;
  readonly holderId: string;
  private saveStateValue: SaveState = { status: 'idle' };
  private readonly listeners = new Set<(state: SaveState) => void>();
  /** Test hooks: fail the next write, or the next trial commit, with this error. */
  failNextWrite: Error | null = null;
  failNextCommit: Error | null = null;

  constructor(db: TypistDB, holderId: string) {
    this.db = db;
    this.holderId = holderId;
  }

  get saveState(): SaveState {
    return this.saveStateValue;
  }

  onSaveState(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setSaveState(state: SaveState): void {
    this.saveStateValue = state;
    for (const l of this.listeners) l(state);
  }

  async loadSnapshot(): Promise<Snapshot> {
    const tx = this.db.transaction(
      ['profile', 'setups', 'calibrations', 'ledgers', 'modeStates', 'sessions', 'trials', 'sets', 'milestones', 'core', 'probes', 'planEvents', 'customTexts', 'dualRuns'],
      'readonly',
    );
    const [profiles, setups, calibrations, ledgers, modeStates, sessions, trials, sets, milestones, core, probes, planEvents, customTexts, dualRuns] = await Promise.all([
      tx.objectStore('profile').getAll(),
      tx.objectStore('setups').getAll(),
      tx.objectStore('calibrations').getAll(),
      tx.objectStore('ledgers').getAll(),
      tx.objectStore('modeStates').getAll(),
      tx.objectStore('sessions').getAll(),
      tx.objectStore('trials').getAll(),
      tx.objectStore('sets').getAll(),
      tx.objectStore('milestones').getAll(),
      tx.objectStore('core').getAll(),
      tx.objectStore('probes').getAll(),
      tx.objectStore('planEvents').getAll(),
      tx.objectStore('customTexts').getAll(),
      tx.objectStore('dualRuns').getAll(),
    ]);
    await tx.done;
    return { profile: profiles[0] ?? null, setups, calibrations, ledgers, modeStates, sessions, trials, sets, milestones, core, probes, planEvents, customTexts, dualRuns };
  }

  /**
   * Run a write transaction over `stores` (plus the lease record). The lease
   * must be held by this tab; it is extended as part of the same transaction.
   */
  async write<S extends Stores>(stores: readonly S[], fn: (tx: WriteTx<(S | 'meta')[]>) => Promise<void>, options: { track?: boolean } = {}): Promise<void> {
    const track = options.track ?? true;
    if (track) this.setSaveState({ status: 'saving' });
    try {
      if (this.failNextWrite) {
        const error = this.failNextWrite;
        this.failNextWrite = null;
        throw error;
      }
      const names = [...new Set<S | 'meta'>(['meta', ...stores])];
      const tx = this.db.transaction(names, 'readwrite') as unknown as WriteTx<(S | 'meta')[]>;
      const meta = tx.objectStore('meta');
      const lease = (await meta.get('lease')) as LeaseRecord | undefined;
      if (!lease || lease.holderId !== this.holderId) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new LeaseLostError();
      }
      await meta.put({ ...lease, expiresAt: Date.now() + LEASE_TTL_MS });
      await fn(tx);
      await tx.done;
      if (track) this.setSaveState({ status: 'saved', at: Date.now() });
    } catch (error) {
      if (error instanceof LeaseLostError) {
        if (track) this.setSaveState({ status: 'failed', at: Date.now(), error: error.message });
        throw error;
      }
      const message = describe(error);
      if (track) this.setSaveState({ status: 'failed', at: Date.now(), error: message });
      throw new StorageWriteError(message, error);
    }
  }

  // ------------------------------------------------------------- simple puts

  putProfile(profile: Profile): Promise<void> {
    return this.write(['profile'], async (tx) => {
      await tx.objectStore('profile').put(profile);
    });
  }

  putSetup(setup: KeyboardSetup): Promise<void> {
    return this.write(['setups'], async (tx) => {
      await tx.objectStore('setups').put(setup);
    });
  }

  putCalibration(calibration: CalibrationRecord): Promise<void> {
    return this.write(['calibrations'], async (tx) => {
      await tx.objectStore('calibrations').put(calibration);
    });
  }

  putLedger(ledger: FingeringLedger): Promise<void> {
    return this.write(['ledgers'], async (tx) => {
      await tx.objectStore('ledgers').put(ledger);
    });
  }

  putModeState(state: ModeState): Promise<void> {
    return this.write(['modeStates'], async (tx) => {
      await tx.objectStore('modeStates').put(state);
    });
  }

  putSession(session: SessionRecord): Promise<void> {
    return this.write(['sessions'], async (tx) => {
      await tx.objectStore('sessions').put(session);
    });
  }

  putPlanEvent(event: PlanEvent): Promise<void> {
    return this.write(['planEvents'], async (tx) => {
      await tx.objectStore('planEvents').put(event);
    });
  }

  putCustomText(text: CustomText): Promise<void> {
    return this.write(['customTexts'], async (tx) => {
      await tx.objectStore('customTexts').put(text);
    });
  }

  putProbe(probe: SwitchProbeRecord): Promise<void> {
    return this.write(['probes'], async (tx) => {
      await tx.objectStore('probes').put(probe);
    });
  }

  putDualRuns(records: readonly DualRunRecord[]): Promise<void> {
    return this.write(['dualRuns'], async (tx) => {
      for (const r of records) await tx.objectStore('dualRuns').put(r);
    });
  }

  putSet(set: BenchmarkSetRecord): Promise<void> {
    return this.write(['sets'], async (tx) => {
      await tx.objectStore('sets').put(set);
    });
  }

  /** Several records in one transaction: setup revision, ledgers, mode states, profile. */
  putMany(records: {
    profile?: Profile;
    setups?: readonly KeyboardSetup[];
    ledgers?: readonly FingeringLedger[];
    modeStates?: readonly ModeState[];
    calibrations?: readonly CalibrationRecord[];
    planEvents?: readonly PlanEvent[];
    milestones?: readonly MilestoneRecord[];
    core?: readonly CoreCompletionRecord[];
    sessions?: readonly SessionRecord[];
    trials?: readonly TrialRecord[];
    sets?: readonly BenchmarkSetRecord[];
  }): Promise<void> {
    const stores: Stores[] = [];
    if (records.profile) stores.push('profile');
    if (records.setups?.length) stores.push('setups');
    if (records.ledgers?.length) stores.push('ledgers');
    if (records.modeStates?.length) stores.push('modeStates');
    if (records.calibrations?.length) stores.push('calibrations');
    if (records.planEvents?.length) stores.push('planEvents');
    if (records.milestones?.length) stores.push('milestones');
    if (records.core?.length) stores.push('core');
    if (records.sessions?.length) stores.push('sessions');
    if (records.trials?.length) stores.push('trials');
    if (records.sets?.length) stores.push('sets');
    if (stores.length === 0) return Promise.resolve();
    return this.write(stores, async (tx) => {
      const puts: Promise<unknown>[] = [];
      const t = tx as unknown as IDBPTransaction<TypistSchema, Stores[], 'readwrite'>;
      if (records.profile) puts.push(t.objectStore('profile').put(records.profile));
      for (const r of records.setups ?? []) puts.push(t.objectStore('setups').put(r));
      for (const r of records.ledgers ?? []) puts.push(t.objectStore('ledgers').put(r));
      for (const r of records.modeStates ?? []) puts.push(t.objectStore('modeStates').put(r));
      for (const r of records.calibrations ?? []) puts.push(t.objectStore('calibrations').put(r));
      for (const r of records.planEvents ?? []) puts.push(t.objectStore('planEvents').put(r));
      for (const r of records.milestones ?? []) puts.push(t.objectStore('milestones').put(r));
      for (const r of records.core ?? []) puts.push(t.objectStore('core').put(r));
      for (const r of records.sessions ?? []) puts.push(t.objectStore('sessions').put(r));
      for (const r of records.trials ?? []) puts.push(t.objectStore('trials').put(r));
      for (const r of records.sets ?? []) puts.push(t.objectStore('sets').put(r));
      await Promise.all(puts);
    });
  }

  // ------------------------------------------------------------------ trials

  /** Persist the frozen prompt and the running trial before any keystroke. */
  beginTrial(trial: TrialRecord, exercise: Exercise, extra: { set?: BenchmarkSetRecord | null; session?: SessionRecord | null } = {}): Promise<void> {
    const stores: ('exercises' | 'trials' | 'sets' | 'sessions')[] = ['exercises', 'trials'];
    if (extra.set) stores.push('sets');
    if (extra.session) stores.push('sessions');
    return this.write(
      stores,
      async (tx) => {
        const t = tx as unknown as IDBPTransaction<TypistSchema, Stores[], 'readwrite'>;
        const existing = await t.objectStore('exercises').get(exercise.sha256);
        if (!existing) await t.objectStore('exercises').put({ sha256: exercise.sha256, exercise, storedAt: new Date().toISOString() });
        await t.objectStore('trials').put(trial);
        if (extra.set) await t.objectStore('sets').put(extra.set);
        if (extra.session) await t.objectStore('sessions').put(extra.session);
      },
      { track: false },
    );
  }

  /** Append an event batch to the in-progress journal. */
  appendChunk(chunk: EventChunk, live?: TrialRecord): Promise<void> {
    return this.write(
      live ? ['events', 'trials'] : ['events'],
      async (tx) => {
        const t = tx as unknown as IDBPTransaction<TypistSchema, Stores[], 'readwrite'>;
        await t.objectStore('events').put(chunk);
        if (live) await t.objectStore('trials').put(live);
      },
      { track: false },
    );
  }

  /** Final trial counters and every derived update, in one transaction. */
  commitTrial(commit: TrialCommit): Promise<void> {
    if (this.failNextCommit) {
      this.failNextWrite = this.failNextCommit;
      this.failNextCommit = null;
    }
    const stores: Stores[] = ['trials'];
    if (commit.chunk) stores.push('events');
    if (commit.set) stores.push('sets');
    if (commit.session) stores.push('sessions');
    if (commit.milestones?.length) stores.push('milestones');
    if (commit.core) stores.push('core');
    if (commit.modeState) stores.push('modeStates');
    return this.write(stores, async (tx) => {
      const t = tx as unknown as IDBPTransaction<TypistSchema, Stores[], 'readwrite'>;
      const puts: Promise<unknown>[] = [t.objectStore('trials').put(commit.trial)];
      if (commit.chunk) puts.push(t.objectStore('events').put(commit.chunk));
      if (commit.set) puts.push(t.objectStore('sets').put(commit.set));
      if (commit.session) puts.push(t.objectStore('sessions').put(commit.session));
      for (const m of commit.milestones ?? []) puts.push(t.objectStore('milestones').put(m));
      if (commit.core) puts.push(t.objectStore('core').put(commit.core));
      if (commit.modeState) puts.push(t.objectStore('modeStates').put(commit.modeState));
      await Promise.all(puts);
    });
  }

  async loadEvents(trialId: string): Promise<TrialEvent[]> {
    const chunks = await this.db.getAllFromIndex('events', 'byTrial', trialId);
    return chunks.sort((a, b) => a.chunk - b.chunk).flatMap((c) => c.events);
  }

  async loadEventsFor(trialIds: readonly string[]): Promise<Map<string, TrialEvent[]>> {
    const out = new Map<string, TrialEvent[]>();
    const tx = this.db.transaction('events', 'readonly');
    const index = tx.store.index('byTrial');
    await Promise.all(
      trialIds.map(async (id) => {
        const chunks = await index.getAll(id);
        out.set(id, chunks.sort((a, b) => a.chunk - b.chunk).flatMap((c) => c.events));
      }),
    );
    await tx.done;
    return out;
  }

  async loadExercise(sha256: string): Promise<StoredExercise | undefined> {
    return this.db.get('exercises', sha256);
  }

  async runningTrials(): Promise<TrialRecord[]> {
    return this.db.getAllFromIndex('trials', 'byStatus', 'running');
  }

  /** Raw practice keystrokes older than the cutoff; evidence is never pruned. */
  async prunePracticeEvents(cutoffLocalDate: string, prunable: (trial: TrialRecord) => boolean): Promise<number> {
    const trials = (await this.db.getAll('trials')).filter((t) => t.localDate < cutoffLocalDate && !t.eventsPruned && t.status !== 'running' && prunable(t));
    let pruned = 0;
    for (const trial of trials) {
      await this.write(['events', 'trials'], async (tx) => {
        const t = tx as unknown as IDBPTransaction<TypistSchema, Stores[], 'readwrite'>;
        const keys = await t.objectStore('events').index('byTrial').getAllKeys(trial.id);
        for (const key of keys) await t.objectStore('events').delete(key);
        await t.objectStore('trials').put({ ...trial, eventsPruned: true });
      });
      pruned += 1;
    }
    return pruned;
  }
}
