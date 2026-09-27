import { describe, expect, it } from 'vitest';
import type { SwitchProbeRecord } from '../../src/domain/records';
import {
  pairKind,
  PROBE_TIMEOUT_MS,
  randomizedOrder,
  randomReady,
  switchingStage,
  switchMatrix,
  SwitchProbeEngine,
} from '../../src/domain/switching';
import { toGraphemes } from '../../src/domain/text/graphemes';

const PROMPT = toGraphemes('the quiet hand returns to the ridge');

function typeCorrect(engine: SwitchProbeEngine, from: number, count: number, t0: number, step: number): number {
  let t = t0;
  for (let i = 0; i < count; i += 1) {
    engine.insert(t, PROMPT[from + i] as string);
    t += step;
  }
  return t;
}

describe('latency probe', () => {
  it('A14: an error resets the streak, not the cue clock (cue 0, error 3 s, tenth correct at 8.4 s → 8.4 s)', () => {
    const engine = new SwitchProbeEngine(PROMPT, 0);
    typeCorrect(engine, 0, 4, 1000, 400); // 1.0 … 2.2 s
    engine.insert(3000, 'x'); // wrong at 3 s
    engine.deleteBackward(3300);
    // Ten correct insertions from position 4, the last at 8.4 s.
    let t = 3900;
    for (let i = 0; i < 10; i += 1) {
      engine.insert(t, PROMPT[4 + i] as string);
      t += 500;
    }
    expect(engine.phase).toBe('complete');
    expect(engine.outcome()).toMatchObject({ outcome: 'complete', latencyMs: 8400 });
    expect(engine.resets).toBeGreaterThanOrEqual(1);
  });

  it('keeps OS-menu preparation time inside the latency', () => {
    const engine = new SwitchProbeEngine(PROMPT, 0);
    engine.blur(1500); // OS input source menu takes focus while visible
    engine.focus(4000);
    expect(engine.phase).toBe('preparing');
    const end = typeCorrect(engine, 0, 10, 5000, 200);
    expect(engine.outcome().latencyMs).toBe(end - 200);
  });

  it('records a 30-second timeout as a lower bound, never a success', () => {
    const engine = new SwitchProbeEngine(PROMPT, 0);
    typeCorrect(engine, 0, 5, 1000, 1000);
    engine.tick(PROBE_TIMEOUT_MS);
    expect(engine.outcome()).toMatchObject({ outcome: 'timeout', latencyMs: null, lowerBoundMs: 30_000 });
    engine.insert(PROBE_TIMEOUT_MS + 10, 'x');
    expect(engine.phase).toBe('timeout');
  });

  it('does not let input after the deadline complete the probe', () => {
    const engine = new SwitchProbeEngine(PROMPT, 0);
    typeCorrect(engine, 0, 9, 21_000, 1000); // ninth correct at 29 s
    engine.insert(30_000, PROMPT[9] as string);
    expect(engine.outcome().outcome).toBe('timeout');
  });

  it('interrupts on blur once the typing streak started; hidden pages invalidate even while preparing', () => {
    const typing = new SwitchProbeEngine(PROMPT, 0);
    typing.insert(1000, PROMPT[0] as string);
    typing.blur(1500);
    expect(typing.outcome()).toMatchObject({ outcome: 'interrupted', interruption: 'focus-lost' });
    const preparing = new SwitchProbeEngine(PROMPT, 0);
    preparing.hidden(800);
    expect(preparing.outcome().outcome).toBe('invalid');
  });
});

function probe(from: SwitchProbeRecord['from'], to: SwitchProbeRecord['to'], outcome: SwitchProbeRecord['outcome'], latencyMs: number | null, stage: SwitchProbeRecord['stage'] = 'paired'): SwitchProbeRecord {
  return {
    schemaVersion: 1,
    id: `${from}-${to}-${Math.random()}`,
    sessionId: null,
    blockId: null,
    stage,
    from,
    to,
    fromLayout: '',
    toLayout: '',
    setupRevisionId: 's',
    cueAt: '2026-09-01T00:00:00Z',
    localDate: '2026-09-01',
    seed: 1,
    sequenceIndex: 0,
    prompt: '',
    outcome,
    latencyMs,
    lowerBoundMs: outcome === 'timeout' ? 30_000 : null,
    firstInsertMs: null,
    resets: 0,
    interruption: null,
    declarations: { glances: { kind: 'exact', count: 0 } },
    events: [],
    origin: 'native-run',
  };
}

describe('switching summaries', () => {
  it('keeps directions separate, retains timeouts and untested pairs', () => {
    const probes = [probe('QL', 'QR', 'complete', 7000), probe('QL', 'QR', 'complete', 7400), probe('QL', 'QR', 'timeout', null), probe('QR', 'QL', 'interrupted', null)];
    const matrix = switchMatrix(probes, ['QL', 'QR', 'DL']);
    const qlqr = matrix.find((m) => m.from === 'QL' && m.to === 'QR');
    expect(qlqr).toMatchObject({ attempts: 3, successes: 2, timeouts: 1, medianMs: 7200, preliminary: true, kind: 'hand-only' });
    expect(matrix.find((m) => m.from === 'QR' && m.to === 'QL')).toMatchObject({ successes: 0, interruptions: 1, medianMs: null });
    expect(matrix.find((m) => m.from === 'QL' && m.to === 'DL')).toMatchObject({ attempts: 0, medianMs: null, kind: 'layout-only' });
    // DL and DR are different logical layouts, so DL → DR changes both (docs/measurement.md).
    expect(pairKind('DL', 'DR')).toBe('hand-and-layout');
    expect(pairKind('QL', 'DR')).toBe('hand-and-layout');
  });

  it('suggests randomized practice after five fast paired successes in each direction', () => {
    const fast = (from: 'QL' | 'DL', to: 'QL' | 'DL') => Array.from({ length: 5 }, () => probe(from, to, 'complete', 6000));
    expect(randomReady([...fast('QL', 'DL')], 'QL', 'DL')).toBe(false);
    expect(randomReady([...fast('QL', 'DL'), ...fast('DL', 'QL')], 'QL', 'DL')).toBe(true);
  });

  it('draws a reproducible randomized order without immediate repeats', () => {
    const order = randomizedOrder(['QL', 'QR', 'DL', 'DR'], 40, 99);
    expect(order).toEqual(randomizedOrder(['QL', 'QR', 'DL', 'DR'], 40, 99));
    for (let i = 1; i < order.length; i += 1) expect(order[i]).not.toBe(order[i - 1]);
    expect(new Set(order).size).toBe(4);
  });

  it('chooses blocked switching while learning and paired switching with two acquired modes', () => {
    expect(switchingStage({ acquired: [], started: ['QL'], probes: [] }, 'QL')).toBeNull();
    expect(switchingStage({ acquired: [], started: ['QL', 'QR'], probes: [] }, 'QR')).toEqual({ stage: 'blocked', pair: ['QR', 'QL'] });
    expect(switchingStage({ acquired: ['QL', 'QR'], started: ['QL', 'QR'], probes: [] }, 'DL')?.stage).toBe('paired');
  });
});
