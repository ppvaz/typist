// Browser side of the two-machine coordinator. Keeps the connection state,
// samples the coordinator's clock (at least eight pings, minimum-RTT sample,
// refreshed before 30 s), converts the scheduled start into this machine's
// monotonic time, and exchanges only readiness, timing, status and final
// counters — never keystrokes.
import { type ClockEstimate, clockUsable, type DualManifest, estimateClock, MIN_CLOCK_SAMPLES, type PingSample, type Role, toLocal } from '../domain/dual';

export type DualPhase = 'disconnected' | 'connecting' | 'connected' | 'lobby' | 'scheduled' | 'running' | 'complete' | 'incomplete' | 'stopped' | 'cancelled' | 'error';

export interface PeerSide {
  readonly present: boolean;
  readonly ready: boolean;
  readonly armed: boolean;
  readonly clock: { readonly uncertaintyMs: number; readonly samples: number } | null;
}

export interface DualClientState {
  readonly phase: DualPhase;
  readonly room: string | null;
  readonly role: Role | null;
  readonly manifest: DualManifest | null;
  readonly manifestHash: string | null;
  readonly peers: { readonly left: PeerSide; readonly right: PeerSide } | null;
  readonly sides: { readonly left: unknown; readonly right: unknown } | null;
  readonly clock: ClockEstimate | null;
  /** The estimate that converted the scheduled start (later resyncs do not move it). */
  readonly startClock: ClockEstimate | null;
  /** Scheduled start on this machine's performance.now() scale. */
  readonly localStart: number | null;
  readonly durationMs: number | null;
  readonly go: boolean;
  readonly results: { readonly left: unknown; readonly right: unknown } | null;
  readonly message: string | null;
  /** Code of the last error the coordinator sent (e.g. role-taken). */
  readonly lastError: string | null;
  readonly stoppedBy: Role | null;
  /** The reason the stopping side gave. */
  readonly stopReason: string | null;
}

const INITIAL: DualClientState = {
  phase: 'disconnected',
  room: null,
  role: null,
  manifest: null,
  manifestHash: null,
  peers: null,
  sides: null,
  clock: null,
  startClock: null,
  localStart: null,
  durationMs: null,
  go: false,
  results: null,
  message: null,
  lastError: null,
  stoppedBy: null,
  stopReason: null,
};

type Listener = () => void;

export class DualClient {
  private ws: WebSocket | null = null;
  private stateValue: DualClientState = INITIAL;
  private readonly listeners = new Set<Listener>();
  private samples: PingSample[] = [];
  private pending = new Map<number, number>();
  private pingId = 0;
  private resync: ReturnType<typeof setInterval> | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  getState = (): DualClientState => this.stateValue;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<DualClientState>): void {
    this.stateValue = { ...this.stateValue, ...patch };
    for (const l of this.listeners) l();
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  connect(): Promise<void> {
    this.set({ phase: 'connecting', message: null });
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.set({ phase: 'error', message: `Cannot reach the coordinator: ${e instanceof Error ? e.message : String(e)}` });
        reject(e);
        return;
      }
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.set({ phase: 'connected' });
        resolve();
      });
      ws.addEventListener('error', () => {
        this.set({ phase: 'error', message: 'The coordinator is not reachable. Solo practice still works without it.' });
        reject(new Error('unreachable'));
      });
      ws.addEventListener('close', () => {
        const s = this.stateValue;
        const running = s.phase === 'scheduled' || s.phase === 'running';
        this.set({ phase: running ? 'incomplete' : s.phase === 'complete' ? 'complete' : 'disconnected', message: running ? 'The connection to the coordinator was lost; this run is incomplete. Local work is kept.' : s.message });
        if (this.resync) clearInterval(this.resync);
      });
      ws.addEventListener('message', (event) => this.onMessage(JSON.parse(String(event.data)) as Record<string, unknown>));
    });
  }

  private onMessage(m: Record<string, unknown>): void {
    switch (m.type) {
      case 'room':
        this.set({ phase: 'lobby', room: String(m.room), role: m.role as Role, message: null, lastError: null });
        void this.syncClock();
        this.resync = setInterval(() => void this.syncClock(), 20_000);
        return;
      case 'pong': {
        const sentAt = this.pending.get(Number(m.id));
        if (sentAt === undefined) return;
        this.pending.delete(Number(m.id));
        this.samples.push({ sentAt, serverAt: Number(m.server), receivedAt: performance.now() });
        return;
      }
      case 'peers': {
        const patch: Partial<DualClientState> = { peers: { left: m.left as PeerSide, right: m.right as PeerSide }, sides: (m.sides as DualClientState['sides']) ?? null };
        // The other machine reset the room after a run: back to the lobby without a manifest.
        const terminal = this.stateValue.phase === 'complete' || this.stateValue.phase === 'stopped' || this.stateValue.phase === 'incomplete';
        if (m.status === 'lobby' && m.manifestHash === null && this.stateValue.manifest) {
          Object.assign(patch, { manifest: null, manifestHash: null, ...(terminal ? { phase: 'lobby', results: null, localStart: null, startClock: null, go: false, stoppedBy: null, stopReason: null, message: null } : {}) });
        }
        this.set(patch);
        return;
      }
      case 'manifest':
        this.set({ manifest: m.manifest as DualManifest, manifestHash: String(m.hash), results: null, go: false, localStart: null, startClock: null, stoppedBy: null, stopReason: null, message: null, phase: 'lobby' });
        return;
      case 'schedule': {
        const clock = this.stateValue.clock;
        if (!clock) return;
        const localStart = toLocal(Number(m.startAt), clock);
        this.set({ phase: 'scheduled', localStart, startClock: clock, durationMs: Number(m.durationMs), message: null });
        this.send({ type: 'schedule-ack', startAt: m.startAt });
        return;
      }
      case 'go':
        this.set({ phase: 'running', go: true });
        return;
      case 'cancel':
        this.set({ phase: 'lobby', localStart: null, startClock: null, go: false, message: String(m.reason) });
        return;
      case 'stopped':
        this.set({ phase: 'stopped', stoppedBy: m.by as Role, stopReason: String(m.reason), message: `Stopped by the ${String(m.by)} side: ${String(m.reason)}` });
        return;
      case 'peer-left':
        this.set({ phase: m.incomplete ? 'incomplete' : this.stateValue.phase, message: m.incomplete ? `The ${String(m.role)} side disconnected; this run is incomplete. Local work is kept.` : `The ${String(m.role)} side left the room.` });
        return;
      case 'complete': {
        // Both results arrived; the coordinator's status says whether the shared interval itself completed.
        const phase = m.status === 'complete' ? 'complete' : this.stateValue.phase === 'stopped' || m.status === 'stopped' ? 'stopped' : 'incomplete';
        this.set({ phase, results: { left: m.left, right: m.right } });
        return;
      }
      case 'expired':
        this.set({ phase: 'disconnected', message: 'The room expired after inactivity.' });
        return;
      case 'error':
        this.set({ message: String(m.message ?? m.code), lastError: String(m.code ?? 'error') });
        return;
      default:
    }
  }

  /** At least eight pings; keep the minimum-round-trip estimate. */
  async syncClock(count = MIN_CLOCK_SAMPLES + 2): Promise<ClockEstimate | null> {
    this.samples = [];
    for (let i = 0; i < count; i += 1) {
      const id = (this.pingId += 1);
      const t = performance.now();
      this.pending.set(id, t);
      this.send({ type: 'ping', id, t });
      await new Promise((r) => setTimeout(r, 40));
    }
    await new Promise((r) => setTimeout(r, 200));
    const estimate = estimateClock(this.samples);
    this.set({ clock: estimate });
    if (estimate) this.send({ type: 'clock', uncertaintyMs: estimate.uncertaintyMs, samples: estimate.samples });
    return estimate;
  }

  clockReady(): { ok: boolean; reason: string | null } {
    return clockUsable(this.stateValue.clock, performance.now());
  }

  create(role: Role): void {
    this.send({ type: 'create', role });
  }

  join(room: string, role: Role): void {
    this.send({ type: 'join', room, role });
  }

  announce(spec: unknown): void {
    this.send({ type: 'side', spec });
  }

  sendManifest(manifest: DualManifest): void {
    this.send({ type: 'manifest', manifest });
  }

  acknowledge(hash: string): void {
    this.send({ type: 'ready', hash });
  }

  async arm(): Promise<void> {
    if (!this.clockReady().ok) await this.syncClock();
    this.send({ type: 'arm' });
  }

  stop(reason: string): void {
    this.send({ type: 'stop', reason });
  }

  submit(result: Record<string, unknown>): void {
    this.send({ type: 'result', result });
  }

  reset(): void {
    this.set({ manifest: null, manifestHash: null, results: null, go: false, localStart: null, startClock: null, stoppedBy: null, stopReason: null, message: null, phase: 'lobby' });
    this.send({ type: 'reset' });
  }

  close(): void {
    if (this.resync) clearInterval(this.resync);
    this.send({ type: 'leave' });
    this.ws?.close();
    this.ws = null;
    this.set(INITIAL);
  }
}

/** The default coordinator endpoint: the origin that served this page. */
export function defaultCoordinatorUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/dual/ws`;
}
