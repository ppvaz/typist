// Reading every store for a backup, and applying a validated import in a
// single transaction across all stores: a failed import leaves the current
// database unchanged.
import type { IDBPTransaction, StoreNames } from 'idb';
import { BACKUP_STORES, type BackupRecords, type ImportPlan } from '../domain/backup';
import type { LeaseRecord, TypistDB, TypistSchema } from './db';
import { LeaseLostError } from './repo';

export async function readAllRecords(db: TypistDB): Promise<BackupRecords> {
  const tx = db.transaction([...BACKUP_STORES], 'readonly');
  const lists = await Promise.all(BACKUP_STORES.map((s) => tx.objectStore(s).getAll()));
  await tx.done;
  return Object.fromEntries(BACKUP_STORES.map((s, i) => [s, lists[i] as unknown as Record<string, unknown>[]])) as unknown as BackupRecords;
}

type AnyTx = IDBPTransaction<TypistSchema, StoreNames<TypistSchema>[], 'readwrite'>;

/** Apply a conflict-free plan atomically. `replace` clears every store first. */
export async function applyImport(db: TypistDB, plan: ImportPlan, holderId: string): Promise<number> {
  if (plan.conflicts.length > 0) throw new Error('Refusing to import a plan with conflicts.');
  const tx = db.transaction(['meta', ...BACKUP_STORES], 'readwrite') as unknown as AnyTx;
  const lease = (await tx.objectStore('meta').get('lease')) as LeaseRecord | undefined;
  if (!lease || lease.holderId !== holderId) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new LeaseLostError();
  }
  let written = 0;
  try {
    if (plan.mode === 'replace') for (const store of BACKUP_STORES) await tx.objectStore(store).clear();
    for (const store of BACKUP_STORES) {
      for (const record of plan.adds[store]) {
        await tx.objectStore(store).put(record as never);
        written += 1;
      }
    }
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already finished or aborted by the failure itself.
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
  return written;
}
