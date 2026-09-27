// Declarations the app cannot observe: physical glances, the hand used, and
// unrecorded assistance. They start unanswered and are never defaulted to
// zero or false; unknown stays unknown.
import { useId } from 'react';
import type { Declarations, GlanceDeclaration } from '../../domain/records';

export function GlanceField({ value, onChange, legend = 'Physical keyboard glances' }: { value: GlanceDeclaration | null; onChange: (value: GlanceDeclaration | null) => void; legend?: string }) {
  const name = useId();
  const kind = value?.kind ?? null;
  const count = value && value.kind !== 'unknown' ? value.count : 0;
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="glance-input">
        <label className="choice">
          <input type="radio" name={name} checked={kind === 'exact' && count === 0} onChange={() => onChange({ kind: 'exact', count: 0 })} />
          None
        </label>
        <label className="choice">
          <input type="radio" name={name} checked={kind === 'exact' && count > 0} onChange={() => onChange({ kind: 'exact', count: 1 })} />
          Exactly
        </label>
        {kind === 'exact' && count > 0 && (
          <input
            type="number"
            min={1}
            step={1}
            aria-label="Exact glance count"
            value={value?.kind === 'exact' ? value.count : 1}
            onChange={(e) => {
              const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
              onChange({ kind: 'exact', count: n });
            }}
          />
        )}
        <label className="choice">
          <input type="radio" name={name} checked={kind === 'at-least'} onChange={() => onChange({ kind: 'at-least', count: 3 })} />
          3 or more (estimate)
        </label>
        <label className="choice">
          <input type="radio" name={name} checked={kind === 'unknown'} onChange={() => onChange({ kind: 'unknown' })} />
          Unknown
        </label>
      </div>
      <p className="field-help">Looking at the board is not an error — it is a fact about this trial. Unknown stays pending; it is never counted as zero.</p>
    </fieldset>
  );
}

export function HandField({ value, onChange, handLabel }: { value: Declarations['hand']; onChange: (value: Declarations['hand']) => void; handLabel: string }) {
  const name = useId();
  return (
    <fieldset>
      <legend>Hand used</legend>
      <div className="choice-row">
        <label className="choice">
          <input type="radio" name={name} checked={value === 'stated'} onChange={() => onChange('stated')} />
          {handLabel}, as designated
        </label>
        <label className="choice">
          <input type="radio" name={name} checked={value === 'other'} onChange={() => onChange('other')} />
          The other hand
        </label>
      </div>
      <p className="field-help">A set typed with the other hand is excluded from this mode's evidence rather than silently rescored.</p>
    </fieldset>
  );
}

export function AssistanceField({ value, onChange }: { value: boolean | null; onChange: (value: boolean) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend>Any assistance Typist could not see?</legend>
      <div className="choice-row">
        <label className="choice">
          <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} />
          None
        </label>
        <label className="choice">
          <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} />
          Yes (a printed map, another screen, narration…)
        </label>
      </div>
    </fieldset>
  );
}

export function DeclarationFields({ value, onChange, handLabel }: { value: Declarations; onChange: (value: Declarations) => void; handLabel: string }) {
  return (
    <div className="decl-grid">
      <GlanceField value={value.glances} onChange={(glances) => onChange({ ...value, glances })} />
      <HandField value={value.hand} onChange={(hand) => onChange({ ...value, hand })} handLabel={handLabel} />
      <AssistanceField value={value.unrecordedAssistance} onChange={(unrecordedAssistance) => onChange({ ...value, unrecordedAssistance })} />
    </div>
  );
}

export function declarationsComplete(d: Declarations): boolean {
  return d.glances !== null && d.hand !== null && d.unrecordedAssistance !== null;
}
