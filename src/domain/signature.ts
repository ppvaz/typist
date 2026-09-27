// The comparison signature decides which results belong to one longitudinal
// series (docs/measurement.md). Date and the random passage within a frozen
// corpus are deliberately absent: they do not start a new series. A changed
// setup, ledger, layout revision, scorer or protocol always does.
import type { Exercise } from './exercises/exercise';
import type { ComparisonSignature, KeyboardSetup } from './records';
import { sha256Hex } from './text/sha256';
import type { ModeId } from './modes';
import type { ProtocolDefinition } from './versions';
import { SCORER_VERSION } from './versions';

export interface SignatureInput {
  readonly protocol: ProtocolDefinition;
  readonly mode: ModeId;
  readonly layoutId: string;
  readonly layoutRevision: number;
  readonly setup: Pick<KeyboardSetup, 'id' | 'geometryId' | 'geometryVersion' | 'modifierStrategy'>;
  readonly ledgerRevisionId: string | null;
  readonly exercise: Pick<Exercise, 'corpusId' | 'corpusVersion' | 'language' | 'textClass' | 'generator' | 'id'>;
  readonly inputPath: 'native' | 'emulated';
}

export function comparisonSignature(input: SignatureInput): ComparisonSignature {
  const { exercise, protocol } = input;
  // Corpus-based text is identified by corpus and version; generated or custom
  // text by generator identity (a fixed monthly passage is its own corpus).
  const corpus = exercise.corpusId
    ? `${exercise.corpusId}@${exercise.corpusVersion ?? 0}`
    : exercise.generator
      ? `generator:${exercise.generator.id}@${exercise.generator.version}`
      : `custom:${exercise.id}`;
  return {
    protocolId: protocol.id,
    scorerVersion: SCORER_VERSION,
    mode: input.mode,
    layout: `${input.layoutId}@${input.layoutRevision}`,
    geometry: `${input.setup.geometryId}@${input.setup.geometryVersion}`,
    setupRevisionId: input.setup.id,
    ledgerRevisionId: input.ledgerRevisionId,
    inputPath: input.inputPath,
    modifierStrategy: input.setup.modifierStrategy,
    corpus,
    language: exercise.language,
    textClass: exercise.textClass,
    durationMs: protocol.timing.mode === 'fixed' ? protocol.timing.durationMs : null,
    correctionPolicy: protocol.correctionPolicy,
    assistancePolicy: protocol.assistancePolicy,
  };
}

/** Canonical JSON with sorted keys, so equal signatures hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function signatureHash(signature: ComparisonSignature): string {
  return sha256Hex(canonicalJson(signature)).slice(0, 32);
}

/** Fields that differ between two signatures, for honest "new series" labels. */
export function signatureDifferences(a: ComparisonSignature, b: ComparisonSignature): (keyof ComparisonSignature)[] {
  return (Object.keys(a) as (keyof ComparisonSignature)[]).filter((k) => a[k] !== b[k]);
}

const FIELD_LABELS: Record<keyof ComparisonSignature, string> = {
  protocolId: 'protocol',
  scorerVersion: 'scorer version',
  mode: 'mode',
  layout: 'layout revision',
  geometry: 'keyboard geometry',
  setupRevisionId: 'setup revision',
  ledgerRevisionId: 'fingering ledger revision',
  inputPath: 'input path',
  modifierStrategy: 'modifier strategy',
  corpus: 'corpus',
  language: 'language',
  textClass: 'text type',
  durationMs: 'duration',
  correctionPolicy: 'correction policy',
  assistancePolicy: 'assistance policy',
};

export function signatureFieldLabel(field: keyof ComparisonSignature): string {
  return FIELD_LABELS[field];
}
