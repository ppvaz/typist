import { describe, expect, it } from 'vitest';
import { BACKUP_STORES, type BackupRecords, buildEnvelope, csv, csvCell, planImport, validateEnvelope } from '../../src/domain/backup';
import { sha256Hex } from '../../src/domain/text/sha256';

function empty(): { -readonly [K in keyof BackupRecords]: Record<string, unknown>[] } {
  return Object.fromEntries(BACKUP_STORES.map((s) => [s, []])) as unknown as { -readonly [K in keyof BackupRecords]: Record<string, unknown>[] };
}

const counters = { attempts: 10, attemptsCorrect: 9, finalCorrect: 9, residualErrors: 0, corrections: 1 };
const trial = (id: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id,
  sessionId: null,
  mode: 'QL',
  protocolId: 'english-prose-60-v1',
  localDate: '2026-09-20',
  status: 'completed',
  origin: 'native-run',
  counters,
  activeMs: 60_000,
  declarations: { glances: { kind: 'exact', count: 0 } },
  ...extra,
});

function sample() {
  const records = empty();
  records.trials.push(trial('t1'), trial('t2'), trial('t3'));
  records.sets.push({ id: 's1', mode: 'QL', trialIds: ['t1', 't2', 't3'], localDate: '2026-09-20' });
  records.milestones.push({ id: 'm1', mode: 'QL', kind: 'advance', setIds: ['s1'] });
  const text = 'the quick fox';
  records.exercises.push({ sha256: sha256Hex(text), exercise: { text }, storedAt: '2026-09-20T10:00:00Z' });
  records.dualRuns.push({ id: 'run-1:left', runId: 'run-1' });
  return records;
}

describe('A18 backup validation', () => {
  it('accepts an intact export and summarizes it', () => {
    const result = validateEnvelope(JSON.parse(JSON.stringify(buildEnvelope(sample(), '1.0.0', '2026-09-27T08:00:00Z'))));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toMatchObject({ firstDate: '2026-09-20', milestones: 1, counts: { trials: 3, dualRuns: 1 } });
  });

  it('rejects a file changed after export', () => {
    const envelope = JSON.parse(JSON.stringify(buildEnvelope(sample(), '1.0.0', 'now')));
    envelope.records.trials[0].counters.finalCorrect = 8;
    const result = validateEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/checksum does not match/);
  });

  it('rejects newer formats, schemas and records without changing anything', () => {
    const envelope = buildEnvelope(sample(), '1.0.0', 'now');
    expect(validateEnvelope({ ...envelope, formatVersion: 2 })).toMatchObject({ ok: false, errors: [expect.stringMatching(/format 2 is newer/)] });
    expect(validateEnvelope({ ...envelope, schemaVersion: 9 })).toMatchObject({ ok: false, errors: [expect.stringMatching(/schema 9 is newer/)] });
    const records = sample();
    records.trials[0] = trial('t1', { schemaVersion: 2 });
    const newer = validateEnvelope(buildEnvelope(records, '1.0.0', 'now'));
    expect(newer.ok === false && newer.errors.join(' ')).toMatch(/record schema 2 is newer/);
    expect(validateEnvelope({ format: 'something-else' })).toMatchObject({ ok: false });
    expect(validateEnvelope('not an object')).toMatchObject({ ok: false });
  });

  it('rejects malformed records: duplicates, dangling references, bad counters, hash mismatches, unknown stores, broken text', () => {
    const cases: [string, (r: ReturnType<typeof sample>) => void, RegExp][] = [
      ['duplicate', (r) => r.trials.push(trial('t1')), /duplicate ID t1/],
      ['dangling set', (r) => r.sets.push({ id: 's2', mode: 'QL', trialIds: ['missing'], localDate: '2026-09-21' }), /missing trial missing/],
      ['dangling milestone', (r) => r.milestones.push({ id: 'm2', mode: 'QL', kind: 'acquired', setIds: ['nope'] }), /missing set nope/],
      ['counters', (r) => (r.trials[1] = trial('t2', { counters: { ...counters, attemptsCorrect: 11 } })), /counters are inconsistent/],
      ['hash', (r) => r.exercises.push({ sha256: 'a'.repeat(64), exercise: { text: 'other' } }), /does not match its hash/],
      ['surrogate', (r) => (r.trials[2] = trial('t3', { note: 'bad \ud800 text' })), /invalid character data/],
      ['date', (r) => (r.trials[0] = trial('t1', { localDate: '20/09/2026' })), /localDate is missing or invalid/],
    ];
    for (const [name, mutate, message] of cases) {
      const records = sample();
      mutate(records);
      const result = validateEnvelope(buildEnvelope(records, '1.0.0', 'now'));
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.errors.join(' '), name).toMatch(message);
    }
    const unknown = buildEnvelope(sample(), '1.0.0', 'now') as unknown as { records: Record<string, unknown> };
    unknown.records.passwords = [];
    expect(validateEnvelope(unknown)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/not a known record type/)]) });
  });
});

describe('A18 import planning', () => {
  it('merges new records as restored, and reimporting the same data adds nothing', () => {
    const local = empty();
    const incoming = sample();
    const first = planImport(local, incoming, 'merge');
    expect(first.conflicts).toEqual([]);
    expect(first.adds.trials).toHaveLength(3);
    expect(first.adds.trials.every((t) => t.origin === 'restored-typist')).toBe(true);
    // After applying the plan, the same file is idempotent even though provenance changed.
    const applied = empty();
    for (const s of BACKUP_STORES) applied[s].push(...first.adds[s]);
    const again = planImport(applied, incoming, 'merge');
    expect(again.conflicts).toEqual([]);
    expect(BACKUP_STORES.every((s) => again.adds[s].length === 0)).toBe(true);
    expect(again.identical).toBe(first.adds.trials.length + first.adds.sets.length + first.adds.milestones.length + first.adds.exercises.length + first.adds.dualRuns.length);
  });

  it('treats the same ID with different content as a conflict, and a different profile as a conflict', () => {
    const local = sample();
    const incoming = sample();
    incoming.trials[0] = trial('t1', { status: 'interrupted' });
    expect(planImport(local, incoming, 'merge').conflicts).toEqual([{ store: 'trials', key: 't1' }]);
    local.profile.push({ id: 'p-local' });
    incoming.profile.push({ id: 'p-other' });
    expect(planImport(local, incoming, 'merge').conflicts).toContainEqual({ store: 'profile', key: 'p-other' });
    // Replace ignores what is local.
    expect(planImport(local, incoming, 'replace').conflicts).toEqual([]);
  });
});

describe('CSV export', () => {
  it('quotes separators and neutralizes spreadsheet formulas', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell(null)).toBe('');
    expect(csv([['mode', 'wpm'], ['QL', 31.2]])).toBe('mode,wpm\r\nQL,31.2\r\n');
  });
});
