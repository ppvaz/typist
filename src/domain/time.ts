// Wall-clock helpers. Measurements never use these; they use monotonic
// trial-relative milliseconds. These label records for history and scheduling.
// Local dates are YYYY-MM-DD strings in the profile's recorded time zone, and
// date arithmetic on them is plain calendar arithmetic.

export function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** ISO local date (YYYY-MM-DD) of an instant in the given IANA time zone. */
export function localDateIn(timeZone: string, epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(epochMs);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function utcIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function parts(localDate: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new Error(`Not a local date: ${localDate}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** YYYY-MM-DD plus whole days. */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = parts(localDate);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(localDate: string): number {
  const [y, m, d] = parts(localDate);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday that starts the ISO week containing `localDate`. */
export function weekStart(localDate: string): string {
  return addDays(localDate, 1 - isoWeekday(localDate));
}

export function monthOf(localDate: string): string {
  return localDate.slice(0, 7);
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function weekdayName(isoDay: number): string {
  return WEEKDAY_NAMES[isoDay - 1] ?? '';
}

/** "Thursday 17 September 2026". */
export function longDate(localDate: string): string {
  const [y, m, d] = parts(localDate);
  return `${weekdayName(isoWeekday(localDate))} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** "17 Sep". */
export function shortDate(localDate: string): string {
  const [, m, d] = parts(localDate);
  return `${String(d).padStart(2, '0')} ${(MONTH_NAMES[m - 1] ?? '').slice(0, 3)}`;
}

/** "17 Sep 2026". */
export function mediumDate(localDate: string): string {
  const [y] = parts(localDate);
  return `${shortDate(localDate)} ${y}`;
}

export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
