// Shared shapes for committed input and non-scoring observations.

export type AssistanceLevel = 'full-map' | 'anchors' | 'none';

/** How a committed edit reached the typing field. */
export type InputPath =
  | 'key' // one key press, associated unambiguously with its keydown
  | 'dead-key' // a declared dead key followed by a completing key
  | 'composition' // an input-method composition without a declared dead key
  | 'multi' // several graphemes committed at once outside composition
  | 'unassociated' // a single grapheme with no applicable keydown
  | 'backspace';

export interface InputMeta {
  readonly path: InputPath;
  /** InputEvent.inputType, or "compositionend" for reconciled compositions. */
  readonly inputType: string;
  /** Physical position, only when the association is unambiguous. */
  readonly code: string | null;
  readonly key: string | null;
  /** Physical positions of a multi-key sequence, in order. */
  readonly keys?: readonly string[];
  readonly repeat?: boolean;
  readonly shift?: boolean;
  readonly shiftSide?: 'left' | 'right' | 'both' | null;
  readonly capsLock?: boolean;
  readonly altGraph?: boolean;
}

export type Observation =
  | { readonly type: 'focus'; readonly state: 'lost' | 'regained' }
  | { readonly type: 'visibility'; readonly state: 'hidden' | 'visible' }
  | { readonly type: 'assistance'; readonly level: AssistanceLevel; readonly previous: AssistanceLevel }
  | { readonly type: 'rejected-edit'; readonly inputType: string; readonly reason: string }
  | {
      readonly type: 'mapping';
      readonly code: string;
      readonly produced: string;
      readonly expected: readonly string[];
      readonly agreement: boolean;
    }
  | { readonly type: 'dead-key'; readonly code: string; readonly declared: boolean }
  | { readonly type: 'dead-key-discarded'; readonly keys: readonly string[] }
  | { readonly type: 'composition'; readonly data: string; readonly accepted: boolean }
  | { readonly type: 'heartbeat-gap'; readonly gapMs: number; readonly wallGapMs: number };
