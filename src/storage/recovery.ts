// Startup recovery (docs/architecture.md). A trial still marked "running"
// belongs to a page that closed, crashed or lost the writer lease. Its
// journal is replayed and the trial is saved as interrupted (or aborted when
// no insertion happened). A scored clock is never resumed across restarts.
import { toGraphemes } from '../domain/text/graphemes';
import { type InterruptionReason, TrialEngine } from '../domain/scoring/engine';
import type { TrialRecord } from '../domain/records';
import { finalizedTrial } from '../domain/trial-record';
import type { Repository } from './repo';

export async function recoverRunningTrials(repo: Repository, reason: InterruptionReason = 'recovered-after-restart'): Promise<TrialRecord[]> {
  const running = await repo.runningTrials();
  const recovered: TrialRecord[] = [];
  for (const trial of running) {
    const chunks = (await repo.db.getAllFromIndex('events', 'byTrial', trial.id)).sort((a, b) => a.chunk - b.chunk);
    const events = chunks.flatMap((c) => c.events);
    const stored = await repo.loadExercise(trial.exercise.sha256);
    const endedAt = new Date().toISOString();
    if (!stored) {
      // Without the frozen prompt the journal cannot be replayed; keep what
      // was last journaled and mark it interrupted.
      const final: TrialRecord = { ...trial, status: 'interrupted', interruption: reason, endedAt };
      await repo.commitTrial({ trial: final });
      recovered.push(final);
      continue;
    }
    const engine = TrialEngine.replay(
      { kind: trial.kind === 'benchmark' ? 'benchmark' : 'practice', timing: trial.timing, target: toGraphemes(stored.exercise.text) },
      events,
    );
    const before = engine.events.length;
    const lastAt = events.at(-1)?.atMs ?? 0;
    engine.interrupt(lastAt, reason);
    const added = engine.events.slice(before);
    const final = finalizedTrial(trial, engine.outcome(), endedAt, trial.assistance, engine.events.length, engine.events);
    await repo.commitTrial({ trial: final, chunk: added.length > 0 ? { trialId: trial.id, chunk: chunks.length, events: added } : null });
    recovered.push(final);
  }
  return recovered;
}
