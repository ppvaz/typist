// A physical keyboard drawn from the geometry. Characters come from the
// layout; zones, anchors and finger cues from the active ledger. Positions
// are physical: KeyJ is a place on the board, not the letter j.
import { memo } from 'react';
import { FINGER_NUMERAL } from '../../domain/fingering';
import type { AssistanceLevel } from '../../domain/input/types';
import type { GeometryDefinition } from '../../domain/layouts/geometry';
import { type LayoutDefinition, levelChar, levelDead } from '../../domain/layouts/registry';
import type { FingeringLedger } from '../../domain/records';

export interface KeyboardMapProps {
  readonly geometry: GeometryDefinition;
  readonly layout: LayoutDefinition;
  readonly ledger: FingeringLedger | null;
  readonly assistance: AssistanceLevel;
  readonly targetCode?: string | null;
  /** A key held with the target (Shift, or a dead key before Space). */
  readonly targetModifier?: string | null;
  readonly nextCode?: string | null;
  readonly weakCodes?: readonly string[];
  /** Calibration view: per-position verification. */
  readonly verification?: ReadonlyMap<string, 'ok' | 'bad' | 'unverified'>;
  readonly showFingers?: boolean;
  readonly label?: string;
}

function zoneClasses(ledger: FingeringLedger | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!ledger) return map;
  // The home zone gets the strongest tint; the others alternate lighter tints.
  const order = [...ledger.zones].sort((a, b) => Number(b.name.startsWith('Home')) - Number(a.name.startsWith('Home')));
  const tint = [2, 1, 3];
  order.forEach((zone, i) => {
    for (const code of zone.codes) {
      const preferred = ledger.entries.find((e) => e.code === code)?.zoneId;
      if (preferred && preferred !== zone.id) continue;
      if (!map.has(code)) map.set(code, tint[i] ?? 1);
    }
  });
  return map;
}

function labels(layout: LayoutDefinition, code: string): { base: string | null; shift: string | null; dead: boolean } {
  const levels = layout.keys[code]?.levels ?? [];
  const base = levels[0];
  const shift = levels[1];
  const baseChar = levelChar(base);
  const baseDead = levelDead(base);
  const shiftChar = levelChar(shift) ?? (levelDead(shift) ? (layout.deadKeySpace[levelDead(shift) ?? ''] ?? null) : null);
  const b = baseChar ?? (baseDead ? (layout.deadKeySpace[baseDead] ?? null) : null);
  const showShift = shiftChar !== null && b !== null && shiftChar !== b.toUpperCase();
  return { base: b, shift: showShift ? shiftChar : null, dead: !!baseDead };
}

export const KeyboardMap = memo(function KeyboardMap(props: KeyboardMapProps) {
  const { geometry, layout, ledger, assistance } = props;
  if (assistance === 'none') return null;
  const showChars = assistance === 'full-map';
  const zones = zoneClasses(ledger);
  const anchors = new Set(ledger?.anchors ?? ['KeyF', 'KeyJ']);
  const weak = new Set(props.weakCodes ?? []);
  const entries = new Map((ledger?.entries ?? []).map((e) => [e.code, e]));
  const railZones = (ledger?.zones ?? [])
    .map((z) => {
      const keys = geometry.keys.filter((k) => z.codes.includes(k.code) && k.y === 2);
      if (keys.length === 0) return null;
      const left = Math.min(...keys.map((k) => k.x));
      const right = Math.max(...keys.map((k) => k.x + k.w));
      return { id: z.id, name: z.name, left, right };
    })
    .filter((z): z is NonNullable<typeof z> => z !== null);
  return (
    <div className="map-scroll">
      {railZones.length > 1 && (
        <div className="zone-rail" aria-hidden="true">
          {railZones.map((z) => (
            <span key={z.id} style={{ left: `calc(var(--u) * ${z.left})`, width: `calc(var(--u) * ${z.right - z.left} - 4px)` }}>
              {z.name}
            </span>
          ))}
        </div>
      )}
      <div className="kbd-map" role="img" aria-label={props.label ?? `${geometry.name} keyboard map, ${showChars ? 'characters shown' : 'anchors only'}`}>
        {geometry.keys.map((key) => {
          const { base, shift, dead } = labels(layout, key.code);
          const classes = ['key'];
          const zone = zones.get(key.code);
          if (zone) classes.push(`zone-${zone}`);
          if (anchors.has(key.code)) classes.push('anchor');
          if (key.label) classes.push('modifier');
          if (showChars && props.targetCode === key.code) classes.push('target');
          if (showChars && props.targetModifier === key.code) classes.push('target');
          if (showChars && props.nextCode === key.code && props.targetCode !== key.code) classes.push('next');
          if (weak.has(key.code)) classes.push('weak');
          const v = props.verification?.get(key.code);
          if (v === 'unverified') classes.push('unverified');
          if (v === 'ok') classes.push('verified-ok');
          if (v === 'bad') classes.push('verified-bad');
          const entry = entries.get(key.code);
          const h = key.h ?? 1;
          const style = {
            left: `calc(var(--u) * ${key.x} + 2px)`,
            top: `calc(var(--u) * ${key.y} + 2px)`,
            width: `calc(var(--u) * ${key.w} - 4px)`,
            height: `calc(var(--u) * ${h} - 4px)`,
          };
          const hideChar = v === 'unverified';
          return (
            <div key={key.code} className={classes.join(' ')} style={style} data-code={key.code}>
              {key.label ? (
                <span className="name">{key.label}</span>
              ) : showChars && !hideChar ? (
                <>
                  {shift && <span className="shift">{shift}</span>}
                  <span style={dead ? { textDecoration: 'underline dotted' } : undefined}>{base ?? ''}</span>
                </>
              ) : null}
              {props.showFingers && entry && <span className="finger">{entry.finger ? FINGER_NUMERAL[entry.finger] : '·'}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export function MapLegend({ geometryName, layoutCode, fingerCount, positions, revision }: { geometryName: string; layoutCode: string; fingerCount: number; positions: number; revision: number | null }) {
  return (
    <div className="map-legend">
      <div className="eyebrow">Map legend</div>
      <ul>
        <li>
          <span className="legend-swatch target" aria-hidden="true" /> Character to type now
        </li>
        <li>
          <span className="legend-swatch next" aria-hidden="true" /> The one after it
        </li>
        <li>
          <span className="legend-swatch anchor" aria-hidden="true" /> Tactile anchor you can feel
        </li>
        <li>
          <span className="legend-swatch unverified" aria-hidden="true" /> Not yet verified for this layout
        </li>
      </ul>
      <p>
        Positions are physical, not characters: <code>KeyJ</code> is a place on the board under a {layoutCode} map. Finger numbers appear only where your
        ledger has an entry — {fingerCount} of {positions} positions{revision !== null ? `, revision ${revision}` : ''}.
      </p>
      <p>{geometryName} geometry. Change it in Setup and the map changes shape with it.</p>
    </div>
  );
}
