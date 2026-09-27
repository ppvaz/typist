// File exports: full JSON backups, CSV tables, and recovery files for
// results that could not be saved. Everything stays on the device unless the
// user moves the downloaded file.
import { csv } from '../../domain/backup';
import type { BenchmarkSetRecord, SessionRecord, TrialRecord } from '../../domain/records';
import { formatAccuracy, formatWpm } from '../../domain/scoring/metrics';
import { glancesLabel } from '../format';

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const HEADER = [
  'mode',
  'local_date',
  'started_at_utc',
  'kind',
  'protocol',
  'configuration_signature',
  'duration_ms',
  'status',
  'invalidity',
  'interruption',
  'wpm',
  'raw_wpm',
  'accuracy_percent',
  'attempts',
  'correct_attempts',
  'final_correct',
  'corrections',
  'glances',
  'hand',
  'unrecorded_assistance',
  'map_assistance',
  'fatigue_before',
  'fatigue_after',
  'effort',
  'set_id',
  'origin',
  'session_note',
  'trial_note',
];

export function trialsCsv(trials: readonly TrialRecord[], sessions: readonly SessionRecord[] = []): string {
  const bySession = new Map(sessions.map((s) => [s.id, s]));
  const rows = [...trials]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((t) => {
      const s = t.sessionId ? bySession.get(t.sessionId) : undefined;
      const hasInput = t.counters.attempts > 0;
      return [
        t.mode,
        t.localDate,
        t.startedAt,
        t.kind,
        t.protocolId,
        t.signatureHash,
        t.activeMs,
        t.status,
        t.invalidity.join(' '),
        t.interruption ?? '',
        hasInput ? formatWpm(t.counters.finalCorrect, t.activeMs) : '',
        hasInput ? formatWpm(t.counters.attempts, t.activeMs) : '',
        formatAccuracy(t.counters.attemptsCorrect, t.counters.attempts) ?? '',
        t.counters.attempts,
        t.counters.attemptsCorrect,
        t.counters.finalCorrect,
        t.counters.corrections,
        glancesLabel(t.declarations.glances),
        t.declarations.hand ?? 'not declared',
        t.declarations.unrecordedAssistance === null ? 'not declared' : t.declarations.unrecordedAssistance ? 'yes' : 'no',
        [...new Set(t.assistance.shown)].join(' ') + (t.assistance.revealed ? ' (revealed)' : ''),
        s?.fatigueBefore ?? '',
        s?.fatigueAfter ?? '',
        s?.effort ?? '',
        t.benchmarkSetId ?? '',
        t.origin,
        s?.note ?? '',
        t.note ?? '',
      ];
    });
  return csv([HEADER, ...rows]);
}

export function sessionCsv(trials: readonly TrialRecord[], _sets: readonly BenchmarkSetRecord[], sessions: readonly SessionRecord[] = []): string {
  return trialsCsv(trials, sessions);
}
