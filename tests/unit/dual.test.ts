import { describe, expect, it } from 'vitest';
import {
  type Baseline,
  bothStalled,
  checkManifestForRole,
  clockUsable,
  type CoordinatedRun,
  type DualManifest,
  dualEfficiency,
  estimateClock,
  coordinatedRuns,
  type DualRunRecord,
  dualRecordId,
  levelReady,
  manifestHash,
  mergeImportedSide,
  mergeSideFiles,
  runEfficiency,
  runViews,
  type SideResult,
  soloBaseline,
  stalls,
  stallSummary,
  substitutionCandidates,
  synchronized,
  throughputMilestone,
  toLocal,
} from '../../src/domain/dual';

const sync = { uncertaintyMs: 12, startLatenessMs: 8, samples: 8 };

function side(role: 'left' | 'right', wpm: number | null, extra: Partial<SideResult> = {}): SideResult {
  return {
    role,
    mode: role === 'left' ? 'QL' : 'DR',
    trialId: `${role}-trial`,
    runId: 'run-1',
    manifestHash: 'hash',
    status: 'completed',
    composition: false,
    wpm,
    accuracy: 99,
    productionWpm: null,
    deletions: null,
    glances: 0,
    sync,
    stalls: [],
    ...extra,
  };
}

const baseline = (medianWpm: number, latestDate = '2026-09-28'): Baseline => ({ mode: 'QL', medianWpm, trialIds: ['a', 'b', 'c'], latestDate, setupRevisionId: 's', taskClass: 'prose' });
const expect2 = { left: { setupRevisionId: 's', taskClass: 'prose' }, right: { setupRevisionId: 's', taskClass: 'prose' } };

describe('A22 dual comparison', () => {
  it('solo 30 + 40 and synchronized dual 18 + 22 give 57.14% efficiency', () => {
    const e = dualEfficiency(side('left', 18), side('right', 22), { left: baseline(30), right: baseline(40) }, expect2, '2026-09-30');
    expect(e.available).toBe(true);
    if (!e.available) return;
    expect(e.combinedWpm).toBe(40);
    expect((e.efficiency * 100).toFixed(2)).toBe('57.14');
    expect(e.leftCost).toBeCloseTo(0.4, 10);
    expect(e.rightCost).toBeCloseTo(0.45, 10);
  });

  it('shows no ratio for a missing, zero, stale or incomparable baseline, and never divides by zero', () => {
    const cases: [Baseline | null, RegExp][] = [
      [null, /missing/],
      [baseline(0), /zero/],
      [baseline(30, '2026-09-01'), /older than 7 days/],
      [{ ...baseline(30), taskClass: 'words' }, /different setup or task class/],
    ];
    for (const [left, reason] of cases) {
      const e = dualEfficiency(side('left', 18), side('right', 22), { left, right: baseline(40) }, expect2, '2026-09-30');
      expect(e.available).toBe(false);
      if (!e.available) expect(e.reasons.join(' ')).toMatch(reason);
    }
  });

  it('is not capped at 100%', () => {
    const e = dualEfficiency(side('left', 35), side('right', 45), { left: baseline(30), right: baseline(40) }, expect2, '2026-09-30');
    expect(e.available && e.efficiency).toBeCloseTo(80 / 70, 10);
  });

  it('A24: D5 copy side keeps its accuracy; the composition side has no accuracy and no copy efficiency', () => {
    const composition = side('right', null, { composition: true, accuracy: null, productionWpm: 21.4, deletions: 7 });
    const e = dualEfficiency(side('left', 18), composition, { left: baseline(30), right: baseline(40) }, expect2, '2026-09-30');
    expect(e.available).toBe(false);
    if (!e.available) expect(e.reasons[0]).toMatch(/composition side has no verified copy WPM/);
    const run: CoordinatedRun = { runId: 'run-1', localDate: '2026-09-30', level: 'D5', left: side('left', 18), right: composition };
    expect(throughputMilestone([run, { ...run, localDate: '2026-10-01' }, { ...run, localDate: '2026-10-02' }], baseline(10)).met).toBe(false);
  });

  it('the throughput milestone needs three dates with both sides at 98%, zero glances, above the two-hand baseline', () => {
    const run = (localDate: string, l = 30, r = 30, extra: Partial<SideResult> = {}): CoordinatedRun => ({ runId: 'run-1', localDate, level: 'D4', left: side('left', l, extra), right: side('right', r) });
    expect(throughputMilestone([run('2026-09-01'), run('2026-09-01'), run('2026-09-02')], baseline(50)).met).toBe(false);
    expect(throughputMilestone([run('2026-09-01'), run('2026-09-02'), run('2026-09-03')], baseline(50)).met).toBe(true);
    expect(throughputMilestone([run('2026-09-01'), run('2026-09-02'), run('2026-09-03', 30, 30, { glances: 1 })], baseline(50)).met).toBe(false);
    expect(throughputMilestone([run('2026-09-01', 20, 20), run('2026-09-02'), run('2026-09-03')], baseline(50)).met).toBe(false);
    expect(throughputMilestone([run('2026-09-01')], null).reasons).toEqual(['No matched two-hand baseline.']);
  });

  it('computes solo baselines as the median of three comparable trials', () => {
    const t = (id: string, wpm: number, localDate = '2026-09-29') => ({ id, wpm, localDate, setupRevisionId: 's', taskClass: 'prose', mode: 'QL' as const });
    expect(soloBaseline([t('a', 28), t('b', 30)])).toBeNull();
    expect(soloBaseline([t('a', 28), t('b', 30), t('c', 35)])?.medianWpm).toBe(30);
    expect(soloBaseline([t('a', 28), t('b', 30), { ...t('c', 35), taskClass: 'words' }])).toBeNull();
  });
});

describe('A23 coordination rules', () => {
  const manifest: DualManifest = {
    runId: 'run-1',
    protocolId: 'dual-copy-60-v1',
    scorerVersion: 'typist-scorer-v1',
    level: 'D4',
    durationMs: 60_000,
    seed: 7,
    createdAt: '2026-09-30T10:00:00Z',
    left: { role: 'left', mode: 'QL', layoutRevision: 'qwerty-us@1', setupRevisionId: 'sl', taskId: 'en-prose-v1/p01', taskSha256: 'x', taskClass: 'prose', composition: false, baselineTrialIds: [] },
    right: { role: 'right', mode: 'DR', layoutRevision: 'dvorak-right-us@1', setupRevisionId: 'sr', taskId: 'en-prose-v1/p02', taskSha256: 'y', taskClass: 'prose', composition: false, baselineTrialIds: [] },
  };

  it('hashes manifests canonically and rejects a swapped role or mode', () => {
    expect(manifestHash(manifest)).toBe(manifestHash({ ...manifest }));
    expect(manifestHash({ ...manifest, seed: 8 })).not.toBe(manifestHash(manifest));
    expect(checkManifestForRole(manifest, 'left', { mode: 'QL', setupRevisionId: 'sl' })).toEqual([]);
    expect(checkManifestForRole(manifest, 'right', { mode: 'QL', setupRevisionId: 'sl' }).length).toBeGreaterThan(0);
  });

  it('estimates the clock from the minimum-round-trip sample', () => {
    const samples = [
      { sentAt: 1000, serverAt: 5060, receivedAt: 1100 },
      { sentAt: 2000, serverAt: 6008, receivedAt: 2016 },
      { sentAt: 3000, serverAt: 7040, receivedAt: 3080 },
    ];
    const e = estimateClock(samples);
    expect(e).toMatchObject({ offsetMs: 4000, uncertaintyMs: 8, samples: 3, measuredAt: 2016 });
    expect(toLocal(10_000, e!)).toBe(6000);
    expect(clockUsable(e, 2100).reason).toMatch(/3 of 8/);
    const eight = estimateClock([...samples, ...samples, ...samples.slice(0, 2)]);
    expect(clockUsable(eight, 2100).ok).toBe(true);
    expect(clockUsable(eight, 40_000).reason).toMatch(/older than 30 seconds/);
  });

  it('labels a run unsynchronized above 100 ms of clock uncertainty or start-cue lateness', () => {
    expect(synchronized(sync, sync).ok).toBe(true);
    expect(synchronized({ ...sync, uncertaintyMs: 120 }, sync).reasons[0]).toMatch(/left clock uncertainty/);
    expect(synchronized(sync, { ...sync, startLatenessMs: 140 }).reasons[0]).toMatch(/right start cue/);
  });

  it('merges side files idempotently and refuses mismatched manifests', () => {
    const ok = mergeSideFiles([
      { runId: 'r', role: 'left', manifestHash: 'h', trialId: 'a' },
      { runId: 'r', role: 'left', manifestHash: 'h', trialId: 'a' },
      { runId: 'r', role: 'right', manifestHash: 'h', trialId: 'b' },
    ]);
    expect(ok.errors).toEqual([]);
    expect(ok.runs.get('r')).toEqual({ manifestHash: 'h', left: 'a', right: 'b' });
    const bad = mergeSideFiles([
      { runId: 'r', role: 'left', manifestHash: 'h', trialId: 'a' },
      { runId: 'r', role: 'right', manifestHash: 'other', trialId: 'b' },
    ]);
    expect(bad.errors[0]).toMatch(/different manifests/);
  });

  it('advances D1–D4 after three valid dual trials with both copy sides at 98%', () => {
    const run = (acc: number): CoordinatedRun => ({ runId: 'run-1', localDate: '2026-09-30', level: 'D2', left: side('left', 20, { accuracy: acc }), right: side('right', 20) });
    expect(levelReady([run(99), run(99)], 'D2')).toBe(false);
    expect(levelReady([run(99), run(99), run(97)], 'D2')).toBe(false);
    expect(levelReady([run(99), run(99), run(98)], 'D2')).toBe(true);
    const unsync = { ...run(99), left: side('left', 20, { sync: { ...sync, uncertaintyMs: 200 } }) };
    expect(levelReady([run(99), run(99), unsync], 'D2')).toBe(false);
  });
});

describe('stalls and substitutions', () => {
  it('counts gaps of two seconds or more, including the leading and trailing gaps', () => {
    const list = stalls([2500, 3000, 3100, 7000, 57_000], 0, 60_000);
    expect(list).toEqual([
      { from: 0, to: 2500 },
      { from: 3100, to: 7000 },
      { from: 7000, to: 57_000 },
      { from: 57_000, to: 60_000 },
    ]);
    expect(stallSummary(list)).toEqual({ count: 4, totalMs: 60_000 - 500 - 100 });
    expect(bothStalled([{ from: 0, to: 5000 }], [{ from: 3000, to: 9000 }])).toEqual({ count: 1, totalMs: 2000 });
  });

  it('reports a wrong character that matches the other stream as a candidate, ambiguous when shared', () => {
    const left = [
      { atMs: 1000, expected: 'a', produced: '7', correct: false },
      { atMs: 2000, expected: 'b', produced: 'b', correct: true },
    ];
    const right = [{ atMs: 1100, expected: '7', produced: '7', correct: true }];
    expect(substitutionCandidates(left, right, 300, 20)).toEqual([{ side: 'left', atMs: 1000, produced: '7', expectedHere: 'a', otherExpected: '7', ambiguous: false }]);
    expect(substitutionCandidates(left, right, 300, 500)[0]?.ambiguous).toBe(true);
    expect(substitutionCandidates(left, right, 50, 20)).toEqual([]);
  });
});

describe('stored side records and imports', () => {
  const manifest: DualManifest = {
    runId: 'run-1',
    protocolId: 'dual-copy-60-v1',
    scorerVersion: 'typist-scorer-v1',
    level: 'D4',
    durationMs: 60_000,
    seed: 7,
    createdAt: '2026-09-30T10:00:00Z',
    left: { role: 'left', mode: 'QL', layoutRevision: 'qwerty-us-intl@1', setupRevisionId: 's', taskId: 'p01', taskSha256: 'x', taskClass: 'prose', composition: false, baselineTrialIds: ['a', 'b', 'c'] },
    right: { role: 'right', mode: 'DR', layoutRevision: 'dvorak-right-us@1', setupRevisionId: 's', taskId: 'p02', taskSha256: 'y', taskClass: 'prose', composition: false, baselineTrialIds: ['d', 'e', 'f'] },
  };
  const hash = manifestHash(manifest);
  const record = (role: 'left' | 'right', wpm: number, solo: number, extra: Partial<DualRunRecord> = {}): DualRunRecord => ({
    id: dualRecordId('run-1', role),
    runId: 'run-1',
    role,
    source: 'local',
    level: 'D4',
    localDate: '2026-09-30',
    manifestHash: hash,
    manifest,
    result: side(role, wpm, { manifestHash: hash, baseline: { ...baseline(solo), mode: role === 'left' ? 'QL' : 'DR' } }),
    stream: [{ atMs: 100, expected: 'a', produced: 'a', correct: true }],
    coordinated: 'complete',
    stoppedBy: null,
    stopReason: null,
    placement: null,
    notes: null,
    compositionText: null,
    savedAt: '2026-09-30T10:01:10Z',
    ...extra,
  });

  it('computes the 57.14% example from two stored sides carrying their own baselines', () => {
    const [view] = runViews([record('left', 18, 30), record('right', 22, 40, { source: 'relay', stream: null })]);
    const e = runEfficiency(view!);
    expect(e?.available && (e.efficiency * 100).toFixed(2)).toBe('57.14');
    expect(coordinatedRuns([view!])).toHaveLength(1);
  });

  it('shows no ratio when a side carries no baseline, and never counts an incomplete run', () => {
    const noBaseline = record('right', 22, 40, { source: 'relay', stream: null });
    const [view] = runViews([record('left', 18, 30), { ...noBaseline, result: { ...noBaseline.result, baseline: null } }]);
    const e = runEfficiency(view!);
    expect(e?.available).toBe(false);
    const [incomplete] = runViews([record('left', 18, 30, { coordinated: 'incomplete' }), record('right', 22, 40, { source: 'imported' })]);
    expect(coordinatedRuns([incomplete!])).toEqual([]);
  });

  it('imports a side file idempotently and upgrades a relay copy with its stream', () => {
    const local = record('left', 18, 30);
    const relay = record('right', 22, 40, { source: 'relay', stream: null });
    const file = record('right', 22, 40, { notes: 'secret', stream: [{ atMs: 120, expected: 'b', produced: 'b', correct: true }] });
    const first = mergeImportedSide([local, relay], file);
    expect(first.outcome.kind).toBe('upgraded');
    expect(first.record?.stream).toHaveLength(1);
    const again = mergeImportedSide([local, first.record!], file);
    expect(again.outcome.kind).toBe('unchanged');
    const fresh = mergeImportedSide([local], file);
    expect(fresh.outcome.kind).toBe('added');
    expect(fresh.record).toMatchObject({ source: 'imported', coordinated: 'complete', notes: null });
  });

  it('rejects a side file with a conflicting manifest, trial, or tampered hash', () => {
    const local = record('left', 18, 30);
    const otherManifest = { ...manifest, seed: 99 };
    const otherHash = manifestHash(otherManifest);
    const conflicting = record('right', 22, 40, { manifest: otherManifest, manifestHash: otherHash, result: side('right', 22, { manifestHash: otherHash }) });
    expect(mergeImportedSide([local], conflicting).outcome).toMatchObject({ kind: 'rejected', reason: expect.stringMatching(/different manifests/) });
    const differentTrial = record('left', 18, 30, { result: side('left', 18, { manifestHash: hash, trialId: 'another' }) });
    expect(mergeImportedSide([local], differentTrial).outcome.kind).toBe('rejected');
    const tampered = record('right', 22, 40, { manifest: otherManifest });
    expect(mergeImportedSide([local], tampered).outcome).toMatchObject({ kind: 'rejected', reason: expect.stringMatching(/manifest hash/) });
  });
});

describe('dual tasks and matched baselines', () => {
  it('regenerates identical texts from the manifest seed and tags each task class', async () => {
    const { dualTasks, taskClassOf, baselineExercise } = await import('../../src/dual/tasks');
    for (const level of ['D1', 'D2', 'D3', 'D4', 'D5'] as const) {
      const a = dualTasks(level, 1234);
      const b = dualTasks(level, 1234);
      expect(a.left.exercise?.sha256).toBe(b.left.exercise?.sha256);
      expect(a.right.exercise?.sha256 ?? null).toBe(b.right.exercise?.sha256 ?? null);
      for (const role of ['left', 'right'] as const) {
        const ex = a[role].exercise;
        if (ex) expect(taskClassOf(ex)).toBe(a[role].taskClass);
        else expect(a[role].taskClass).toBe('composition');
      }
    }
    expect(dualTasks('D1', 1).left.exercise?.sha256).toBe(dualTasks('D1', 2).right.exercise?.sha256);
    expect(dualTasks('D4', 5).left.exercise?.id).not.toBe(dualTasks('D4', 5).right.exercise?.id);
    expect(baselineExercise('composition', 1)).toBeNull();
    expect(taskClassOf(baselineExercise('d2-digits', 3)!)).toBe('d2-digits');
  });
});
