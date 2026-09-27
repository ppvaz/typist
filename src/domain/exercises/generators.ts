// Seeded exercise generators. The same generator version, seed and parameters
// always produce the same text, so any drill can be reproduced from its record.
// Generators never introduce a character outside the allowed set; when real
// words cannot be formed they fall back to clearly labeled artificial groups.
import { PROSE, type CorpusItem, type TextCorpus, WORDS } from '../../content/corpus';
import { createRandom } from '../random';
import { corpusExercise, type Exercise, generatedExercise } from './exercise';

export const GENERATOR_VERSIONS = {
  words: 1,
  artificial: 1,
  coverage: 1,
  spatial: 1,
  relocation: 1,
  passage: 1,
} as const;

export type Rng = () => number;

export function rngFor(seed: number): Rng {
  return createRandom(seed);
}

export function randomInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from an empty list');
  return items[randomInt(rng, items.length)] as T;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Shuffle so that equal neighbours are avoided where possible. */
export function shuffleNoRepeat<T>(rng: Rng, items: readonly T[]): T[] {
  let best = shuffle(rng, items);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let clashes = 0;
    for (let i = 1; i < best.length; i += 1) if (best[i] === best[i - 1]) clashes += 1;
    if (clashes === 0) return best;
    // Move each clashing element to a later position that breaks the clash.
    const out = [...best];
    for (let i = 1; i < out.length; i += 1) {
      if (out[i] !== out[i - 1]) continue;
      for (let j = i + 1; j < out.length; j += 1) {
        if (out[j] !== out[i] && out[j] !== out[i - 1] && (j + 1 >= out.length || out[j + 1] !== out[i])) {
          [out[i], out[j]] = [out[j] as T, out[i] as T];
          break;
        }
      }
    }
    best = out;
  }
  return best;
}

/** Choose a passage deterministically, avoiding recently used ones when possible. */
export function choosePassage(corpus: TextCorpus, seed: number, avoid: readonly string[] = []): CorpusItem {
  const rng = rngFor(seed);
  const fresh = corpus.items.filter((i) => !avoid.includes(i.id));
  return pick(rng, fresh.length > 0 ? fresh : corpus.items);
}

export function passageExercise(seed: number, avoid: readonly string[] = [], corpus: TextCorpus = PROSE): Exercise {
  return corpusExercise(corpus, choosePassage(corpus, seed, avoid));
}

/** Words whose every letter is allowed (lowercase words, allowed lowercase letters). */
export function wordsWithin(allowed: ReadonlySet<string>, words: readonly string[] = WORDS.words): string[] {
  return words.filter((w) => [...w].every((c) => allowed.has(c)));
}

export interface WordDrillParams {
  readonly seed: number;
  /** Characters the drill may contain (space is implied). */
  readonly charset: readonly string[];
  /** Minimum length in characters. */
  readonly length: number;
  /** Characters to emphasize, and the share of word slots that must contain one. */
  readonly focus?: { readonly chars: readonly string[]; readonly fraction: number };
  /** Share of words to capitalize when capitals are allowed. */
  readonly capitalFraction?: number;
  /** Punctuation appended to some words when allowed. */
  readonly punctuationFraction?: number;
  readonly words?: readonly string[];
  readonly title?: string;
}

const MIN_DISTINCT_WORDS = 6;
const PUNCTUATION = [',', '.', ';', ':', '?', '!'];

/** Real-word drill from the allowed keys; artificial groups when too few words exist. */
export function wordDrill(params: WordDrillParams): Exercise {
  const allowed = new Set(params.charset);
  const pool = wordsWithin(allowed, params.words);
  if (pool.length < MIN_DISTINCT_WORDS) return artificialDrill({ ...params, reason: 'too-few-words' });
  const rng = rngFor(params.seed);
  const focusChars = (params.focus?.chars ?? []).filter((c) => allowed.has(c));
  const focusPool = focusChars.length > 0 ? pool.filter((w) => focusChars.some((c) => w.includes(c))) : [];
  const capitals = params.capitalFraction ?? 0;
  const punctuation = PUNCTUATION.filter((p) => allowed.has(p));
  const punctFraction = punctuation.length > 0 ? (params.punctuationFraction ?? 0) : 0;
  const out: string[] = [];
  let chars = 0;
  let previous = '';
  while (chars < params.length) {
    const useFocus = focusPool.length > 0 && rng() < (params.focus?.fraction ?? 0);
    let word = pick(rng, useFocus ? focusPool : pool);
    if (word === previous && pool.length > 1) word = pick(rng, useFocus && focusPool.length > 1 ? focusPool : pool);
    previous = word;
    const upper = word.charAt(0).toUpperCase() + word.slice(1);
    if (capitals > 0 && rng() < capitals && allowed.has(upper.charAt(0))) word = upper;
    if (punctFraction > 0 && rng() < punctFraction) word += pick(rng, punctuation);
    chars += word.length + (out.length > 0 ? 1 : 0);
    out.push(word);
  }
  return generatedExercise({
    kind: 'words',
    textClass: 'words',
    title: params.title ?? 'Words',
    generator: {
      id: 'word-drill',
      version: GENERATOR_VERSIONS.words,
      seed: params.seed,
      params: { length: params.length, focus: params.focus ?? null, capitalFraction: capitals, punctuationFraction: punctFraction, wordCorpus: `${WORDS.id}@${WORDS.version}` },
    },
    text: out.join(' '),
    charset: [...params.charset].sort(),
    artificial: false,
  });
}

export interface ArtificialParams {
  readonly seed: number;
  readonly charset: readonly string[];
  readonly length: number;
  readonly focus?: { readonly chars: readonly string[]; readonly fraction: number };
  readonly title?: string;
  readonly reason?: string;
}

/** Groups of two to five allowed characters; every allowed character appears. */
export function artificialDrill(params: ArtificialParams): Exercise {
  const rng = rngFor(params.seed);
  const chars = [...new Set(params.charset)].filter((c) => c !== ' ' && c !== '\n');
  if (chars.length === 0) throw new Error('No characters to build a drill from');
  const focus = (params.focus?.chars ?? []).filter((c) => chars.includes(c));
  const sequence: string[] = shuffle(rng, chars);
  let total = sequence.length + Math.ceil(sequence.length / 3);
  while (total < params.length) {
    const c = focus.length > 0 && rng() < (params.focus?.fraction ?? 0) ? pick(rng, focus) : pick(rng, chars);
    sequence.push(c);
    total += 1.25;
  }
  const groups: string[] = [];
  let i = 0;
  while (i < sequence.length) {
    const size = 2 + randomInt(rng, 4);
    groups.push(sequence.slice(i, i + size).join(''));
    i += size;
  }
  return generatedExercise({
    kind: 'drill',
    textClass: 'drill',
    title: params.title ?? 'Key groups (artificial sequences)',
    generator: {
      id: 'artificial-groups',
      version: GENERATOR_VERSIONS.artificial,
      seed: params.seed,
      params: { length: params.length, focus: params.focus ?? null, reason: params.reason ?? null },
    },
    text: groups.join(' '),
    charset: [...chars].sort(),
    artificial: true,
  });
}

export interface CoverageParams {
  readonly seed: number;
  readonly chars: readonly string[];
  /** Each character appears at least this many times. */
  readonly repeats: number;
  readonly title?: string;
}

/** Every listed character at least `repeats` times, in short shuffled groups. */
export function coverageDrill(params: CoverageParams): Exercise {
  const rng = rngFor(params.seed);
  const chars = [...new Set(params.chars)].filter((c) => c !== ' ' && c !== '\n');
  const bag: string[] = [];
  for (let r = 0; r < params.repeats; r += 1) bag.push(...chars);
  const sequence = shuffleNoRepeat(rng, bag);
  const groups: string[] = [];
  let i = 0;
  while (i < sequence.length) {
    const size = 3 + randomInt(rng, 3);
    groups.push(sequence.slice(i, i + size).join(''));
    i += size;
  }
  return generatedExercise({
    kind: 'coverage',
    textClass: 'drill',
    title: params.title ?? 'Coverage',
    generator: { id: 'coverage', version: GENERATOR_VERSIONS.coverage, seed: params.seed, params: { repeats: params.repeats } },
    text: groups.join(' '),
    charset: [...chars].sort(),
    artificial: true,
  });
}

export interface SpatialParams {
  readonly seed: number;
  readonly letters: readonly string[];
  readonly repeats: number;
  readonly title?: string;
}

/** Level 0: find each letter `repeats` times in shuffled order, one at a time. */
export function spatialDrill(params: SpatialParams): Exercise {
  const rng = rngFor(params.seed);
  const bag: string[] = [];
  for (let r = 0; r < params.repeats; r += 1) bag.push(...params.letters);
  const sequence = shuffleNoRepeat(rng, bag);
  return generatedExercise({
    kind: 'spatial',
    textClass: 'drill',
    title: params.title ?? 'Find the letters',
    generator: { id: 'spatial-find', version: GENERATOR_VERSIONS.spatial, seed: params.seed, params: { repeats: params.repeats } },
    text: sequence.join(''),
    charset: [...new Set(params.letters)].sort(),
    artificial: true,
    presentation: 'single',
  });
}

export interface RelocationParams {
  readonly seed: number;
  /** Characters reachable in each zone, e.g. left / center / right. */
  readonly zones: readonly { readonly name: string; readonly chars: readonly string[] }[];
  readonly length: number;
  readonly title?: string;
}

/** Alternate short groups between different zones, so the whole hand moves. */
export function relocationDrill(params: RelocationParams): Exercise {
  const rng = rngFor(params.seed);
  const zones = params.zones.filter((z) => z.chars.filter((c) => c !== ' ').length > 0);
  if (zones.length === 0) throw new Error('Relocation needs at least one zone with characters');
  const groups: string[] = [];
  let total = 0;
  let zoneIndex = randomInt(rng, zones.length);
  while (total < params.length) {
    const zone = zones[zoneIndex] as (typeof zones)[number];
    const chars = zone.chars.filter((c) => c !== ' ');
    const size = 2 + randomInt(rng, 3);
    let group = '';
    for (let i = 0; i < size; i += 1) group += pick(rng, chars);
    groups.push(group);
    total += group.length + 1;
    if (zones.length > 1) {
      let next = randomInt(rng, zones.length - 1);
      if (next >= zoneIndex) next += 1;
      zoneIndex = next;
    }
  }
  return generatedExercise({
    kind: 'relocation',
    textClass: 'drill',
    title: params.title ?? 'Relocation',
    generator: {
      id: 'relocation',
      version: GENERATOR_VERSIONS.relocation,
      seed: params.seed,
      params: { length: params.length, zones: zones.map((z) => z.name) },
    },
    text: groups.join(' '),
    charset: [...new Set(zones.flatMap((z) => z.chars))].sort(),
    artificial: true,
  });
}
