// Exact non-negative rationals for comparisons built from several trials:
// medians of per-trial WPM, means of set medians, and loss fractions. Binary
// floating point must never decide whether a decline crosses 15%.
import { formatRatio, parseDecimal } from './rational';

export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    if (den === 0n) throw new Error('Fraction with zero denominator');
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num < 0n ? -num : num, den);
    this.num = g > 1n ? num / g : num;
    this.den = g > 1n ? den / g : den;
  }

  static of(num: bigint | number, den: bigint | number = 1n): Fraction {
    return new Fraction(BigInt(num), BigInt(den));
  }

  static readonly ZERO = new Fraction(0n, 1n);

  /** A decimal threshold such as "98.5" or 30. */
  static decimal(value: string | number): Fraction {
    const d = parseDecimal(value);
    return new Fraction(d.num, d.den);
  }

  /** Correct-output WPM: (chars / 5) / (ms / 60000) = 12000 * chars / ms. */
  static wpm(characters: number, activeMs: number): Fraction {
    if (!Number.isInteger(activeMs) || activeMs <= 0) throw new Error('WPM needs a positive integer duration');
    return new Fraction(12_000n * BigInt(characters), BigInt(activeMs));
  }

  /** Attempt accuracy in percent: 100 * correct / attempts. */
  static accuracy(correct: number, attempts: number): Fraction {
    if (attempts <= 0) throw new Error('Accuracy is undefined without attempts');
    return new Fraction(100n * BigInt(correct), BigInt(attempts));
  }

  add(other: Fraction): Fraction {
    return new Fraction(this.num * other.den + other.num * this.den, this.den * other.den);
  }

  sub(other: Fraction): Fraction {
    return new Fraction(this.num * other.den - other.num * this.den, this.den * other.den);
  }

  mul(other: Fraction | bigint | number): Fraction {
    const o = other instanceof Fraction ? other : Fraction.of(other);
    return new Fraction(this.num * o.num, this.den * o.den);
  }

  div(other: Fraction | bigint | number): Fraction {
    const o = other instanceof Fraction ? other : Fraction.of(other);
    return new Fraction(this.num * o.den, this.den * o.num);
  }

  compare(other: Fraction): -1 | 0 | 1 {
    const left = this.num * other.den;
    const right = other.num * this.den;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  lt(other: Fraction): boolean {
    return this.compare(other) < 0;
  }

  lte(other: Fraction): boolean {
    return this.compare(other) <= 0;
  }

  gt(other: Fraction): boolean {
    return this.compare(other) > 0;
  }

  gte(other: Fraction): boolean {
    return this.compare(other) >= 0;
  }

  eq(other: Fraction): boolean {
    return this.compare(other) === 0;
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }

  format(decimals: number): string {
    return formatRatio(this.num, this.den, decimals);
  }

  toJSON(): { num: string; den: string } {
    return { num: this.num.toString(), den: this.den.toString() };
  }

  static fromJSON(value: { num: string; den: string }): Fraction {
    return new Fraction(BigInt(value.num), BigInt(value.den));
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

/** Median of an odd or even number of values; even counts average the middle pair. */
export function median(values: readonly Fraction[]): Fraction | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.compare(b));
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as Fraction;
  if (sorted.length % 2 === 1) return upper;
  return (sorted[mid - 1] as Fraction).add(upper).div(2);
}

export function mean(values: readonly Fraction[]): Fraction | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum.add(v), Fraction.ZERO).div(values.length);
}

/** Median of plain numbers (for display statistics such as latency). */
export function numericMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
