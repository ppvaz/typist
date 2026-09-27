import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PREVIEW_URL } from '../playwright.config';
import { freshProfile, records, seedCalibration, waitReady } from './helpers';

async function typeCustom(page: Page, base: string, text: string) {
  await page.goto(`${base}/#/run/QL/custom`);
  await page.getByLabel('English').check();
  await page.getByLabel('Text to practise').fill(text);
  await page.getByRole('button', { name: 'Start' }).click();
  const input = page.getByRole('textbox', { name: /Typing area/ });
  await input.waitFor();
  await page.waitForTimeout(300);
  await input.focus();
  await page.keyboard.type(text, { delay: 15 });
}

test.describe('A17 offline and recovery', () => {
  test('caches once, then the daily loop works offline and saved results survive a restart', async ({ page, context }) => {
    await page.goto(`${PREVIEW_URL}/`);
    await waitReady(page);
    await page.waitForFunction(() => (window as unknown as { __typist: { getState(): { offline: { state: string } } } }).__typist.getState().offline.state === 'ready', null, { timeout: 30_000 });
    await freshProfile(page, { qwerty: 'qwerty-us' }, PREVIEW_URL);
    await expect(page.getByText('Available offline')).toBeVisible();
    await seedCalibration(page, 'qwerty-us');
    await context.setOffline(true);
    await page.reload();
    await waitReady(page);
    await expect(page.getByText(/Working offline/)).toBeVisible();
    await typeCustom(page, PREVIEW_URL, 'offline practice works');
    await expect(page.getByRole('heading', { name: 'Exercise complete' })).toBeVisible();
    await expect(page.getByText(/Saved locally/)).toBeVisible();
    await page.close();
    const again = await context.newPage();
    await again.goto(`${PREVIEW_URL}/#/data`);
    await waitReady(again);
    await expect(again.getByText(/1 trials/)).toBeVisible();
    const trials = await records<{ status: string; counters: { attempts: number } }>(again, 'trials');
    expect(trials.filter((t) => t.status === 'completed')).toHaveLength(1);
    await context.setOffline(false);
  });

  test('a page killed mid-run is recovered as an interrupted record on the next start', async ({ page, context, browserName }) => {
    await freshProfile(page, { qwerty: 'qwerty-us' });
    await seedCalibration(page, 'qwerty-us');
    await page.goto('/#/run/QL/custom');
    await page.getByLabel('English').check();
    await page.getByLabel('Text to practise').fill('the quiet hand returns to the ridge');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: /Typing area/ }).waitFor();
    await page.waitForTimeout(300);
    await page.keyboard.type('the quiet', { delay: 20 });
    await page.waitForTimeout(1500); // at least one journal flush
    void browserName;
    await page.close({ runBeforeUnload: false });
    const next = await context.newPage();
    await next.goto('/');
    await waitReady(next);
    const trials = await records<{ status: string; interruption: string | null; counters: { attempts: number } }>(next, 'trials');
    const t = trials.find((x) => x.counters.attempts > 0);
    expect(t?.status).toBe('interrupted');
    expect(['recovered-after-restart', 'page-closed']).toContain(t?.interruption);
    expect(t?.counters.attempts).toBe(9);
  });
});

test.describe('A18 backup safety (development fixtures)', () => {
  test('restore into a fresh profile keeps IDs and evidence; identical re-import adds nothing; bad files change nothing', async ({ page, browser }, testInfo) => {
    await freshProfile(page, { qwerty: 'qwerty-us' });
    await page.waitForFunction(() => !!(window as unknown as { __typistDev?: unknown }).__typistDev);
    await page.evaluate(async () => {
      const dev = (window as unknown as { __typistDev: { loadHistory(m: string, s: unknown): Promise<unknown> } }).__typistDev;
      const set = (date: string) => ({ date, trials: [{ wpm: 32, accuracy: 99 }, { wpm: 31, accuracy: 99 }, { wpm: 33, accuracy: 99 }] });
      await dev.loadHistory('QL', [set('2026-09-01'), set('2026-09-02'), set('2026-09-03')]);
    });
    const milestones = await records<{ id: string; kind: string; setIds: string[] }>(page, 'milestones');
    expect(milestones.map((m) => m.kind).sort()).toEqual(['acquired', 'advance']);
    await page.goto('/#/data');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download full backup (JSON)' }).click();
    const file = testInfo.outputPath('backup.json');
    await (await download).saveAs(file);

    // A fresh browser profile restores from the onboarding screen.
    const fresh = await browser.newContext();
    const p2 = await fresh.newPage();
    await p2.goto('/');
    await p2.getByText('Restoring from a Typist backup instead?').click();
    await p2.getByLabel('Backup file').setInputFiles(file);
    await expect(p2.getByText(/Preview/)).toBeVisible();
    await p2.getByRole('button', { name: 'Restore this backup' }).click();
    await expect(p2.getByText(/Four modes|Today you/)).toBeVisible({ timeout: 10_000 });
    const restored = await records<{ id: string; kind: string; setIds: string[] }>(p2, 'milestones');
    expect(restored.map((m) => m.id).sort()).toEqual(milestones.map((m) => m.id).sort());
    const restoredTrials = await records<{ id: string; origin: string }>(p2, 'trials');
    expect(restoredTrials.every((t) => t.origin === 'restored-typist')).toBe(true);

    // Re-importing the same backup is idempotent.
    await p2.goto('/#/data');
    await p2.getByLabel('Backup file').setInputFiles(file);
    await expect(p2.getByText(/Merge would add 0 records/)).toBeVisible();
    await p2.getByRole('button', { name: 'Merge into local history' }).click();
    await expect(p2.getByText(/0 records written/)).toBeVisible();
    expect((await records(p2, 'trials')).length).toBe(restoredTrials.length);

    // A tampered file and a newer format are rejected without changes.
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    envelope.records.trials[0].note = 'edited after export';
    const tampered = testInfo.outputPath('tampered.json');
    writeFileSync(tampered, JSON.stringify(envelope));
    await p2.getByLabel('Backup file').setInputFiles(tampered);
    await expect(p2.getByText(/checksum does not match/)).toBeVisible();
    const newer = testInfo.outputPath('newer.json');
    writeFileSync(newer, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), formatVersion: 99 }));
    await p2.getByLabel('Backup file').setInputFiles(newer);
    await expect(p2.getByText(/newer than this app supports/)).toBeVisible();
    expect((await records(p2, 'trials')).length).toBe(restoredTrials.length);
    await fresh.close();
  });
});

test.describe('A21 save failure and a second writer', () => {
  test('a failed commit shows the result unsaved with a recovery download; retry saves it', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us' });
    await seedCalibration(page, 'qwerty-us');
    await page.evaluate(() => {
      const store = (window as unknown as { __typist: { repo: { failNextCommit: Error | null } } }).__typist;
      store.repo.failNextCommit = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    await typeCustom(page, '', 'full disk');
    await expect(page.getByText(/storage is full/).first()).toBeVisible();
    await expect(page.getByText(/This result is held in memory/)).toBeVisible();
    await expect(page.getByText(/could not be saved and are held in memory/)).toBeVisible();
    await page.getByRole('button', { name: 'Retry saving' }).click();
    await expect(page.getByText(/Saved locally/)).toBeVisible();
    await expect(page.getByText(/could not be saved and are held in memory/)).toHaveCount(0);
    const trials = await records<{ status: string }>(page, 'trials');
    expect(trials.filter((t) => t.status === 'completed')).toHaveLength(1);
  });

  test('a second tab is read-only until it explicitly takes over, which interrupts the first tab', async ({ page, context }) => {
    await freshProfile(page, { qwerty: 'qwerty-us' });
    await seedCalibration(page, 'qwerty-us');
    await page.goto('/#/run/QL/custom');
    await page.getByLabel('English').check();
    await page.getByLabel('Text to practise').fill('two tabs cannot both write');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: /Typing area/ }).waitFor();
    await page.waitForTimeout(300);
    await page.keyboard.type('two', { delay: 20 });
    const second = await context.newPage();
    await second.goto('/#/data');
    await waitReady(second);
    await expect(second.getByText(/This tab is read-only/).first()).toBeVisible();
    await second.getByRole('button', { name: /Take over writing here/ }).click();
    await expect(second.getByText(/This tab is read-only/)).toHaveCount(0);
    await expect(page.getByText(/Another tab took over writing/).first()).toBeVisible({ timeout: 10_000 });
    const trials = await records<{ status: string; interruption: string | null }>(second, 'trials');
    expect(trials.find((t) => t.status === 'interrupted')?.interruption).toBe('writer-lost');
  });
});
