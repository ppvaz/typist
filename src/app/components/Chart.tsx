// A small accessible SVG line chart. The table view is the equal alternative,
// not a fallback; charts never mix comparison series.
export interface ChartPoint {
  readonly label: string;
  readonly value: number;
}

export function LineChart({ points, min, max, gate, height = 160, title, unit, hand }: { points: readonly ChartPoint[]; min: number; max: number; gate?: number; height?: number; title: string; unit: string; hand?: 'left' | 'right' }) {
  const width = 640;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length <= 1 ? w / 2 : (i * w) / (points.length - 1));
  const y = (v: number) => pad.t + h - ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * h;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [min, (min + max) / 2, max];
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${p.value.toFixed(2)} ${unit}`).join('; ')}`} data-hand={hand}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end">
            {Number.isInteger(t) ? t : t.toFixed(1)}
          </text>
        </g>
      ))}
      {gate !== undefined && gate >= min && gate <= max && (
        <g>
          <line className="gate" x1={pad.l} x2={width - pad.r} y1={y(gate)} y2={y(gate)} />
          <text x={pad.l + 4} y={y(gate) - 4} textAnchor="start">
            gate {gate}
          </text>
        </g>
      )}
      <line className="axis" x1={pad.l} x2={width - pad.r} y1={pad.t + h} y2={pad.t + h} />
      {points.length > 0 && <path className="line" d={path} stroke="var(--hand, var(--ink))" />}
      {points.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          <circle cx={x(i)} cy={y(p.value)} r={3.5} fill="var(--bg-surface)" stroke="var(--hand, var(--ink))" strokeWidth={2} />
          {(points.length <= 12 || i % Math.ceil(points.length / 12) === 0) && (
            <text x={x(i)} y={height - 8} textAnchor={points.length > 1 && i === points.length - 1 ? 'end' : points.length > 1 && i === 0 ? 'start' : 'middle'}>
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
