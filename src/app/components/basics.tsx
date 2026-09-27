// Small presentational components shared across screens.
import { type ReactNode, useId } from 'react';
import { modeById, type ModeId } from '../../domain/modes';
import type { SaveState } from '../../storage/repo';
import { timeOfDay } from '../format';

export function handOf(mode: ModeId): 'left' | 'right' | undefined {
  const hand = modeById(mode).hand;
  return hand === 'both' ? undefined : hand;
}

/** Monogram, layout name and hand word — always all three. */
export function ModeIdentity({ mode, size = 'large' }: { mode: ModeId; size?: 'large' | 'small' }) {
  const def = modeById(mode);
  const hand = handOf(mode);
  return (
    <div className="mode-identity" data-hand={hand}>
      <span className="mode-mark" style={size === 'small' ? { fontSize: 16 } : undefined}>
        {mode}
      </span>
      <span className="sep" aria-hidden="true" />
      <span className="layout-name" style={size === 'small' ? { fontSize: 16 } : undefined}>
        {def.layoutName}
      </span>
      <span className="sep" aria-hidden="true" />
      <span className="hand-word">
        {hand && <span className="hand-edge" aria-hidden="true" />}
        {def.handLabel}
      </span>
    </div>
  );
}

export function ModeLabel({ mode }: { mode: ModeId }) {
  const def = modeById(mode);
  return (
    <span data-hand={handOf(mode)}>
      <span className="mono" style={{ color: 'var(--hand, var(--ink))', fontWeight: 500 }}>
        {mode}
      </span>{' '}
      <span className="muted">
        {def.layoutName} · {def.handLabel}
      </span>
    </span>
  );
}

export type Mark = 'met' | 'missed' | 'pending' | 'none';

export function StatusMark({ mark, label }: { mark: Mark; label: string }) {
  return (
    <span>
      <span className={`status-mark ${mark}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export type MessageKind = 'observed' | 'met' | 'short' | 'tentative' | 'pending' | 'error';

const TAGS: Record<MessageKind, string> = {
  observed: 'Observed',
  met: 'Gate met',
  short: 'Short',
  tentative: 'Tentative',
  pending: 'Pending',
  error: 'Not saved',
};

export function Message({ kind, tag, children, role }: { kind: MessageKind; tag?: string; children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div className={`message ${kind}`} role={role}>
      <span className="tag">{tag ?? TAGS[kind]}</span>
      {children}
    </div>
  );
}

export function SaveBadge({ state, timeZone }: { state: SaveState | { status: 'in-memory' }; timeZone?: string }) {
  switch (state.status) {
    case 'saving':
      return (
        <span className="save-state saving" role="status">
          <span className="dot" aria-hidden="true" /> Saving locally…
        </span>
      );
    case 'saved':
      return (
        <span className="save-state saved" role="status">
          <span className="dot" aria-hidden="true" /> Saved locally · {timeOfDay(new Date(state.at).toISOString(), timeZone)}
        </span>
      );
    case 'failed':
      return (
        <span className="save-state failed" role="alert">
          <span className="dot" aria-hidden="true" /> Not saved — {state.error}
        </span>
      );
    case 'in-memory':
      return (
        <span className="save-state" role="status">
          <span className="dot" aria-hidden="true" /> Held in memory, not saved yet
        </span>
      );
    default:
      return null;
  }
}

export function NoEvidence({ children = 'No evidence' }: { children?: ReactNode }) {
  return <span className="no-evidence">{children}</span>;
}

export function Metric({ label, value, unit, sub, size }: { label: string; value: string | null; unit?: string; sub?: ReactNode; size?: 'medium' }) {
  return (
    <div className="metric">
      <span className="eyebrow">{label}</span>
      <div>
        {value === null ? (
          <NoEvidence />
        ) : (
          <>
            <span className={`value${size ? ` ${size}` : ''}`}>{value}</span>
            {unit && <span className="unit">{unit}</span>}
          </>
        )}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Ordinal({
  label,
  value,
  onChange,
  low,
  high,
  name,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  low: string;
  high: string;
  name?: string;
}) {
  const id = useId();
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="ordinal" role="radiogroup" aria-label={label}>
        <span className="end">{low}</span>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="choice">
            <input type="radio" name={name ?? id} value={n} checked={value === n} onChange={() => onChange(n)} />
            {n}
          </label>
        ))}
        <span className="end">{high}</span>
      </div>
    </fieldset>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} disabled={disabled} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
