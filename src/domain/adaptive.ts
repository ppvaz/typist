// Adaptive drills (docs/training-protocol.md, "Adaptive drills").
//
// Error rates are wrong insertions / insertion opportunities for an expected
// character or its physical position, ranked only with 20+ opportunities and
// always shown with their counts. Drill material is 60% target-heavy, 30%
// mixed known text and 10% coverage review, by generated character slots,
// sampled from a stored seed. Nothing here claims to know which finger or
// hand was used: layout interference is annotated as a possibility.
import defaults from '../../config/training-defaults.json';
import { WORDS } from '../content/corpus';
import { generatedExercise, type Exercise } from './exercises/exercise';
import { pick, rngFor, shuffle, wordsWithin } from './exercises/generators';
import type { GeometryDefinition } from './layouts/geometry';
import { type LayoutDefinition, strokesFor } from './layouts/registry';
import { numericMedian } from './scoring/fraction';
import type { TrialEvent } from './scoring/engine';

const A = defaults.adaptation;
export const MIN_OPPORTUNITIES = A.minimumKeyOpportunities;
export const MIN_BIGRAM_SAMPLES = A.minimumBigramSamples;
export const MAX_WEAK_TARGETS = A.maxWeakTargets;
export const ADAPTIVE_GENERATOR_VERSION = 1;
/** Correct-to-correct gaps longer than this are pauses, not hesitation. */
export const PAUSE_THRESHOLD_MS = 2000;

export interface TrialEvents {
  readonly trialId: string;
  readonly blockId: string | null;
  readonly endedAt: string;
  readonly events: readonly TrialEvent[];
}

export interface Insertion {
  readonly trialId: string;
  readonly index: number;
  readonly atMs: number;
  readonly expected: string | null;
  readonly produced: string;
  readonly correct: boolean;
  readonly code: string | null;
}

/** Latest insertions from at most five blocks (most recent first when trimming). */
export function recentInsertions(trials: readonly TrialEvents[], maxBlocks = A.maxRecentBlocks, maxInsertions = A.maxRecentInsertions): Insertion[] {
  const ordered = [...trials].sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  const blocks: string[] = [];
  const chosen: TrialEvents[] = [];
  for (const t of ordered) {
    const key = t.blockId ?? `trial:${t.trialId}`;
    if (!blocks.includes(key)) {
      if (blocks.length >= maxBlocks) continue;
      blocks.push(key);
    }
    chosen.push(t);
  }
  const all: Insertion[] = [];
  // Oldest first inside the window so "latest 500" keeps the most recent.
  for (const t of chosen.reverse()) {
    for (const e of t.events) {
      if (e.kind !== 'insert') continue;
      all.push({ trialId: t.trialId, index: e.index, atMs: e.atMs, expected: e.expected, produced: e.grapheme, correct: e.correct, code: e.input.code });
    }
  }
  return all.slice(-maxInsertions);
}

export interface KeyStat {
  /** Expected character, or physical position code. */
  readonly key: string;
  readonly opportunities: number;
  readonly errors: number;
  /** Error rate, only when opportunities ≥ 20. */
  readonly rate: number | null;
  readonly ranked: boolean;
  /** For position stats: the character expected there. */
  readonly chars?: readonly string[];
}

/** Expected-character and expected-position error statistics. */
export function keyStats(insertions: readonly Insertion[], by: 'char' | 'position', layout: LayoutDefinition, geometry: GeometryDefinition): KeyStat[] {
  const map = new Map<string, { opportunities: number; errors: number; chars: Set<string> }>();
  for (const ins of insertions) {
    if (ins.expected === null) continue;
    let key: string | null = ins.expected;
    if (by === 'position') key = ins.expected === ' ' ? 'Space' : ins.expected === '\n' ? 'Enter' : (strokesFor(layout, geometry, ins.expected)[0]?.code ?? null);
    if (key === null) continue;
    const s = map.get(key) ?? { opportunities: 0, errors: 0, chars: new Set<string>() };
    s.opportunities += 1;
    if (!ins.correct) s.errors += 1;
    s.chars.add(ins.expected);
    map.set(key, s);
  }
  return [...map.entries()]
    .map(([key, s]) => {
      const ranked = s.opportunities >= MIN_OPPORTUNITIES;
      return { key, opportunities: s.opportunities, errors: s.errors, rate: ranked ? s.errors / s.opportunities : null, ranked, ...(by === 'position' ? { chars: [...s.chars] } : {}) };
    })
    .sort(rankStats);
}

/** Ranked stats first by error rate (exact cross-multiplication), then errors, then key. */
export function rankStats(a: KeyStat, b: KeyStat): number {
  if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
  if (a.ranked && b.ranked) {
    const cross = b.errors * a.opportunities - a.errors * b.opportunities;
    if (cross !== 0) return cross;
  }
  if (b.errors !== a.errors) return b.errors - a.errors;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export interface WeakTargets {
  readonly targets: readonly KeyStat[];
  /** Too little data to rank: rotate introduced keys instead. */
  readonly sparse: boolean;
}

export function chooseWeakTargets(stats: readonly KeyStat[], max = MAX_WEAK_TARGETS): WeakTargets {
  const ranked = stats.filter((s) => s.ranked && s.errors > 0);
  return { targets: ranked.slice(0, max), sparse: ranked.length === 0 };
}

export interface AdaptiveDrillParams {
  readonly seed: number;
  /** Introduced characters (the drill never goes outside them). */
  readonly charset: readonly string[];
  /** Weak target characters; empty means rotate for coverage. */
  readonly targets: readonly string[];
  /** Characters with the fewest recent opportunities, for coverage review. */
  readonly coverage: readonly string[];
  readonly length: number;
}

/** 60% target-heavy / 30% mixed / 10% coverage, by character slots. */
export function adaptiveDrill(params: AdaptiveDrillParams): Exercise {
  const rng = rngFor(params.seed);
  const allowed = new Set(params.charset);
  const letters = params.charset.filter((c) => /^[a-z]$/.test(c));
  const pool = wordsWithin(allowed, WORDS.words);
  const targets = params.targets.filter((c) => allowed.has(c) && c !== ' ');
  const coverage = params.coverage.filter((c) => allowed.has(c) && c !== ' ');
  const budgets: [string, number][] = [
    ['target', Math.round(params.length * A.targetMaterialFraction)],
    ['mixed', Math.round(params.length * A.mixedMaterialFraction)],
    ['coverage', Math.round(params.length * A.coverageMaterialFraction)],
  ];
  let artificial = false;
  const pieces: string[] = [];
  const fill = (budget: number, chars: readonly string[]) => {
    const wordPool = chars.length > 0 ? pool.filter((w) => chars.some((c) => w.includes(c))) : pool;
    let used = 0;
    while (used < budget) {
      let piece: string;
      if (wordPool.length >= 3) piece = pick(rng, wordPool);
      else {
        // No real words can carry these characters: clearly artificial groups.
        artificial = true;
        const source = chars.length > 0 ? chars : letters.length > 0 ? letters : params.charset.filter((c) => c !== ' ');
        const size = 2 + Math.floor(rng() * 3);
        piece = '';
        for (let i = 0; i < size; i += 1) piece += pick(rng, source);
      }
      pieces.push(piece);
      used += piece.length + 1;
    }
  };
  for (const [kind, budget] of budgets) {
    if (kind === 'target') fill(budget, targets.length > 0 ? targets : coverage);
    else if (kind === 'mixed') fill(budget, []);
    else fill(budget, coverage.length > 0 ? coverage : targets);
  }
  return generatedExercise({
    kind: 'drill',
    textClass: 'drill',
    title: targets.length > 0 ? `Weak keys: ${targets.map((t) => (t === ' ' ? 'Space' : t)).join(' ')}` : 'Learning your weak spots',
    generator: {
      id: 'adaptive-drill',
      version: ADAPTIVE_GENERATOR_VERSION,
      seed: params.seed,
      params: { targets, coverage, length: params.length, fractions: [A.targetMaterialFraction, A.mixedMaterialFraction, A.coverageMaterialFraction], wordCorpus: `${WORDS.id}@${WORDS.version}` },
    },
    text: shuffle(rng, pieces).join(' '),
    charset: [...allowed].sort(),
    artificial,
  });
}

/** Introduced characters with the fewest recent opportunities, for coverage rotation. */
export function leastPractised(charset: readonly string[], stats: readonly KeyStat[], count: number): string[] {
  const opp = new Map(stats.map((s) => [s.key, s.opportunities]));
  return [...charset]
    .filter((c) => c !== ' ')
    .sort((a, b) => (opp.get(a) ?? 0) - (opp.get(b) ?? 0) || (a < b ? -1 : 1))
    .slice(0, count);
}

export interface BigramStat {
  readonly bigram: string;
  readonly medianMs: number;
  readonly samples: number;
}

/** Correct-to-correct intervals per bigram; pauses and interrupted spans excluded. */
export function slowBigrams(trials: readonly TrialEvents[], minSamples = MIN_BIGRAM_SAMPLES): BigramStat[] {
  const samples = new Map<string, number[]>();
  for (const t of trials) {
    let prev: { index: number; atMs: number; expected: string } | null = null;
    for (const e of t.events) {
      if (e.kind === 'pause' || e.kind === 'resume' || e.kind === 'delete' || e.kind === 'delete-empty' || e.kind === 'observe' || e.kind === 'ignored') {
        prev = null;
        continue;
      }
      if (e.kind !== 'insert') continue;
      if (!e.correct || e.expected === null) {
        prev = null;
        continue;
      }
      if (prev && e.index === prev.index + 1) {
        const gap = e.atMs - prev.atMs;
        if (gap > 0 && gap <= PAUSE_THRESHOLD_MS) {
          const key = prev.expected + e.expected;
          const list = samples.get(key) ?? [];
          list.push(gap);
          samples.set(key, list);
        }
      }
      prev = { index: e.index, atMs: e.atMs, expected: e.expected };
    }
  }
  return [...samples.entries()]
    .filter(([, list]) => list.length >= minSamples)
    .map(([bigram, list]) => ({ bigram, medianMs: numericMedian(list) as number, samples: list.length }))
    .sort((a, b) => b.medianMs - a.medianMs || (a.bigram < b.bigram ? -1 : 1));
}

export interface IntrusionCandidate {
  readonly trialId: string;
  readonly index: number;
  readonly expected: string;
  readonly produced: string;
  readonly code: string;
  readonly candidateLayout: string;
  /** Other explanations that also fit, e.g. an adjacent-key slip. */
  readonly alternatives: readonly string[];
}

function adjacent(geometry: GeometryDefinition, a: string, b: string): boolean {
  const ka = geometry.keys.find((k) => k.code === a);
  const kb = geometry.keys.find((k) => k.code === b);
  if (!ka || !kb || a === b) return false;
  const ca = ka.x + ka.w / 2;
  const cb = kb.x + kb.w / 2;
  return Math.abs(ka.y - kb.y) <= 1 && Math.abs(ca - cb) <= 1.3;
}

/**
 * Wrong insertions whose physical key is exactly where another practised
 * layout puts the expected character: a possible previous-layout intrusion.
 * Unknown physical codes stay unknown; identical maps (QL/QR) are skipped.
 */
export function intrusionCandidates(
  insertions: readonly Insertion[],
  current: LayoutDefinition,
  others: readonly LayoutDefinition[],
  geometry: GeometryDefinition,
): IntrusionCandidate[] {
  const out: IntrusionCandidate[] = [];
  const candidates = others.filter((o) => o.family !== current.family);
  for (const ins of insertions) {
    if (ins.correct || ins.code === null || ins.expected === null) continue;
    const correctCode = strokesFor(current, geometry, ins.expected)[0]?.code ?? null;
    const matches = candidates.filter((o) => {
      const strokes = strokesFor(o, geometry, ins.expected as string).filter((s) => s.level < 2 && !s.then);
      return strokes.length === 1 && strokes[0]?.code === ins.code && ins.code !== correctCode;
    });
    if (matches.length !== 1) continue;
    const alternatives: string[] = [];
    if (correctCode && adjacent(geometry, correctCode, ins.code)) alternatives.push('adjacent-key slip');
    out.push({ trialId: ins.trialId, index: ins.index, expected: ins.expected, produced: ins.produced, code: ins.code, candidateLayout: (matches[0] as LayoutDefinition).id, alternatives });
  }
  return out;
}
