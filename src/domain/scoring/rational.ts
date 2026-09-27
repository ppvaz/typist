// Exact comparisons at gate boundaries. Thresholds are decimal strings such as
// "98" or "98.5"; counters are integers; nothing passes through binary
// floating point, so 97.995% can never round its way into a 98% gate.

export interface Decimal {
  readonly num: bigint;
  readonly den: bigint;
}

export function parseDecimal(value: string | number): Decimal {
  const text = typeof value === 'number' ? String(value) : value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Not a non-negative decimal: ${text}`);
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  return { num: BigInt(whole + fraction), den: 10n ** BigInt(fraction.length) };
}

/** 100 * correct / attempts >= threshold, compared exactly. False when attempts is 0. */
export function accuracyMeets(attemptsCorrect: number, attempts: number, thresholdPercent: string | number): boolean {
  if (attempts <= 0) return false;
  const t = parseDecimal(thresholdPercent);
  return 100n * BigInt(attemptsCorrect) * t.den >= t.num * BigInt(attempts);
}

/**
 * (finalCorrect / 5) / (activeMs / 60000) >= threshold, i.e.
 * 12000 * finalCorrect >= threshold * activeMs. `activeMs` must be an integer
 * number of milliseconds; reference trials last exactly 60000 ms.
 */
export function wpmMeets(finalCorrect: number, activeMs: number, thresholdWpm: string | number): boolean {
  if (!Number.isInteger(activeMs) || activeMs <= 0) return false;
  const t = parseDecimal(thresholdWpm);
  return 12000n * BigInt(finalCorrect) * t.den >= t.num * BigInt(activeMs);
}

/** Round num/den to `decimals` places, halves away from zero, as a string. */
export function formatRatio(num: bigint, den: bigint, decimals: number): string {
  if (den === 0n) throw new Error('Division by zero');
  const negative = num < 0n !== den < 0n && num !== 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const scale = 10n ** BigInt(decimals);
  const scaled = (n * scale * 2n + d) / (2n * d);
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}${decimals > 0 ? `.${fraction}` : ''}`;
}
