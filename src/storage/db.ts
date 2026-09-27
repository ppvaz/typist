// IndexedDB schema. Canonical records live here; derived views (gates,
// maintenance, plans) are recomputed from them and never stored as truth,
// except historical events (milestones, core completion) that must keep the
// evidence that justified them.
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { DualRunRecord } from '../domain/dual';
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

export const DB_NAME = 'typist';
export const DB_VERSION = 1;

export interface MetaRecord {
  readonly key: string;
  readonly value: unknown;
}

export interface LeaseRecord {
  readonly key: 'lease';
  readonly holderId: string;
  readonly expiresAt: number;
  readonly acquiredAt: number;
}


export interface TypistSchema extends DBSchema {
  meta: { key: string; value: MetaRecord | LeaseRecord };
  profile: { key: string; value: Profile };
  setups: { key: string; value: KeyboardSetup; indexes: { bySetup: string } };
  calibrations: { key: string; value: CalibrationRecord; indexes: { bySetupRevision: string } };
  ledgers: { key: string; value: FingeringLedger; indexes: { byMode: string } };
  modeStates: { key: string; value: ModeState };
  sessions: { key: string; value: SessionRecord; indexes: { byDate: string; byStatus: string } };
  exercises: { key: string; value: StoredExercise };
  trials: { key: string; value: TrialRecord; indexes: { byMode: string; bySession: string; byStatus: string; byDate: string } };
  events: { key: [string, number]; value: EventChunk; indexes: { byTrial: string } };
  sets: { key: string; value: BenchmarkSetRecord; indexes: { byMode: string } };
  milestones: { key: string; value: MilestoneRecord; indexes: { byMode: string } };
  core: { key: string; value: CoreCompletionRecord };
  probes: { key: string; value: SwitchProbeRecord };
  planEvents: { key: string; value: PlanEvent };
  customTexts: { key: string; value: CustomText };
  dualRuns: { key: string; value: DualRunRecord };
}

export type StoreName =
  | 'meta'
  | 'profile'
  | 'setups'
  | 'calibrations'
  | 'ledgers'
  | 'modeStates'
  | 'sessions'
  | 'exercises'
  | 'trials'
  | 'events'
  | 'sets'
  | 'milestones'
  | 'core'
  | 'probes'
  | 'planEvents'
  | 'customTexts'
  | 'dualRuns';

/** Stores exported in a full backup, in dependency order. */
export const DATA_STORES: readonly Exclude<StoreName, 'meta'>[] = [
  'profile',
  'setups',
  'calibrations',
  'ledgers',
  'modeStates',
  'exercises',
  'sessions',
  'trials',
  'events',
  'sets',
  'milestones',
  'core',
  'probes',
  'planEvents',
  'customTexts',
  'dualRuns',
];

export type TypistDB = IDBPDatabase<TypistSchema>;

export async function openTypistDb(name = DB_NAME): Promise<TypistDB> {
  return openDB<TypistSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Version 1: initial schema. Future versions add migrations below and
      // must never delete the previous data before the new data is written.
      if (oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('profile', { keyPath: 'id' });
        db.createObjectStore('setups', { keyPath: 'id' }).createIndex('bySetup', 'setupId');
        db.createObjectStore('calibrations', { keyPath: 'id' }).createIndex('bySetupRevision', 'setupRevisionId');
        db.createObjectStore('ledgers', { keyPath: 'id' }).createIndex('byMode', 'mode');
        db.createObjectStore('modeStates', { keyPath: 'mode' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('byDate', 'localDate');
        sessions.createIndex('byStatus', 'status');
        db.createObjectStore('exercises', { keyPath: 'sha256' });
        const trials = db.createObjectStore('trials', { keyPath: 'id' });
        trials.createIndex('byMode', 'mode');
        trials.createIndex('bySession', 'sessionId');
        trials.createIndex('byStatus', 'status');
        trials.createIndex('byDate', 'localDate');
        db.createObjectStore('events', { keyPath: ['trialId', 'chunk'] }).createIndex('byTrial', 'trialId');
        db.createObjectStore('sets', { keyPath: 'id' }).createIndex('byMode', 'mode');
        db.createObjectStore('milestones', { keyPath: 'id' }).createIndex('byMode', 'mode');
        db.createObjectStore('core', { keyPath: 'id' });
        db.createObjectStore('probes', { keyPath: 'id' });
        db.createObjectStore('planEvents', { keyPath: 'id' });
        db.createObjectStore('customTexts', { keyPath: 'id' });
        db.createObjectStore('dualRuns', { keyPath: 'id' });
      }
    },
    blocking() {
      // Another tab wants a newer schema: let it proceed after this tab closes.
    },
  });
}
