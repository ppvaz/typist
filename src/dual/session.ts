// The two-machine session outlives any one screen: the room connection stays
// open while the user calibrates, measures a baseline or runs the shared
// interval. It also records the coordinator's verdict on this machine's side
// record and keeps the other side's final counters as a relay copy.
import type { AppStore } from '../app/store/AppStore';
import { type Baseline, BASELINE_MAX_AGE_DAYS, type DualLevel, type DualRunRecord, dualRecordId, type Role, type SideResult, soloBaseline } from '../domain/dual';
import type { ModeId } from '../domain/modes';
import type { TrialRecord } from '../domain/records';
import { daysBetween } from '../domain/time';
import { DualClient, defaultCoordinatorUrl, type DualClientState } from './client';
import { COPY_TASK_CLASSES, taskClassOf } from './tasks';

export const BASELINE_PROTOCOL = 'dual-solo-copy-60-v1';

/** The latest three completed, verified cue-started solo trials for this mode, setup and task class. */
export function matchedBaseline(trials: readonly TrialRecord[], mode: ModeId, taskClass: string, setupRevisionId: string): Baseline | null {
  const candidates = trials
    .filter(
      (t) =>
        t.mode === mode &&
        t.protocolId === BASELINE_PROTOCOL &&
        t.status === 'completed' &&
        t.verification === 'verified' &&
        t.setup.setupRevisionId === setupRevisionId &&
        taskClassOf(t.exercise) === taskClass &&
        t.metrics.wpm !== null,
    )
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
    .map((t) => ({ id: t.id, wpm: t.metrics.wpm as number, localDate: t.localDate, setupRevisionId: t.setup.setupRevisionId, taskClass, mode: t.mode }));
  return soloBaseline(candidates);
}

export function baselineFresh(baseline: Baseline, today: string): boolean {
  return daysBetween(baseline.latestDate, today) <= BASELINE_MAX_AGE_DAYS;
}

/** What a side tells the room about itself: never typed text. */
export interface SideAnnouncement {
  readonly mode: ModeId;
  readonly setupRevisionId: string;
  readonly layoutRevision: string;
  /** Trial IDs of the matched baseline for each copy task class this side has. */
  readonly baselines: Readonly<Record<string, readonly string[]>>;
}

export function announcementFor(trials: readonly TrialRecord[], mode: ModeId, setupRevisionId: string, layoutRevision: string): SideAnnouncement {
  const baselines: Record<string, readonly string[]> = {};
  for (const c of COPY_TASK_CLASSES) {
    const b = matchedBaseline(trials, mode, c, setupRevisionId);
    if (b) baselines[c] = b.trialIds;
  }
  return { mode, setupRevisionId, layoutRevision, baselines };
}

export interface DualChoice {
  readonly role: Role;
  readonly mode: ModeId;
  readonly level: DualLevel;
  readonly url: string;
  readonly placement: string;
}

type Verdict = DualRunRecord['coordinated'];

function verdictOf(state: DualClientState): Verdict {
  switch (state.phase) {
    case 'complete':
      return 'complete';
    case 'stopped':
      return 'stopped';
    case 'incomplete':
    case 'disconnected':
    case 'error':
      return 'incomplete';
    default:
      return 'pending';
  }
}

class DualSession {
  client: DualClient | null = null;
  choice: DualChoice = { role: 'left', mode: 'QL', level: 'D1', url: typeof location === 'undefined' ? '' : defaultCoordinatorUrl(), placement: '' };
  /** This machine's record for the run it last submitted. */
  local: DualRunRecord | null = null;
  private store: AppStore | null = null;
  private unsubscribe: (() => void) | null = null;
  private settledKey = '';
  private readonly listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  setChoice(patch: Partial<DualChoice>): void {
    this.choice = { ...this.choice, ...patch };
    this.changed();
  }

  async open(store: AppStore, action: 'create' | 'join', room = ''): Promise<void> {
    this.close();
    this.store = store;
    const client = new DualClient(this.choice.url);
    this.client = client;
    this.unsubscribe = client.subscribe(() => void this.settle());
    this.changed();
    try {
      await client.connect();
    } catch {
      return; // The client state carries the message.
    }
    if (action === 'create') client.create(this.choice.role);
    else client.join(room.trim(), this.choice.role);
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.client?.close();
    this.client = null;
    this.local = null;
    this.changed();
  }

  /** Save this side locally first, then send its final counters to the room. */
  async submit(record: DualRunRecord): Promise<void> {
    this.local = record;
    this.settledKey = '';
    await this.store?.saveDualRuns([record]);
    this.client?.submit(record.result as unknown as Record<string, unknown>);
    this.changed();
    await this.settle();
  }

  /** Record the coordinator's verdict (once) and the other side's counters. */
  private async settle(): Promise<void> {
    const client = this.client;
    const local = this.local;
    const store = this.store;
    if (!client || !local || !store) return;
    const s = client.getState();
    if (s.manifest && s.manifest.runId !== local.runId) {
      // A new run replaced this one before any verdict: it stays incomplete.
      if (local.coordinated === 'pending') await store.saveDualRuns([{ ...local, coordinated: 'incomplete' }]);
      this.local = null;
      return;
    }
    const verdict = verdictOf(s);
    if (verdict === 'pending') return;
    const final = local.coordinated === 'pending' ? verdict : local.coordinated;
    const otherRole: Role = local.role === 'left' ? 'right' : 'left';
    const results = s.results as { left: SideResult | null; right: SideResult | null } | null;
    const other = results?.[otherRole] ?? null;
    const key = `${local.runId}:${final}:${other ? 'other' : '-'}:${s.stoppedBy ?? ''}`;
    if (key === this.settledKey) return;
    this.settledKey = key;
    const next: DualRunRecord = { ...local, coordinated: final, stoppedBy: s.stoppedBy ?? local.stoppedBy, stopReason: s.stoppedBy ? s.stopReason : local.stopReason };
    this.local = next;
    const records: DualRunRecord[] = [next];
    const otherId = dualRecordId(local.runId, otherRole);
    const existing = store.getState().data.dualRuns.find((r) => r.id === otherId);
    if (other && other.runId === local.runId && other.manifestHash === local.manifestHash && other.role === otherRole && (!existing || existing.source === 'relay')) {
      records.push({
        id: otherId,
        runId: local.runId,
        role: otherRole,
        source: 'relay',
        level: local.level,
        localDate: local.localDate,
        manifestHash: local.manifestHash,
        manifest: local.manifest,
        result: other,
        stream: null,
        coordinated: final,
        stoppedBy: next.stoppedBy,
        stopReason: next.stopReason,
        placement: null,
        notes: null,
        compositionText: null,
        savedAt: new Date().toISOString(),
      });
    }
    await store.saveDualRuns(records);
    this.changed();
  }
}

export const dualSession = new DualSession();
