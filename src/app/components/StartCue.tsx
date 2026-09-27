// Countdown and start cue for cue-started trials. The "Go" frame is painted
// from a requestAnimationFrame callback, and its lateness against the
// scheduled start is reported: that is the start-cue evidence a coordinated
// run records (docs/dual-machine.md, step 6).
import { useEffect, useRef } from 'react';

export function StartCue({ at, onCue }: { at: number; onCue?: (latenessMs: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onCue);
  report.current = onCue;

  useEffect(() => {
    let frame = 0;
    let cued = false;
    let hideAt = 0;
    const loop = (t: number) => {
      const el = ref.current;
      if (!el) return;
      if (!cued) {
        if (t >= at) {
          cued = true;
          el.textContent = 'Go';
          el.dataset.state = 'go';
          hideAt = t + 1200;
          report.current?.(t - at);
        } else {
          el.textContent = `Starts in ${Math.ceil((at - t) / 1000)}`;
        }
      } else if (t >= hideAt) {
        el.dataset.state = 'done';
        return;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [at]);

  return <div ref={ref} className="start-cue" role="status" aria-live="assertive" data-state="waiting" />;
}
