// Backup, restore and CSV export (docs/architecture.md, "Import and export").
//
// A full backup is a JSON envelope with format/schema versions, export time,
// every record store, and a SHA-256 checksum over the canonical record JSON.
// The checksum detects accidental corruption; it is not proof of genuine
// performance. Import validates everything before any write, is idempotent
// for identical records, and rejects conflicting or newer data atomically.
import { canonicalJson } from './signature';
import { sha256Hex } from './text/sha256';

export const BACKUP_FORMAT = 'typist-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSION = 1;

export const BACKUP_STORES = [
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
] as const;

export type BackupStore = (typeof BACKUP_STORES)[number];
export type BackupRecords = { [K in BackupStore]: readonly Record<string, unknown>[] };

export interface BackupEnvelope {
  readonly format: typeof BACKUP_FORMAT;
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly exportedAt: string;
  readonly records: BackupRecords;
  readonly checksum: { readonly algorithm: 'sha-256'; readonly value: string };
}

/** The key each store uses; events use [trialId, chunk]. */
export function recordKey(store: BackupStore, record: Record<string, unknown>): string {
  switch (store) {
    case 'modeStates':
      return String(record.mode);
    case 'exercises':
      return String(record.sha256);
    case 'events':
      return `${String(record.trialId)}#${String(record.chunk)}`;
    default:
      return String(record.id);
  }
}

export function checksumOf(records: BackupRecords): string {
  return sha256Hex(canonicalJson(records));
}

export function buildEnvelope(records: BackupRecords, appVersion: string, exportedAt: string): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    appVersion,
    exportedAt,
    records,
    checksum: { algorithm: 'sha-256', value: checksumOf(records) },
  };
}

export interface BackupSummary {
  readonly counts: Readonly<Record<BackupStore, number>>;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
  readonly milestones: number;
}

export function summarize(records: BackupRecords): BackupSummary {
  const counts = Object.fromEntries(BACKUP_STORES.map((s) => [s, records[s]?.length ?? 0])) as Record<BackupStore, number>;
  const dates = [...(records.trials ?? []), ...(records.sessions ?? [])]
    .map((r) => r.localDate)
    .filter((d): d is string => typeof d === 'string')
    .sort();
  return { counts, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, milestones: counts.milestones };
}

export type ValidationResult = { readonly ok: true; readonly envelope: BackupEnvelope; readonly summary: BackupSummary } | { readonly ok: false; readonly errors: readonly string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isCount = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Unpaired surrogates would corrupt text; reject them. */
function validText(value: unknown): boolean {
  if (!isString(value)) return false;
  return !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value);
}

function checkStrings(value: unknown, path: string, errors: string[], depth = 0): void {
  if (depth > 12 || errors.length > 50) return;
  if (isString(value)) {
    if (!validText(value)) errors.push(`${path}: invalid character data.`);
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => checkStrings(v, `${path}[${i}]`, errors, depth + 1));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) checkStrings(v, `${path}.${k}`, errors, depth + 1);
}

function checkRecord(store: BackupStore, r: Record<string, unknown>, path: string, errors: string[]): void {
  const need = (field: string, ok: (v: unknown) => boolean) => {
    if (!ok(r[field])) errors.push(`${path}.${field} is missing or invalid.`);
  };
  if ('schemaVersion' in r && typeof r.schemaVersion === 'number' && r.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    errors.push(`${path}: record schema ${r.schemaVersion} is newer than this app supports.`);
  }
  switch (store) {
    case 'trials': {
      need('id', isString);
      need('mode', isString);
      need('protocolId', isString);
      need('localDate', (v) => isString(v) && ISO_DATE.test(v));
      need('status', isString);
      const c = r.counters;
      if (!isObject(c) || !['attempts', 'attemptsCorrect', 'finalCorrect', 'residualErrors', 'corrections'].every((k) => isCount(c[k]))) errors.push(`${path}.counters are missing or out of bounds.`);
      else if ((c.attemptsCorrect as number) > (c.attempts as number) || (c.finalCorrect as number) > (c.attemptsCorrect as number)) errors.push(`${path}.counters are inconsistent.`);
      if (r.activeMs !== null && r.activeMs !== undefined && !(typeof r.activeMs === 'number' && r.activeMs >= 0)) errors.push(`${path}.activeMs is out of bounds.`);
      const d = r.declarations;
      if (!isObject(d)) errors.push(`${path}.declarations are missing.`);
      else if (d.glances !== null && d.glances !== undefined) {
        const g = d.glances as Record<string, unknown>;
        if (!isObject(g) || !['exact', 'at-least', 'unknown'].includes(String(g.kind)) || (g.kind !== 'unknown' && !isCount(g.count))) errors.push(`${path}.declarations.glances is invalid.`);
      }
      break;
    }
    case 'events':
      need('trialId', isString);
      need('chunk', isCount);
      need('events', Array.isArray);
      break;
    case 'exercises':
      need('sha256', (v) => isString(v) && /^[0-9a-f]{64}$/.test(v));
      if (!isObject(r.exercise) || !isString(r.exercise.text)) errors.push(`${path}.exercise is missing its text.`);
      else if (sha256Hex((r.exercise.text as string).normalize('NFC')) !== r.sha256) errors.push(`${path}: exercise text does not match its hash.`);
      break;
    case 'modeStates':
      need('mode', isString);
      need('level', (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7);
      break;
    case 'sets':
      need('id', isString);
      need('mode', isString);
      need('trialIds', (v) => Array.isArray(v) && v.every(isString));
      need('localDate', (v) => isString(v) && ISO_DATE.test(v));
      break;
    case 'milestones':
      need('id', isString);
      need('mode', isString);
      need('kind', isString);
      need('setIds', (v) => Array.isArray(v) && v.every(isString));
      break;
    default:
      if (store !== 'profile' || 'id' in r) need('id', isString);
  }
}

/** Validate an untrusted parsed backup completely before anything is written. */
export function validateEnvelope(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ['The file is not a Typist backup (not a JSON object).'] };
  if (input.format !== BACKUP_FORMAT) return { ok: false, errors: ['The file is not a Typist backup (unknown format).'] };
  if (typeof input.formatVersion !== 'number' || input.formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, errors: [`Backup format ${String(input.formatVersion)} is newer than this app supports; nothing was changed.`] };
  }
  if (typeof input.schemaVersion !== 'number' || input.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    return { ok: false, errors: [`Backup schema ${String(input.schemaVersion)} is newer than this app supports; nothing was changed.`] };
  }
  if (!isObject(input.records)) return { ok: false, errors: ['The backup has no records.'] };
  const records = input.records as Record<string, unknown>;
  for (const store of BACKUP_STORES) {
    const list = records[store];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`records.${store} is not a list.`);
      continue;
    }
    const keys = new Set<string>();
    list.forEach((r, i) => {
      const path = `records.${store}[${i}]`;
      if (!isObject(r)) {
        errors.push(`${path} is not an object.`);
        return;
      }
      checkRecord(store, r, path, errors);
      const key = recordKey(store, r);
      if (keys.has(key)) errors.push(`${path}: duplicate ID ${key}.`);
      keys.add(key);
    });
  }
  for (const store of Object.keys(records)) if (!(BACKUP_STORES as readonly string[]).includes(store)) errors.push(`records.${store} is not a known record type.`);
  checkStrings(records, 'records', errors);
  if (errors.length > 0) return { ok: false, errors };
  const normalized = Object.fromEntries(BACKUP_STORES.map((s) => [s, (records[s] as Record<string, unknown>[] | undefined) ?? []])) as unknown as BackupRecords;
  // References: every set's trials, every trial's session, every milestone's sets.
  const trialIds = new Set(normalized.trials.map((t) => String(t.id)));
  const sessionIds = new Set(normalized.sessions.map((s) => String(s.id)));
  const setIds = new Set(normalized.sets.map((s) => String(s.id)));
  for (const s of normalized.sets) for (const id of s.trialIds as string[]) if (!trialIds.has(id)) errors.push(`Set ${String(s.id)} refers to a missing trial ${id}.`);
  for (const t of normalized.trials) if (t.sessionId !== null && t.sessionId !== undefined && !sessionIds.has(String(t.sessionId))) errors.push(`Trial ${String(t.id)} refers to a missing session.`);
  for (const m of normalized.milestones) for (const id of m.setIds as string[]) if (!setIds.has(id)) errors.push(`Milestone ${String(m.id)} refers to a missing set ${id}.`);
  for (const e of normalized.events) if (!trialIds.has(String(e.trialId))) errors.push(`Events refer to a missing trial ${String(e.trialId)}.`);
  const checksum = input.checksum;
  if (!isObject(checksum) || checksum.algorithm !== 'sha-256' || !isString(checksum.value)) errors.push('The backup has no checksum.');
  else if (checksumOf(normalized) !== checksum.value) errors.push('The checksum does not match: the file was changed or corrupted after export.');
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 40) };
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    formatVersion: input.formatVersion,
    schemaVersion: input.schemaVersion,
    appVersion: String(input.appVersion ?? ''),
    exportedAt: String(input.exportedAt ?? ''),
    records: normalized,
    checksum: checksum as BackupEnvelope['checksum'],
  };
  return { ok: true, envelope, summary: summarize(normalized) };
}

/** Provenance changes on restore; comparisons for idempotency ignore it. */
function comparable(record: Record<string, unknown>): string {
  const { origin: _origin, ...rest } = record;
  return canonicalJson(rest);
}

export interface ImportPlan {
  readonly mode: 'merge' | 'replace';
  readonly adds: { readonly [K in BackupStore]: readonly Record<string, unknown>[] };
  readonly identical: number;
  readonly conflicts: readonly { readonly store: BackupStore; readonly key: string }[];
}

/**
 * Merge: identical records are skipped, new ones added, and any record whose
 * ID exists with different content is a conflict that rejects the import.
 * Replace: everything local is replaced by the backup (after confirmation).
 */
export function planImport(existing: BackupRecords, incoming: BackupRecords, mode: 'merge' | 'replace'): ImportPlan {
  const adds = Object.fromEntries(BACKUP_STORES.map((s) => [s, [] as Record<string, unknown>[]])) as { [K in BackupStore]: Record<string, unknown>[] };
  const conflicts: { store: BackupStore; key: string }[] = [];
  let identical = 0;
  for (const store of BACKUP_STORES) {
    const local = new Map(mode === 'merge' ? existing[store].map((r) => [recordKey(store, r), r]) : []);
    for (const r of incoming[store]) {
      const key = recordKey(store, r);
      const current = local.get(key);
      const restored = 'origin' in r ? { ...r, origin: 'restored-typist' } : r;
      if (!current) adds[store].push(restored);
      else if (comparable(current) === comparable(r)) identical += 1;
      else conflicts.push({ store, key });
    }
  }
  // The profile is a singleton: a different local profile ID is a conflict in a merge.
  if (mode === 'merge' && existing.profile.length > 0 && incoming.profile.length > 0) {
    const a = existing.profile[0] as Record<string, unknown>;
    const b = incoming.profile[0] as Record<string, unknown>;
    if (a.id !== b.id) conflicts.push({ store: 'profile', key: String(b.id) });
  }
  return { mode, adds, identical, conflicts };
}

// ------------------------------------------------------------------- CSV

/** Quote a CSV cell and neutralize formula-leading text for spreadsheets. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csv(rows: readonly (readonly unknown[])[]): string {
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
