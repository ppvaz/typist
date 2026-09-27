// Single-writer lease (docs/architecture.md, "Persistence and recovery").
// At most one tab writes a profile's data. The lease is a record checked and
// set inside one IndexedDB transaction, with an expiry so a crashed tab does
// not lock the data forever. Another tab gets read-only progress or an
// explicit takeover, which interrupts the old tab's run.
import type { LeaseRecord, TypistDB } from './db';
import { LEASE_TTL_MS } from './repo';

export const LEASE_RENEW_MS = 3_000;
const CHANNEL = 'typist-writer';

export type LeaseState = 'writer' | 'read-only' | 'lost';

export class WriterLease {
  private readonly db: TypistDB;
  readonly holderId: string;
  private stateValue: LeaseState = 'read-only';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<(state: LeaseState) => void>();
  private readonly channel: BroadcastChannel | null;
  private readonly pongs = new Set<string>();

  constructor(db: TypistDB, holderId: string) {
    this.db = db;
    this.holderId = holderId;
    this.channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<{ type: string; holderId: string; to?: string }>) => {
        if (event.data?.type === 'takeover' && event.data.holderId !== this.holderId && this.stateValue === 'writer') void this.verify();
        if (event.data?.type === 'released' && this.stateValue !== 'writer') this.emit(this.stateValue);
        // Answer liveness pings for our own lease.
        if (event.data?.type === 'ping' && event.data.to === this.holderId && this.stateValue === 'writer') this.channel?.postMessage({ type: 'pong', holderId: this.holderId });
        if (event.data?.type === 'pong') this.pongs.add(event.data.holderId);
      };
    }
  }

  get state(): LeaseState {
    return this.stateValue;
  }

  onChange(listener: (state: LeaseState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(state: LeaseState): void {
    this.stateValue = state;
    for (const l of this.listeners) l(state);
  }

  /** Current holder, if the lease is valid. */
  async holder(): Promise<LeaseRecord | null> {
    const lease = (await this.db.get('meta', 'lease')) as LeaseRecord | undefined;
    return lease && lease.expiresAt > Date.now() ? lease : null;
  }

  /**
   * Try to become the writer. Without `takeover`, an unexpired lease held by
   * another tab is respected. With it, the other tab loses the lease.
   */
  async acquire(takeover = false): Promise<boolean> {
    const tx = this.db.transaction('meta', 'readwrite');
    const now = Date.now();
    const lease = (await tx.store.get('lease')) as LeaseRecord | undefined;
    const free = !lease || lease.expiresAt <= now || lease.holderId === this.holderId;
    if (!free && !takeover) {
      await tx.done;
      this.emit('read-only');
      return false;
    }
    await tx.store.put({ key: 'lease', holderId: this.holderId, expiresAt: now + LEASE_TTL_MS, acquiredAt: now } satisfies LeaseRecord);
    await tx.done;
    if (takeover && lease && lease.holderId !== this.holderId) this.channel?.postMessage({ type: 'takeover', holderId: this.holderId });
    this.emit('writer');
    this.startRenewal();
    return true;
  }

  /**
   * Become the writer, unless a live tab holds the lease. A lease left by a
   * page that reloaded, crashed or closed has no one to answer the ping, so it
   * is claimed at once instead of waiting for it to expire.
   */
  async acquireUnlessLive(pingMs = 600): Promise<boolean> {
    if (await this.acquire(false)) return true;
    const holder = await this.holder();
    if (!holder || !this.channel) return this.acquire(false);
    this.pongs.delete(holder.holderId);
    this.channel.postMessage({ type: 'ping', holderId: this.holderId, to: holder.holderId });
    await new Promise((resolve) => setTimeout(resolve, pingMs));
    if (this.pongs.has(holder.holderId)) {
      this.emit('read-only');
      return false;
    }
    return this.acquire(true);
  }

  private startRenewal(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.renew(), LEASE_RENEW_MS);
  }

  private stopRenewal(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async renew(): Promise<void> {
    if (this.stateValue !== 'writer') return;
    try {
      const tx = this.db.transaction('meta', 'readwrite');
      const lease = (await tx.store.get('lease')) as LeaseRecord | undefined;
      if (!lease || lease.holderId !== this.holderId) {
        await tx.done;
        this.lose();
        return;
      }
      await tx.store.put({ ...lease, expiresAt: Date.now() + LEASE_TTL_MS });
      await tx.done;
    } catch {
      // A failed renewal is retried; writes themselves re-check the lease.
    }
  }

  async verify(): Promise<void> {
    const lease = (await this.db.get('meta', 'lease')) as LeaseRecord | undefined;
    if (!lease || lease.holderId !== this.holderId) this.lose();
  }

  private lose(): void {
    this.stopRenewal();
    this.emit('lost');
  }

  async release(): Promise<void> {
    this.stopRenewal();
    if (this.stateValue !== 'writer') return;
    try {
      const tx = this.db.transaction('meta', 'readwrite');
      const lease = (await tx.store.get('lease')) as LeaseRecord | undefined;
      if (lease?.holderId === this.holderId) await tx.store.delete('lease');
      await tx.done;
      this.channel?.postMessage({ type: 'released', holderId: this.holderId });
    } catch {
      // Expiry frees the lease anyway.
    }
    this.emit('read-only');
  }

  dispose(): void {
    this.stopRenewal();
    this.channel?.close();
  }
}
