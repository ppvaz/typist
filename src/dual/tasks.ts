// Two-machine tasks D1–D5 (docs/dual-machine.md, "Experience and
// progression"). Each machine regenerates its own text from the manifest
// seed and checks the hash the manifest names, so both sides provably type
// what was agreed. Solo baselines use the same task class and generator.
import { BEGINNER_WORDS, PROSE } from '../content/corpus';
import type { DualLevel, Role } from '../domain/dual';
import { corpusExercise, type Exercise, generatedExercise } from '../domain/exercises/exercise';
import { choosePassage, pick, rngFor, wordDrill } from '../domain/exercises/generators';

export const DUAL_GENERATOR_VERSION = 1;
/** The D1 string is the same for every run, so its solo baseline can use it too. */
export const D1_SEED = 20_260_901;

export interface DualTask {
  readonly taskClass: string;
  /** Null on a free-composition side. */
  readonly exercise: Exercise | null;
}

function letters(seed: number, generatorId: 'dual-same-string' | 'dual-letters', title: string): Exercise {
  const words = wordDrill({ seed, charset: [...'abcdefghijklmnopqrstuvwxyz '], length: 420, words: BEGINNER_WORDS, title });
  return generatedExercise({ kind: 'words', textClass: 'words', title, generator: { id: generatorId, version: DUAL_GENERATOR_VERSION, seed, params: {} }, text: words.text, charset: words.charset, artificial: words.artificial });
}

function digits(seed: number): Exercise {
  const rng = rngFor(seed);
  const groups: string[] = [];
  let length = 0;
  while (length < 420) {
    let g = '';
    for (let i = 0; i < 4; i += 1) g += pick(rng, [...'0123456789']);
    groups.push(g);
    length += 5;
  }
  return generatedExercise({ kind: 'drill', textClass: 'drill', title: 'Digit groups', generator: { id: 'dual-digits', version: DUAL_GENERATOR_VERSION, seed, params: {} }, text: groups.join(' '), charset: [...'0123456789'], artificial: true });
}

function phrase(seed: number): Exercise {
  const rng = rngFor(seed);
  const passage = choosePassage(PROSE, seed);
  const sentences = passage.text.split(/(?<=[.?!])\s+/).filter((s) => s.length >= 30 && s.length <= 90);
  const chosen = pick(rng, sentences.length > 0 ? sentences : [passage.text.slice(0, 80)]);
  const repeated = Array.from({ length: Math.ceil(480 / (chosen.length + 1)) }, () => chosen).join(' ');
  return generatedExercise({ kind: 'drill', textClass: 'drill', title: 'Repeated phrase', generator: { id: 'dual-phrase', version: DUAL_GENERATOR_VERSION, seed, params: { passage: passage.id } }, text: repeated, charset: null, artificial: false });
}

function prose(seed: number, avoid: readonly string[] = []): Exercise {
  return corpusExercise(PROSE, choosePassage(PROSE, seed, avoid));
}

/** The pair of tasks for a level; both sides derive them from one seed. */
export function dualTasks(level: DualLevel, seed: number): Record<Role, DualTask> {
  switch (level) {
    case 'D1': {
      const same = letters(D1_SEED, 'dual-same-string', 'Same simple string');
      return { left: { taskClass: 'd1-string', exercise: same }, right: { taskClass: 'd1-string', exercise: same } };
    }
    case 'D2':
      return { left: { taskClass: 'd2-letters', exercise: letters(seed, 'dual-letters', 'Letters') }, right: { taskClass: 'd2-digits', exercise: digits(seed + 1) } };
    case 'D3':
      return { left: { taskClass: 'd3-phrase', exercise: phrase(seed) }, right: { taskClass: 'd3-phrase', exercise: phrase(seed + 7) } };
    case 'D4': {
      const left = prose(seed);
      return { left: { taskClass: 'prose', exercise: left }, right: { taskClass: 'prose', exercise: prose(seed + 1, [left.id]) } };
    }
    case 'D5':
      return { left: { taskClass: 'prose', exercise: prose(seed) }, right: { taskClass: 'composition', exercise: null } };
  }
}

/** A solo-baseline exercise matched to a task class. */
export function baselineExercise(taskClass: string, seed: number): Exercise | null {
  switch (taskClass) {
    case 'd1-string':
      return letters(D1_SEED, 'dual-same-string', 'Same simple string');
    case 'd2-letters':
      return letters(seed, 'dual-letters', 'Letters');
    case 'd2-digits':
      return digits(seed);
    case 'd3-phrase':
      return phrase(seed);
    case 'prose':
      return prose(seed);
    default:
      return null;
  }
}

/** Copy task classes that have a solo baseline (composition has none). */
export const COPY_TASK_CLASSES = ['d1-string', 'd2-letters', 'd2-digits', 'd3-phrase', 'prose'] as const;

const CLASS_BY_GENERATOR: Readonly<Record<string, string>> = {
  'dual-same-string': 'd1-string',
  'dual-letters': 'd2-letters',
  'dual-digits': 'd2-digits',
  'dual-phrase': 'd3-phrase',
};

/** The task class of a stored exercise, so baselines match dual tasks. */
export function taskClassOf(exercise: Pick<Exercise, 'generator' | 'corpusId' | 'kind'>): string | null {
  if (exercise.generator) return CLASS_BY_GENERATOR[exercise.generator.id] ?? null;
  if (exercise.corpusId !== null && exercise.kind === 'prose') return 'prose';
  return null;
}
