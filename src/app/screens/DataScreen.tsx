// Data: persistence status, backups, restore and exports. A failed import
// leaves the database unchanged; a full restore replaces local history only
// after a preview and an explicit confirmation.
import { useEffect, useState } from 'react';
import { buildEnvelope, summarize } from '../../domain/backup';
import { addDays, mediumDate } from '../../domain/time';
import { APP_VERSION } from '../../domain/versions';
import { readAllRecords } from '../../storage/backup-io';
import { Message, SaveBadge } from '../components/basics';
import { RestorePanel } from '../components/RestorePanel';
import { bytes } from '../format';
import { downloadText, trialsCsv } from '../runtime/exporting';
import { useAppState, useStore } from '../store/react';

const EVIDENCE_KINDS = new Set(['benchmark', 'assessment', 'monthly', 'baseline']);

export function DataScreen() {
  const store = useStore();
  const state = useAppState();
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setEstimate({ usage: e.usage, quota: e.quota })).catch(() => setEstimate(null));
  }, [state.data.trials.length]);

  async function exportBackup(): Promise<void> {
    if (!store.db) return;
    const records = await readAllRecords(store.db);
    const envelope = buildEnvelope(records, APP_VERSION, new Date().toISOString());
    downloadText(`typist-backup-${state.today}.json`, JSON.stringify(envelope));
    setMessage(`Backup downloaded: ${summarize(records).counts.trials} trials, ${summarize(records).counts.milestones} milestones.`);
  }

  const local = summarize({
    profile: state.data.profile ? [state.data.profile as never] : [],
    setups: state.data.setups as never,
    calibrations: state.data.calibrations as never,
    ledgers: state.data.ledgers as never,
    modeStates: state.data.modeStates as never,
    exercises: [],
    sessions: state.data.sessions as never,
    trials: state.data.trials as never,
    events: [],
    sets: state.data.sets as never,
    milestones: state.data.milestones as never,
    core: state.data.core as never,
    probes: state.data.probes as never,
    planEvents: state.data.planEvents as never,
    customTexts: state.data.customTexts as never,
    dualRuns: [],
  });
  const cutoff = addDays(state.today, -90);
  const prunable = state.data.trials.filter((t) => t.localDate < cutoff && !t.eventsPruned && !EVIDENCE_KINDS.has(t.kind) && t.status !== 'running').length;

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Data · everything stays on this device</div>
          <h1 style={{ marginTop: 8 }}>Backups, exports and storage</h1>
        </div>
        <SaveBadge state={state.save} timeZone={state.data.profile?.timeZone} />
      </div>

      {state.unsaved.length > 0 && (
        <section className="panel panel-pad stack-sm">
          <h2>Results held in memory</h2>
          <Message kind="error">These could not be saved. Download each one before leaving; scored trials stay paused until saving works again.</Message>
          <ul className="rows">
            {state.unsaved.map((u) => (
              <li key={u.id} className="row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span>
                  {u.label} · {new Date(u.at).toLocaleString()}
                </span>
                <span className="inline-actions">
                  <button type="button" className="btn btn-small" onClick={() => downloadText(`typist-recovery-${u.id}.json`, JSON.stringify({ format: 'typist-recovery', formatVersion: 1, appVersion: APP_VERSION, savedAt: u.at, payload: u.payload }))}>
                    Download recovery file
                  </button>
                  <button type="button" className="btn btn-small btn-quiet" onClick={() => store.removeUnsaved(u.id)}>
                    Discard
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel panel-pad stack-sm">
        <h2>Storage</h2>
        <dl className="kv">
          <dt>Persistent storage</dt>
          <dd>
            {state.persisted === true ? 'Granted — the browser will not evict this data under storage pressure.' : state.persisted === false ? 'Not granted — the browser may evict data under pressure. Keep backups.' : 'Unknown in this browser.'}{' '}
            {state.persisted !== true && (
              <button type="button" className="btn btn-small" onClick={() => void store.requestPersistence()}>
                Request persistence
              </button>
            )}
          </dd>
          <dt>Usage</dt>
          <dd>{estimate ? `${bytes(estimate.usage)} of ${bytes(estimate.quota)} available to this site` : 'Not reported by this browser'}</dd>
          <dt>Local history</dt>
          <dd>
            {local.counts.trials} trials · {local.counts.sessions} sessions · {local.counts.sets} benchmark sets · {local.counts.milestones} milestones
            {local.firstDate ? ` · ${mediumDate(local.firstDate)} to ${mediumDate(local.lastDate ?? local.firstDate)}` : ''}
          </dd>
          <dt>Offline</dt>
          <dd>
            {state.offline.state === 'ready'
              ? 'Every app asset is cached; the daily loop works without a connection.'
              : state.offline.state === 'partial'
                ? `Missing from the offline cache: ${state.offline.missing.join(', ')}`
                : state.offline.state === 'dev'
                  ? 'Development build: offline caching is off.'
                  : state.offline.state === 'installing'
                    ? 'Caching…'
                    : `Not available (${state.offline.state}${state.offline.missing[0] ? `: ${state.offline.missing[0]}` : ''}).`}
          </dd>
          <dt>Version</dt>
          <dd>
            Typist {APP_VERSION} · schema 1 · this tab is {state.lease === 'writer' ? 'the writer' : 'read-only'}
          </dd>
        </dl>
      </section>

      <section className="panel panel-pad stack-sm">
        <h2>Export</h2>
        <p>A full backup keeps every record, event log, milestone and its evidence, with a checksum that detects accidental corruption. It is not proof of genuine performance.</p>
        <div className="inline-actions">
          <button type="button" className="btn btn-primary" onClick={() => void exportBackup()}>
            Download full backup (JSON)
          </button>
          <button type="button" className="btn" onClick={() => downloadText(`typist-trials-${state.today}.csv`, trialsCsv(state.data.trials, state.data.sessions), 'text/csv')}>
            Download trials and sessions (CSV)
          </button>
        </div>
        {message && <Message kind="met" tag="Done">{message}</Message>}
      </section>

      <section className="panel panel-pad stack-sm">
        <h2>Import or restore</h2>
        <RestorePanel empty={false} />
      </section>

      <section className="panel panel-pad stack-sm">
        <h2>Practice keystroke logs</h2>
        <p className="small">
          Raw keystrokes of practice older than 90 days may be removed to save space. Block summaries stay, and the trial is marked as having no detailed replay. Benchmark, assessment,
          monthly and baseline evidence is never pruned. Export a backup first.
        </p>
        <button
          type="button"
          className="btn"
          disabled={prunable === 0 || !store.writable}
          onClick={async () => {
            if (!store.repo) return;
            const n = await store.repo.prunePracticeEvents(cutoff, (t) => !EVIDENCE_KINDS.has(t.kind));
            await store.reload();
            setMessage(`Removed detailed keystrokes from ${n} practice trials.`);
          }}
        >
          Prune {prunable} practice log{prunable === 1 ? '' : 's'} older than {mediumDate(cutoff)}
        </button>
      </section>
    </div>
  );
}
