import { describe, expect, it } from 'vitest';
import {
  adaptiveDrill,
  chooseWeakTargets,
  type Insertion,
  intrusionCandidates,
  keyStats,
  recentInsertions,
  slowBigrams,
  type TrialEvents,
} from '../../src/domain/adaptive';
import { geometryById } from '../../src/domain/layouts/geometry';
import { layoutById } from '../../src/domain/layouts/registry';
import type { InputMeta } from '../../src/domain/input/types';
import { TrialEngine } from '../../src/domain/scoring/engine';
import { toGraphemes } from '../../src/domain/text/graphemes';

const ansi = geometryById('ansi-us');
const qwerty = layoutById('qwerty-us-intl');
const dvorakLeft = layoutById('dvorak-left-us');

function ins(expected: string, produced: string, code: string | null = null, atMs = 0, index = 0): Insertion {
  return { trialId: 't', index, atMs, expected, produced, correct: expected === produced, code };
}

describe('weak keys', () => {
  it('A11: three errors in three opportunities is insufficient evidence, not a settled weak key', () => {
    const stats = keyStats([ins('y', 'u'), ins('y', 'u'), ins('y', 't')], 'char', qwerty, ansi);
    expect(stats[0]).toMatchObject({ key: 'y', opportunities: 3, errors: 3, rate: null, ranked: false });
    expect(chooseWeakTargets(stats)).toEqual({ targets: [], sparse: true });
  });

  it('ranks with 20+ opportunities and reports denominators', () => {
    const samples: Insertion[] = [];
    for (let i = 0; i < 28; i += 1) samples.push(ins('y', i < 7 ? 'u' : 'y'));
    for (let i = 0; i < 31; i += 1) samples.push(ins('b', i < 5 ? 'n' : 'b'));
    for (let i = 0; i < 25; i += 1) samples.push(ins('a', 'a'));
    for (let i = 0; i < 19; i += 1) samples.push(ins('/', i < 4 ? '.' : '/'));
    const stats = keyStats(samples, 'char', qwerty, ansi);
    expect(stats.slice(0, 2).map((s) => [s.key, s.errors, s.opportunities])).toEqual([
      ['y', 7, 28],
      ['b', 5, 31],
    ]);
    expect(stats.find((s) => s.key === '/')).toMatchObject({ ranked: false, errors: 4, opportunities: 19 });
    expect(chooseWeakTargets(stats).targets.map((t) => t.key)).toEqual(['y', 'b']);
  });

  it('aggregates by physical position separately from characters', () => {
    const stats = keyStats([ins('f', 'g'), ins('F', 'F')], 'position', qwerty, ansi);
    expect(stats[0]).toMatchObject({ key: 'KeyF', opportunities: 2, errors: 1 });
    const dl = keyStats([ins('d', 'd')], 'position', dvorakLeft, ansi);
    expect(dl[0]?.key).toBe('KeyF');
  });

  it('takes the latest 500 insertions from at most five blocks', () => {
    const trials: TrialEvents[] = [];
    for (let b = 0; b < 7; b += 1) {
      const engine = new TrialEngine({ kind: 'practice', timing: { mode: 'untimed' }, target: toGraphemes('a'.repeat(200)) });
      const meta: InputMeta = { path: 'key', inputType: 'insertText', code: 'KeyA', key: 'a' };
      for (let i = 0; i < 150; i += 1) engine.insert(i * 100, 'a', meta);
      trials.push({ trialId: `t${b}`, blockId: `b${b}`, endedAt: `2026-09-0${b + 1}T10:00:00Z`, events: engine.events });
    }
    const recent = recentInsertions(trials);
    expect(recent).toHaveLength(500);
    expect(new Set(recent.map((r) => r.trialId))).toEqual(new Set(['t6', 't5', 't4', 't3']));
  });
});

describe('adaptive drill material', () => {
  const charset = [...'asdfghjklqwertyuiopzxcvbnm '];

  it('is reproducible from its seed and never leaves the introduced keys', () => {
    const a = adaptiveDrill({ seed: 42, charset, targets: ['y', 'b'], coverage: ['q', 'z'], length: 240 });
    const b = adaptiveDrill({ seed: 42, charset, targets: ['y', 'b'], coverage: ['q', 'z'], length: 240 });
    expect(a.text).toBe(b.text);
    expect(a.sha256).toBe(b.sha256);
    expect([...a.text].every((c) => charset.includes(c))).toBe(true);
    expect(a.generator).toMatchObject({ id: 'adaptive-drill', seed: 42 });
  });

  it('gives roughly 60% of words to the weak targets', () => {
    const drill = adaptiveDrill({ seed: 7, charset, targets: ['y'], coverage: ['q'], length: 1000 });
    const words = drill.text.split(' ');
    const withTarget = words.filter((w) => w.includes('y')).join(' ').length;
    expect(withTarget / drill.text.length).toBeGreaterThan(0.5);
  });

  it('falls back to labeled artificial groups when no words fit', () => {
    const drill = adaptiveDrill({ seed: 3, charset: ['j', 'k', 'l', ';', ' '], targets: [';'], coverage: [], length: 60 });
    expect(drill.artificial).toBe(true);
    expect([...drill.text].every((c) => 'jkl; '.includes(c))).toBe(true);
  });
});

describe('bigram hesitation', () => {
  function events(pairs: number): TrialEvents {
    const engine = new TrialEngine({ kind: 'practice', timing: { mode: 'untimed' }, target: toGraphemes('th '.repeat(pairs)) });
    const meta: InputMeta = { path: 'key', inputType: 'insertText', code: null, key: null };
    let t = 0;
    for (let i = 0; i < pairs; i += 1) {
      engine.insert((t += 150), 't', meta);
      engine.insert((t += 400), 'h', meta);
      engine.insert((t += 100), ' ', meta);
    }
    return { trialId: 'x', blockId: 'b', endedAt: '2026-09-01T00:00:00Z', events: engine.events };
  }

  it('needs ten samples before suggesting a slow bigram', () => {
    expect(slowBigrams([events(9)]).find((b) => b.bigram === 'th')).toBeUndefined();
    expect(slowBigrams([events(10)]).find((b) => b.bigram === 'th')).toMatchObject({ medianMs: 400, samples: 10 });
  });

  it('excludes pauses longer than two seconds', () => {
    const engine = new TrialEngine({ kind: 'practice', timing: { mode: 'untimed' }, target: toGraphemes('th'.repeat(30)) });
    const meta: InputMeta = { path: 'key', inputType: 'insertText', code: null, key: null };
    let t = 0;
    for (let i = 0; i < 15; i += 1) {
      engine.insert((t += 100), 't', meta);
      engine.insert((t += 5000), 'h', meta);
    }
    expect(slowBigrams([{ trialId: 'x', blockId: 'b', endedAt: '', events: engine.events }]).find((b) => b.bigram === 'th')).toBeUndefined();
  });
});

describe('layout interference', () => {
  it('annotates a DL error at the QWERTY position of the expected letter as a possible intrusion', () => {
    // In DL, "d" lives on KeyF. Pressing KeyD (QWERTY "d") produces DL "c".
    const candidates = intrusionCandidates([ins('d', 'c', 'KeyD')], dvorakLeft, [qwerty, layoutById('dvorak-right-us')], ansi);
    expect(candidates).toEqual([
      { trialId: 't', index: 0, expected: 'd', produced: 'c', code: 'KeyD', candidateLayout: 'qwerty-us-intl', alternatives: ['adjacent-key slip'] },
    ]);
  });

  it('never annotates QL/QR hand switches, which share one map, or unknown codes', () => {
    expect(intrusionCandidates([ins('f', 'g', 'KeyG')], qwerty, [layoutById('qwerty-us')], ansi)).toEqual([]);
    expect(intrusionCandidates([ins('d', 'c', null)], dvorakLeft, [qwerty], ansi)).toEqual([]);
  });
});
