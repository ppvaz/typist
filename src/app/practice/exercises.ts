// Chooses the exercise for a block: level-appropriate, inside the keys the
// mode has been introduced to, seeded and reproducible. Adaptive material
// never doubles as benchmark text.
import { CODE, PROSE, SYMBOLS } from '../../content/corpus';
import { adaptiveDrill, keyStats, leastPractised, chooseWeakTargets, recentInsertions, type TrialEvents } from '../../domain/adaptive';
import { introducedAt, type Level, LEVEL_ASSESSMENT, levelTwoStages, letterPositions, positionChars } from '../../domain/curriculum';
import { corpusExercise, type Exercise, monthlyExercise } from '../../domain/exercises/exercise';
import { choosePassage, coverageDrill, relocationDrill, spatialDrill, wordDrill } from '../../domain/exercises/generators';
import type { GeometryDefinition } from '../../domain/layouts/geometry';
import { type LayoutDefinition, strokesFor } from '../../domain/layouts/registry';
import type { BlockKind, FingeringLedger, TrialKind } from '../../domain/records';
import { PROTOCOLS, type ProtocolDefinition } from '../../domain/versions';

export interface ExercisePlan {
  readonly exercise: Exercise;
  readonly protocol: ProtocolDefinition;
  readonly trialKind: TrialKind;
  readonly assessmentLevel: Level | null;
  /** Assistance the exercise starts with; assessments that need no map start hidden. */
  readonly initialAssistance: 'full-map' | 'anchors' | 'none' | null;
  readonly goal: string;
}

export interface ExerciseContext {
  readonly blockKind: BlockKind;
  readonly level: Level;
  readonly stageProgress: number;
  readonly layout: LayoutDefinition;
  readonly geometry: GeometryDefinition;
  readonly ledger: FingeringLedger | null;
  readonly seed: number;
  /** Recent events in this mode/setup/ledger for adaptive drills. */
  readonly recent: readonly TrialEvents[];
  readonly weekday: number;
  readonly exerciseIndex: number;
  readonly avoidPassages: readonly string[];
}

const untimed = PROTOCOLS['drill-untimed-practice-v1'];

function zonesAsChars(ctx: ExerciseContext, allowed: ReadonlySet<string>): { name: string; chars: string[] }[] {
  const zones = ctx.ledger?.zones ?? [];
  const result = zones
    .map((z) => ({ name: z.name, chars: [...new Set(z.codes.flatMap((code) => positionChars(ctx.layout, code).slice(0, 1)))].filter((c) => allowed.has(c) && /[a-z]/.test(c)) }))
    .filter((z) => z.chars.length > 0);
  if (result.length >= 2) return result;
  // One-hand Dvorak: relocate between the left and right halves of the letter set.
  const letters = [...letterPositions(ctx.layout, ctx.geometry).entries()].filter(([c]) => allowed.has(c));
  const byX = letters.map(([c, code]) => ({ c, x: ctx.geometry.keys.find((k) => k.code === code)?.x ?? 0 })).sort((a, b) => a.x - b.x);
  const mid = Math.ceil(byX.length / 2);
  return [
    { name: 'left half', chars: byX.slice(0, mid).map((e) => e.c) },
    { name: 'right half', chars: byX.slice(mid).map((e) => e.c) },
  ].filter((z) => z.chars.length > 0);
}

function stageFocus(ctx: ExerciseContext): string[] {
  const intro = introducedAt(ctx.layout, ctx.geometry, ctx.level, ctx.stageProgress);
  return [...(intro.current?.chars ?? [])];
}

export function positionOf(layout: LayoutDefinition, geometry: GeometryDefinition, char: string): string | null {
  if (char === ' ') return 'Space';
  return strokesFor(layout, geometry, char)[0]?.code ?? null;
}

/** Weak targets for the weak-keys label and drill, from recent events. */
export function weakTargetsFor(ctx: Pick<ExerciseContext, 'recent' | 'layout' | 'geometry'>): { chars: string[]; codes: string[]; sparse: boolean } {
  const insertions = recentInsertions(ctx.recent);
  const stats = keyStats(insertions, 'char', ctx.layout, ctx.geometry);
  const weak = chooseWeakTargets(stats);
  const chars = weak.targets.map((t) => t.key);
  return { chars, codes: chars.map((c) => positionOf(ctx.layout, ctx.geometry, c)).filter((c): c is string => c !== null), sparse: weak.sparse };
}

export function planExercise(ctx: ExerciseContext): ExercisePlan {
  const intro = introducedAt(ctx.layout, ctx.geometry, ctx.level, ctx.stageProgress);
  const allowed = new Set(intro.chars);
  const letters = [...letterPositions(ctx.layout, ctx.geometry).keys()].sort();
  const base = { assessmentLevel: null, initialAssistance: null } as const;
  const kind = ctx.blockKind;

  if (kind === 'assessment') return assessmentExercise(ctx);
  if (kind === 'monthly') {
    return { ...base, exercise: monthlyExercise(), protocol: PROTOCOLS['monthly-fixed-passage-60-v1'], trialKind: 'monthly', initialAssistance: 'none', goal: 'Monthly fixed passage, 60 seconds' };
  }

  if (kind === 'warmup' || (ctx.level === 0 && (kind === 'words' || kind === 'light-words'))) {
    const pool = ctx.level === 0 ? new Set(letters) : allowed;
    const zones = zonesAsChars(ctx, pool);
    return { ...base, exercise: relocationDrill({ seed: ctx.seed, zones, length: 90, title: 'Relocation between zones' }), protocol: untimed, trialKind: 'practice', goal: 'Move the whole hand between zones; return to the anchors' };
  }

  if (ctx.level === 0) {
    // Spatial map: find letters one at a time.
    return { ...base, exercise: spatialDrill({ seed: ctx.seed, letters, repeats: 1 }), protocol: PROTOCOLS['spatial-find-v1'], trialKind: 'practice', goal: 'Find each letter; the map may help while learning' };
  }

  if (kind === 'weak-keys') {
    if (ctx.level <= 2) {
      const focus = stageFocus(ctx);
      return {
        ...base,
        exercise: wordDrill({ seed: ctx.seed, charset: intro.chars, length: 150, focus: { chars: focus, fraction: 0.6 }, capitalFraction: 0.08, title: `New keys: ${intro.current?.label ?? 'home row'}` }),
        protocol: untimed,
        trialKind: 'practice',
        goal: `Introduce ${intro.current?.label.toLowerCase() ?? 'the home row'}`,
      };
    }
    const weak = weakTargetsFor(ctx);
    const insertions = recentInsertions(ctx.recent);
    const coverage = leastPractised(intro.chars, keyStats(insertions, 'char', ctx.layout, ctx.geometry), 4);
    return {
      ...base,
      exercise: adaptiveDrill({ seed: ctx.seed, charset: intro.chars, targets: weak.chars, coverage, length: 220 }),
      protocol: untimed,
      trialKind: 'practice',
      goal: weak.chars.length > 0 ? `Weak keys: ${weak.codes.join(', ')}` : 'Learning your weak spots',
    };
  }

  if (kind === 'words' || kind === 'light-words' || kind === 'maintenance' || kind === 'switching') {
    const capitals = ctx.level >= 3 ? 0.15 : 0.08;
    const punct = ctx.level >= 3 ? 0.12 : 0;
    return {
      ...base,
      exercise: wordDrill({ seed: ctx.seed, charset: intro.chars, length: kind === 'light-words' ? 120 : 180, capitalFraction: capitals, punctuationFraction: punct, title: ctx.level >= 3 ? 'Words and bigrams' : 'Words from learned keys' }),
      protocol: untimed,
      trialKind: 'practice',
      goal: 'Untimed words: accuracy first',
    };
  }

  if (kind === 'timed-text') {
    if (ctx.level <= 2) {
      return { ...base, exercise: coverageDrill({ seed: ctx.seed, chars: intro.chars.filter((c) => c !== ' '), repeats: 1, title: 'Coverage of learned keys' }), protocol: untimed, trialKind: 'practice', goal: 'Every learned key at least once' };
    }
    if (ctx.level === 3) {
      return {
        ...base,
        exercise: wordDrill({ seed: ctx.seed, charset: intro.chars, length: 600, capitalFraction: 0.1, punctuationFraction: 0.05, title: 'Timed words' }),
        protocol: PROTOCOLS['word-drill-60-v1'],
        trialKind: 'timed-practice',
        assessmentLevel: 3,
        initialAssistance: null,
        goal: `60-second word drill; ${LEVEL_ASSESSMENT[3].wpm} WPM at ${LEVEL_ASSESSMENT[3].accuracyPercent}% twice recommends level 4`,
      };
    }
    // Thursday is the prose-and-code day: alternate code with prose.
    if (ctx.weekday === 4 && ctx.exerciseIndex % 2 === 1) {
      const item = CODE.items[ctx.seed % CODE.items.length] ?? CODE.items[0];
      if (item) return { ...base, exercise: corpusExercise(CODE, item), protocol: untimed, trialKind: 'practice', goal: 'Code: symbols, indentation, Enter' };
    }
    if (ctx.exerciseIndex % 4 === 3) {
      const item = SYMBOLS.items[0];
      if (item) return { ...base, exercise: corpusExercise(SYMBOLS, item), protocol: untimed, trialKind: 'practice', goal: 'Numbers and symbols' };
    }
    const passage = choosePassage(PROSE, ctx.seed, ctx.avoidPassages);
    return { ...base, exercise: corpusExercise(PROSE, passage), protocol: PROTOCOLS['english-prose-timed-practice-60-v1'], trialKind: 'timed-practice', goal: '60-second prose practice; feedback only' };
  }

  const passage = choosePassage(PROSE, ctx.seed, ctx.avoidPassages);
  return { ...base, exercise: corpusExercise(PROSE, passage), protocol: PROTOCOLS['english-prose-untimed-practice-v1'], trialKind: 'practice', goal: 'Prose practice' };
}

export function assessmentExercise(ctx: ExerciseContext): ExercisePlan {
  const level = ctx.level;
  if (level === 0) {
    const letters = [...letterPositions(ctx.layout, ctx.geometry).keys()].sort();
    return {
      exercise: spatialDrill({ seed: ctx.seed, letters, repeats: LEVEL_ASSESSMENT[0].repeats, title: 'Level 0 assessment: find every letter twice' }),
      protocol: PROTOCOLS['spatial-find-v1'],
      trialKind: 'assessment',
      assessmentLevel: 0,
      initialAssistance: 'none',
      goal: 'All 26 letters, twice each, first try, with the map hidden and no glances',
    };
  }
  if (level === 1 || level === 2) {
    const intro = introducedAt(ctx.layout, ctx.geometry, level === 1 ? 1 : 3);
    const chars = level === 1 ? intro.chars.filter((c) => c !== ' ') : levelTwoStages(ctx.layout, ctx.geometry).flatMap((s) => s.chars);
    const need = LEVEL_ASSESSMENT[level];
    const repeats = Math.max(level === 2 ? LEVEL_ASSESSMENT[2].coverageRepeats : 1, Math.ceil(need.insertions / Math.max(1, chars.length)));
    return {
      exercise: coverageDrill({ seed: ctx.seed, chars, repeats, title: `Level ${level} assessment` }),
      protocol: PROTOCOLS['coverage-assessment-v1'],
      trialKind: 'assessment',
      assessmentLevel: level,
      initialAssistance: null,
      goal: `${need.accuracyPercent}% over ${need.insertions}+ insertions${level === 2 ? ', every new key at least twice' : ''}`,
    };
  }
  const intro = introducedAt(ctx.layout, ctx.geometry, 3);
  return {
    exercise: wordDrill({ seed: ctx.seed, charset: intro.chars, length: 600, capitalFraction: 0.1, punctuationFraction: 0.05, title: 'Level 3 assessment: word drill' }),
    protocol: PROTOCOLS['word-drill-60-v1'],
    trialKind: 'assessment',
    assessmentLevel: 3,
    initialAssistance: null,
    goal: `${LEVEL_ASSESSMENT[3].wpm} WPM at ${LEVEL_ASSESSMENT[3].accuracyPercent}% in 60 seconds (two drills recommend level 4)`,
  };
}
