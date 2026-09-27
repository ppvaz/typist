// Import or restore a full backup. Everything is validated before any write;
// a failed import leaves the database unchanged; replacing local history
// needs a preview and an explicit confirmation.
import { useState } from 'react';
import { type BackupEnvelope, buildEnvelope, type ImportPlan, planImport, summarize, validateEnvelope } from '../../domain/backup';
import { mediumDate } from '../../domain/time';
import { APP_VERSION } from '../../domain/versions';
import { applyImport, readAllRecords } from '../../storage/backup-io';
import { downloadText } from '../runtime/exporting';
import { useAppState, useStore } from '../store/react';
import { Message } from './basics';

export function RestorePanel({ empty }: { empty: boolean }) {
  const store = useStore();
  const state = useAppState();
  const [incoming, setIncoming] = useState<BackupEnvelope | null>(null);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportCurrent(): Promise<void> {
    if (!store.db) return;
    const records = await readAllRecords(store.db);
    downloadText(`typist-backup-${state.today}.json`, JSON.stringify(buildEnvelope(records, APP_VERSION, new Date().toISOString())));
  }

  async function readFile(file: File): Promise<void> {
    setErrors([]);
    setPlan(null);
    setIncoming(null);
    setConfirmReplace(false);
    setMessage(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = validateEnvelope(parsed);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setIncoming(result.envelope);
      if (store.db) setPlan(planImport(await readAllRecords(store.db), result.envelope.records, 'merge'));
    } catch (e) {
      setErrors([`The file could not be read as JSON: ${e instanceof Error ? e.message : String(e)}`]);
    }
  }

  async function apply(mode: 'merge' | 'replace'): Promise<void> {
    if (!store.db || !incoming) return;
    setBusy(true);
    try {
      const next = planImport(await readAllRecords(store.db), incoming.records, mode);
      if (next.conflicts.length > 0) {
        setPlan(next);
        setErrors([`${next.conflicts.length} record(s) conflict with local data; nothing was imported.`]);
        return;
      }
      const written = await applyImport(store.db, next, store.tab);
      await store.reload();
      setMessage(`${mode === 'replace' ? 'Restored' : 'Merged'}: ${written} records written, ${next.identical} identical records skipped. Derived views were recomputed; historical labels are unchanged.`);
      setIncoming(null);
      setPlan(null);
      setConfirmReplace(false);
    } catch (e) {
      setErrors([`Import failed and the database was left unchanged: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setBusy(false);
    }
  }

  const summary = incoming ? summarize(incoming.records) : null;
  const adds = plan ? Object.values(plan.adds).reduce((s, l) => s + l.length, 0) : 0;
  return (
    <div className="stack-sm">
      <p className="small muted">The file is validated completely before anything is written: versions, bounds, IDs, references, characters and checksum. Identical records import once; conflicting ones reject the whole import.</p>
      <label htmlFor="import-file">Backup file</label>
      <input
        id="import-file"
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void readFile(f);
        }}
      />
      {errors.length > 0 && (
        <Message kind="error" tag="Rejected">
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          Nothing was changed.
        </Message>
      )}
      {message && (
        <Message kind="met" tag="Done">
          {message}
        </Message>
      )}
      {incoming && summary && (
        <div className="stack-sm">
          <Message kind="observed" tag="Preview">
            Backup from {incoming.exportedAt ? new Date(incoming.exportedAt).toLocaleString() : 'an unknown time'} (Typist {incoming.appVersion}): {summary.counts.trials} trials, {summary.counts.sessions} sessions,{' '}
            {summary.counts.sets} sets, {summary.counts.milestones} milestones{summary.firstDate ? `, ${mediumDate(summary.firstDate)} to ${mediumDate(summary.lastDate ?? summary.firstDate)}` : ''}.
          </Message>
          {plan && (
            <p className="small">
              Merge would add {adds} records and skip {plan.identical} identical ones.
              {plan.conflicts.length > 0 ? ` ${plan.conflicts.length} conflict(s): ${plan.conflicts.slice(0, 5).map((c) => `${c.store} ${c.key}`).join(', ')} — merge is not possible.` : ''}
            </p>
          )}
          <div className="inline-actions">
            {empty ? (
              <button type="button" className="btn btn-primary" disabled={busy || !store.writable} onClick={() => void apply('replace')}>
                Restore this backup
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled={busy || !plan || plan.conflicts.length > 0 || !store.writable} onClick={() => void apply('merge')}>
                  Merge into local history
                </button>
                {!confirmReplace ? (
                  <button type="button" className="btn btn-danger" disabled={busy || !store.writable} onClick={() => setConfirmReplace(true)}>
                    Replace local history…
                  </button>
                ) : (
                  <span className="inline-actions">
                    <Message kind="short" tag="Confirm">
                      This replaces {state.data.trials.length} local trials and {state.data.milestones.length} milestones with the backup. Download a backup of the current data first.
                    </Message>
                    <button type="button" className="btn" onClick={() => void exportCurrent()}>
                      Back up current data
                    </button>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void apply('replace')}>
                      Replace now
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => setConfirmReplace(false)}>
                      Cancel
                    </button>
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
