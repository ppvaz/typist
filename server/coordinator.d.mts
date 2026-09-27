// Types for the coordinator's exported functions (used by tests).
import type { Server } from 'node:http';
import type { WebSocketServer } from 'ws';

export const ROOM_IDLE_MS: number;
export const START_LEAD_MS: number;
export const ACK_DEADLINE_MS: number;
export function canonicalJson(value: unknown): string;
export function manifestHash(manifest: unknown): string;

export interface Coordinator {
  readonly rooms: Map<string, unknown>;
  connection(ws: unknown): void;
  sweep(): void;
}

export function createCoordinator(options?: { now?: () => number; log?: (message: string) => void }): Coordinator;

export function startServer(options?: {
  port?: number;
  host?: string;
  cert?: string | null;
  key?: string | null;
  http?: boolean;
  dist?: string;
  log?: (message: string) => void;
}): Promise<{ server: Server; coordinator: Coordinator; wss: WebSocketServer; port: number }>;
