// The target text under the strict positional model. Each character is
// correct, corrected (dotted), wrong (solid rule, showing what was typed),
// current (caret) or upcoming. A missed character misaligns the tail until
// corrected, and the display makes that visible rather than realigning.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { CharState } from '../../domain/scoring/engine';

export interface CharSource {
  charState(index: number): CharState;
  typedAt(index: number): string | null;
}

interface Chunk {
  readonly start: number;
  readonly end: number; // exclusive
}

/** Split into words, keeping trailing spaces/newlines with the word before them. */
export function chunksOf(target: readonly string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  for (let i = 0; i < target.length; i += 1) {
    const c = target[i];
    const next = target[i + 1];
    if ((c === ' ' || c === '\n') && next !== ' ' && next !== '\n') {
      chunks.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < target.length) chunks.push({ start, end: target.length });
  return chunks;
}

function display(expected: string, state: CharState, typed: string | null): string {
  if (state === 'wrong' && typed !== null) {
    if (typed === ' ') return '·';
    if (typed === '\n') return '↵';
    return typed;
  }
  return expected;
}

const ChunkView = memo(function ChunkView({ target, start, end, tail, version, source }: { target: readonly string[]; start: number; end: number; tail: number; version: number; source: CharSource }) {
  void tail;
  void version;
  const out = [];
  for (let i = start; i < end; i += 1) {
    const expected = target[i] as string;
    const state = source.charState(i);
    const text = display(expected, state, state === 'wrong' ? source.typedAt(i) : null);
    if (expected === '\n') {
      out.push(
        <span key={i} className={`c ${state} nl`} data-i={i}>
          {state === 'wrong' ? text : ''}
          {'\n'}
        </span>,
      );
    } else {
      out.push(
        <span key={i} className={`c ${state}`} data-i={i} title={state === 'wrong' ? `expected ${expected === ' ' ? 'Space' : expected}` : undefined}>
          {text}
        </span>,
      );
    }
  }
  return <span className="w">{out}</span>;
});

export function TargetText({ target, bufferLength, version, source, lines = 5 }: { target: readonly string[]; bufferLength: number; version: number; source: CharSource; lines?: number }) {
  const chunks = useMemo(() => chunksOf(target), [target]);
  const textRef = useRef<HTMLPreElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const text = textRef.current;
    const viewport = viewportRef.current;
    if (!text || !viewport) return;
    const index = Math.min(bufferLength, target.length - 1);
    const el = text.querySelector<HTMLElement>(`[data-i="${index}"]`);
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 57;
    // Keep the current line as the second visible line.
    const offset = Math.max(0, el.offsetTop - lineHeight);
    text.style.transform = `translateY(${-offset}px)`;
  }, [bufferLength, target, version]);

  return (
    <div className="target-viewport" ref={viewportRef} style={{ height: `calc(var(--practice-size) * 1.9 * ${lines})` }}>
      <pre className="target-text" ref={textRef} aria-hidden="true">
        {chunks.map((chunk) => {
          const inside = bufferLength >= chunk.start - 1 && bufferLength <= chunk.end;
          const tail = inside ? bufferLength : bufferLength < chunk.start ? -1 : chunk.end + 1;
          return <ChunkView key={chunk.start} target={target} start={chunk.start} end={chunk.end} tail={tail} version={inside ? version : 0} source={source} />;
        })}
      </pre>
    </div>
  );
}

/** Spatial finding: one target at a time, large. */
export function SingleTarget({ target, bufferLength, source }: { target: readonly string[]; bufferLength: number; source: CharSource }) {
  const index = Math.min(bufferLength, target.length - 1);
  const previous = bufferLength > 0 ? source.charState(bufferLength - 1) : null;
  return (
    <div className="single-target" aria-hidden="true">
      <div className="glyph">{bufferLength >= target.length ? '✓' : target[index]}</div>
      <p className="muted">
        {bufferLength} of {target.length} found
        {previous === 'wrong' ? ' · the last key was not that letter — Backspace, then try again' : ''}
      </p>
    </div>
  );
}
