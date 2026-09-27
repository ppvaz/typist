// Per-trial metrics (docs/measurement.md). Values are stored unrounded; gates
// use the exact comparisons in rational.ts; rounding is for display only.
import { formatRatio } from './rational';

export interface Counters {
  /** A: committed insertion attempts, including wrong ones and retries. */
  readonly attempts: number;
  /** C_attempt: attempts matching their target at insertion time. */
  readonly attemptsCorrect: number;
  /** C_final: positions correct in the final buffer. */
  readonly finalCorrect: number;
  /** E_final: incorrect positions remaining in the final buffer. */
  readonly residualErrors: number;
  /** Graphemes removed by Backspace. */
  readonly corrections: number;
  /** Backspaces pressed while the buffer was already empty. */
  readonly emptyBackspaces: number;
}

export interface Metrics {
  readonly wpm: number | null;
  readonly rawWpm: number | null;
  readonly accuracy: number | null;
}

export function computeMetrics(counters: Counters, activeMs: number | null): Metrics {
  const { attempts, attemptsCorrect, finalCorrect } = counters;
  if (attempts === 0) return { wpm: null, rawWpm: null, accuracy: null };
  const accuracy = (100 * attemptsCorrect) / attempts;
  if (activeMs === null || activeMs <= 0) return { wpm: null, rawWpm: null, accuracy };
  const minutes = activeMs / 60_000;
  return { wpm: finalCorrect / 5 / minutes, rawWpm: attempts / 5 / minutes, accuracy };
}

/** Attempt accuracy with two decimals, from the exact counter ratio. */
export function formatAccuracy(attemptsCorrect: number, attempts: number): string | null {
  if (attempts === 0) return null;
  return formatRatio(100n * BigInt(attemptsCorrect), BigInt(attempts), 2);
}

/** WPM with one decimal. Exact for integer millisecond durations. */
export function formatWpm(characters: number, activeMs: number | null): string | null {
  if (activeMs === null || activeMs <= 0) return null;
  if (Number.isInteger(activeMs)) return formatRatio(12_000n * BigInt(characters), BigInt(activeMs), 1);
  return ((characters / 5) / (activeMs / 60_000)).toFixed(1);
}
