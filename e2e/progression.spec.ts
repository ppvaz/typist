import { expect, test, type Page } from '@playwright/test';
import { freshProfile, records, seedCalibration } from './helpers';

async function devReady(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as { __typistDev?: unknown }).__typistDev);
}

async function passage(page: Page): Promise<string> {
  const text = await page.locator('p.visually-hidden').first().textContent();
  return (text ?? '').replace(/^Target text: /, '');
}

test.describe('M2 guided acquisition', () => {
  test('A06: leaving the page mid-benchmark keeps an interrupted record and needs a fresh trial', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us', primary: 'QL' });
    await seedCalibration(page, 'qwerty-us');
    await page.evaluate(() => (window as unknown as { __typist: { setLevel(...a: unknown[]): Promise<void> } }).__typist.setLevel('QL', 4, 'manual', [], 'test'));
    await page.goto('/#/run/QL/benchmark');
    await page.getByRole('button', { name: 'Start trial 1 of 3' }).click();
    const input = page.getByRole('textbox', { name: /Typing area/ });
    await input.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
    const text = await passage(page);
    await page.keyboard.type(text.slice(0, 12), { delay: 30 });
    await input.evaluate((el) => (el as HTMLTextAreaElement).blur());
    await expect(page.getByText(/it stays in history and a fresh trial replaces it/)).toBeVisible();
    const trials = await records<{ status: string; interruption: string; kind: string; counters: { attempts: number } }>(page, 'trials');
    expect(trials.find((t) => t.kind === 'benchmark' && t.counters.attempts > 0)).toMatchObject({ status: 'interrupted', interruption: 'focus-lost' });
    // The next trial is still trial 1 of 3: an interrupted test never counts.
    await expect(page.getByRole('button', { name: /Start trial 1 of 3|Resting/ })).toBeVisible();
  });

  test('a real 3 × 60 s benchmark set: declarations, then the gate explains itself', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'One real-time set is enough; it takes over five minutes.');
    test.setTimeout(600_000);
    await freshProfile(page, { qwerty: 'qwerty-us', primary: 'QL' });
    await seedCalibration(page, 'qwerty-us');
    await page.evaluate(() => (window as unknown as { __typist: { setLevel(...a: unknown[]): Promise<void> } }).__typist.setLevel('QL', 4, 'manual', [], 'test'));
    await page.goto('/#/run/QL/benchmark');
    for (let trial = 1; trial <= 3; trial += 1) {
      await page.getByRole('button', { name: `Start trial ${trial} of 3` }).click({ timeout: 90_000 });
      const input = page.getByRole('textbox', { name: /Typing area/ });
      await input.waitFor({ timeout: 10_000 });
      await page.waitForTimeout(200);
      await expect(page.getByText('hidden until the end')).toBeVisible();
      await page.keyboard.type((await passage(page)).slice(0, 180), { delay: 25 });
      // The trial ends at exactly 60 s after the first key.
      if (trial < 3) await expect(page.getByText('Rest · one minute between trials')).toBeVisible({ timeout: 70_000 });
    }
    await expect(page.getByRole('heading', { name: 'Declarations for this set' })).toBeVisible({ timeout: 70_000 });
    await page.getByLabel('None').first().check();
    await page.getByLabel('Left hand, as designated').first().check();
    await page.getByRole('group', { name: 'Any assistance Typist could not see?' }).first().getByLabel('None').check();
    await page.getByRole('button', { name: 'Apply trial 1 answers to all' }).click();
    await page.getByRole('button', { name: 'Save declarations' }).click();
    await expect(page.getByText('Stage gate met: one qualifying set at 20 WPM and 97%, no looking.')).toBeVisible();
    const milestones = await records<{ kind: string; mode: string; trialIds: string[] }>(page, 'milestones');
    expect(milestones).toEqual([expect.objectContaining({ kind: 'advance', mode: 'QL' })]);
    expect(milestones[0]?.trialIds).toHaveLength(3);
    const sets = await records<{ status: string; trialIds: string[] }>(page, 'sets');
    expect(sets[0]).toMatchObject({ status: 'complete' });
    const trials = await records<{ activeMs: number; status: string }>(page, 'trials');
    expect(trials.filter((t) => t.status === 'completed').every((t) => t.activeMs === 60_000)).toBe(true);
  });
});

test.describe('M3 maintenance and integration (fixtures)', () => {
  const good = (date: string, wpm: number, acc = 99) => ({ date, trials: [{ wpm, accuracy: acc }, { wpm: wpm + 0.4, accuracy: acc }, { wpm: wpm - 0.4, accuracy: acc }] });

  test('a weakened acquired mode gets two weekly slots inside the budget, with the reason', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
    await freshProfile(page, { qwerty: 'qwerty-us', primary: 'QR', weekdays: [1, 2, 3, 4, 5] });
    for (const l of ['qwerty-us', 'dvorak-left-us', 'dvorak-right-us']) await seedCalibration(page, l);
    await devReady(page);
    await page.evaluate(async (sets) => {
      const w = window as unknown as { __typistDev: { loadHistory(m: string, s: unknown): Promise<unknown> }; __typist: { startMode(m: string): Promise<void>; setLevel(...a: unknown[]): Promise<void> } };
      await w.__typist.startMode('QL');
      await w.__typist.setLevel('QR', 4, 'manual', [], 'test');
      await w.__typistDev.loadHistory('QL', sets);
    }, [good('2026-08-03', 40), good('2026-08-04', 40), good('2026-08-05', 40), good('2026-09-21', 33), good('2026-09-22', 33.4), good('2026-09-23', 33.6)]);
    await page.goto('/#/');
    await expect(page.getByText(/more than 15% below the acquisition baseline/)).toBeVisible();
    const plan = page.getByRole('region', { name: 'Session plan' }).or(page.locator('section[aria-labelledby="plan-title"]'));
    await expect(plan.getByText('QL maintenance')).toBeVisible();
    await expect(plan.getByText(/light warm-up and one benchmark set/)).toBeVisible();
    await expect(plan.getByText(/^30 min$/)).toBeVisible();
    await page.goto('/#/progress/QL');
    await expect(page.getByText(/40\.0 WPM \(mean of the three acquisition sets\)/)).toBeVisible();
  });

  test('switching keeps directions, timeouts and untested pairs; four stable acquired modes unlock the post-core area', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
    await freshProfile(page, { qwerty: 'qwerty-us' });
    await devReady(page);
    await page.evaluate(async (make) => {
      const w = window as unknown as { __typistDev: { loadHistory(m: string, s: unknown): Promise<unknown>; loadProbes(p: unknown): Promise<void> }; __typist: { getState(): { data: { core: unknown[] } } } };
      await w.__typistDev.loadProbes([
        { from: 'QL', to: 'DL', latencyMs: 8200 },
        { from: 'QL', to: 'DL', outcome: 'timeout', latencyMs: null, lowerBoundMs: 30000 },
        { from: 'DL', to: 'QL', latencyMs: 9100 },
      ]);
      for (const mode of ['QL', 'QR', 'DL']) await w.__typistDev.loadHistory(mode, make.slice(0, 3));
      await w.__typistDev.loadHistory('DR', make);
    }, [good('2026-09-10', 32), good('2026-09-12', 32), good('2026-09-14', 32), good('2026-09-28', 33)]);
    await page.goto('/#/progress/switching');
    const row = page.getByRole('row', { name: /QL →/ });
    await expect(row.getByText('1/2 · 1 timeout')).toBeVisible();
    await expect(row.getByText('Not measured').first()).toBeVisible();
    // QL/QR/DL sets are 16+ days old: acquired, but not currently stable.
    await page.goto('/#/progress');
    await expect(page.getByText('Acquired · needs a current passing set').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Expansion' })).toHaveCount(0);
    await page.evaluate(async (make) => {
      const w = window as unknown as { __typistDev: { loadHistory(m: string, s: unknown): Promise<unknown> } };
      for (const mode of ['QL', 'QR', 'DL']) await w.__typistDev.loadHistory(mode, make);
    }, [good('2026-09-29', 33)]);
    await expect(page.getByText(/Core completion recorded on/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Expansion' })).toBeVisible();
    const core = await records<{ milestoneIds: Record<string, string> }>(page, 'core');
    expect(Object.keys(core[0]?.milestoneIds ?? {}).sort()).toEqual(['DL', 'DR', 'QL', 'QR']);
  });
});
