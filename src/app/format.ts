// Display formatting. Values are stored unrounded; rounding happens only here
// (WPM to one decimal, accuracy to two). Missing data is named, never zero.
import { formatAccuracy, formatWpm } from '../domain/scoring/metrics';
import type { Fraction } from '../domain/scoring/fraction';
import type { GlanceDeclaration, TrialRecord } from '../domain/records';

export function wpmOf(trial: Pick<TrialRecord, 'counters' | 'activeMs'>): string | null {
  if (trial.counters.attempts === 0) return null;
  return formatWpm(trial.counters.finalCorrect, trial.activeMs);
}

export function rawWpmOf(trial: Pick<TrialRecord, 'counters' | 'activeMs'>): string | null {
  if (trial.counters.attempts === 0) return null;
  return formatWpm(trial.counters.attempts, trial.activeMs);
}

export function accuracyOf(trial: Pick<TrialRecord, 'counters'>): string | null {
  return formatAccuracy(trial.counters.attemptsCorrect, trial.counters.attempts);
}

export function fractionWpm(f: Fraction | null): string | null {
  return f ? f.format(1) : null;
}

export function fractionAccuracy(f: Fraction | null): string | null {
  return f ? f.format(2) : null;
}

export function clock(ms: number | null): string {
  if (ms === null) return '–';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function seconds(ms: number | null, decimals = 1): string {
  return ms === null ? '–' : `${(ms / 1000).toFixed(decimals)} s`;
}

export function glancesLabel(g: GlanceDeclaration | null): string {
  if (g === null) return 'Not declared';
  if (g.kind === 'unknown') return 'Unknown';
  if (g.kind === 'at-least') return `${g.count}+ (estimate)`;
  return String(g.count);
}

export function timeOfDay(iso: string | null, timeZone?: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function percent(fraction: Fraction | null, decimals = 1): string | null {
  return fraction ? fraction.mul(100).format(decimals) : null;
}

export function bytes(n: number | undefined): string {
  if (n === undefined) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** A readable label for a physical key position. */
export function codeLabel(code: string): string {
  return code;
}

export function charLabel(c: string): string {
  if (c === ' ') return 'Space';
  if (c === '\n') return 'Enter';
  return c;
}
