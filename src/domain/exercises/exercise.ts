// An exercise is a frozen prompt plus enough provenance to reproduce it:
// corpus item and version, or generator, version, seed and parameters. The
// text is normalized once, hashed, and never changed afterwards.
import { MONTHLY, type CorpusItem, type TextCorpus } from '../../content/corpus';
import { normalizeText, toGraphemes } from '../text/graphemes';
import { sha256Hex } from '../text/sha256';

export type ExerciseKind =
  | 'prose'
  | 'monthly'
  | 'symbols'
  | 'code'
  | 'words'
  | 'drill'
  | 'coverage'
  | 'spatial'
  | 'relocation'
  | 'custom'
  | 'probe';

export type TextClass = 'prose' | 'words' | 'numbers-symbols' | 'code' | 'drill' | 'custom';

export interface GeneratorInfo {
  readonly id: string;
  readonly version: number;
  readonly seed: number;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface Exercise {
  readonly id: string;
  readonly version: number;
  readonly kind: ExerciseKind;
  readonly textClass: TextClass;
  readonly language: string;
  readonly title: string;
  readonly corpusId: string | null;
  readonly corpusVersion: number | null;
  readonly itemId: string | null;
  readonly generator: GeneratorInfo | null;
  /** Normalized prompt, frozen before the trial starts. */
  readonly text: string;
  readonly sha256: string;
  /** Length in grapheme clusters. */
  readonly length: number;
  /** Characters the generator was allowed to use. */
  readonly charset: readonly string[] | null;
  /** Clearly labeled non-word sequences. */
  readonly artificial: boolean;
  /** "single" shows one target at a time (spatial finding). */
  readonly presentation: 'flow' | 'single';
  readonly license: string;
}

export const ORIGINAL_LICENSE = 'Original Typist content';

export function corpusExercise(corpus: TextCorpus, item: CorpusItem): Exercise {
  const kind: ExerciseKind = corpus.kind === 'monthly' ? 'monthly' : corpus.kind === 'symbols' ? 'symbols' : corpus.kind === 'code' ? 'code' : 'prose';
  const textClass: TextClass = corpus.kind === 'code' ? 'code' : corpus.kind === 'symbols' ? 'numbers-symbols' : 'prose';
  return {
    id: item.id,
    version: corpus.version,
    kind,
    textClass,
    language: corpus.language === 'code' ? 'code' : 'en',
    title: item.title,
    corpusId: corpus.id,
    corpusVersion: corpus.version,
    itemId: item.id,
    generator: null,
    text: item.text,
    sha256: item.sha256,
    length: toGraphemes(item.text).length,
    charset: null,
    artificial: false,
    presentation: 'flow',
    license: corpus.license,
  };
}

export function monthlyExercise(): Exercise {
  return corpusExercise(MONTHLY, MONTHLY.items[0] as CorpusItem);
}

export interface GeneratedDraft {
  readonly kind: ExerciseKind;
  readonly textClass: TextClass;
  readonly title: string;
  readonly generator: GeneratorInfo;
  readonly text: string;
  readonly charset: readonly string[] | null;
  readonly artificial: boolean;
  readonly presentation?: 'flow' | 'single';
  readonly language?: string;
}

export function generatedExercise(draft: GeneratedDraft): Exercise {
  const text = normalizeText(draft.text);
  const sha256 = sha256Hex(text);
  return {
    id: `gen:${draft.generator.id}:${sha256.slice(0, 16)}`,
    version: draft.generator.version,
    kind: draft.kind,
    textClass: draft.textClass,
    language: draft.language ?? 'en',
    title: draft.title,
    corpusId: null,
    corpusVersion: null,
    itemId: null,
    generator: draft.generator,
    text,
    sha256,
    length: toGraphemes(text).length,
    charset: draft.charset,
    artificial: draft.artificial,
    presentation: draft.presentation ?? 'flow',
    license: ORIGINAL_LICENSE,
  };
}

/** Normalize user text: NFC, LF line endings, tabs to two spaces, no trailing spaces. */
export function normalizeCustomText(raw: string): string {
  return normalizeText(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('\n')
    .map((line) => line.replace(/[  ]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

export function customExercise(raw: string, language: string, title = 'Custom text'): Exercise {
  const text = normalizeCustomText(raw);
  const sha256 = sha256Hex(text);
  return {
    id: `custom:${sha256.slice(0, 16)}`,
    version: 1,
    kind: 'custom',
    textClass: 'custom',
    language,
    title,
    corpusId: null,
    corpusVersion: null,
    itemId: null,
    generator: null,
    text,
    sha256,
    length: toGraphemes(text).length,
    charset: null,
    artificial: false,
    presentation: 'flow',
    license: 'User-supplied text, stored only on this device',
  };
}

/** Recompute the hash of a stored exercise to prove it was not altered. */
export function verifyExercise(exercise: Pick<Exercise, 'text' | 'sha256'>): boolean {
  return sha256Hex(normalizeText(exercise.text)) === exercise.sha256;
}
