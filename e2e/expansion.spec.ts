// Milestone 5: optional layout expansion after core completion. Colemak and
// Workman are native layouts with their own calibration and evidence;
// Half-QWERTY is an in-app emulation whose results are labeled emulated.
// None of it touches the four core modes' history.
import { expect, type Page, test } from '@playwright/test';
import { calibrate, freshProfile, OsKeyboard, records, seedCore } from './helpers';

interface TrialRow {
  mode: string;
  kind: string;
  status: string;
  layoutId: string;
  inputPath: string;
  verification: string;
  counters: { attempts: number; attemptsCorrect: number; finalCorrect: number };
}

async function custom(page: Page, mode: string, text: string): Promise<void> {
  await page.goto(`/#/run/${mode}/custom`);
  await page.getByLabel('English').check();
  await page.getByLabel('Text to practise').fill(text);
  await page.getByRole('button', { name: 'Start' }).click();
  const input = page.getByRole('textbox', { name: /Typing area/ });
  await input.waitFor();
  await page.waitForTimeout(300);
  await input.focus();
}

test.describe('M5 optional layout expansion', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Layout-accurate typing uses Chromium’s input emulation.');
  });

  test('expansion opens only after core completion and keeps its evidence apart from the core modes', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us', primary: 'QL' });
    await page.goto('/#/expansion');
    await expect(page.getByText('See core completion')).toBeVisible();
    await seedCore(page);
    await page.goto('/#/expansion');
    for (const mode of ['CL', 'CR', 'WL', 'WR', 'HQL', 'HQR']) await expect(page.getByRole('button', { name: `Start ${mode}` })).toBeVisible();
    const before = { modeStates: await records<{ mode: string; level: number; startedAt: string | null }>(page, 'modeStates'), milestones: await records(page, 'milestones') };

    // Colemak on the left hand: native, calibrated against the Colemak table.
    await page.getByRole('button', { name: 'Start CL' }).click();
    const kb = await OsKeyboard.attach(page, 'colemak-us');
    const summary = await calibrate(page, kb, 'colemak-us');
    expect(summary).toMatch(/Calibration passed/);
    await custom(page, 'CL', 'fast track');
    await kb.type('fast track');
    await expect(page.getByRole('heading', { name: 'Exercise complete' })).toBeVisible();

    // Half-QWERTY on the left hand: Space held mirrors F→J, R→U, V→M, Q→P.
    await page.goto('/#/expansion');
    await page.getByRole('button', { name: 'Start HQL' }).click();
    await custom(page, 'HQL', 'jump fast');
    const mirrored = async (code: string) => {
      await page.keyboard.down('Space');
      await page.keyboard.press(code);
      await page.keyboard.up('Space');
    };
    for (const code of ['KeyF', 'KeyR', 'KeyV', 'KeyQ']) await mirrored(code);
    await page.keyboard.press('Space');
    for (const key of ['f', 'a', 's', 't']) await page.keyboard.press(key);
    await expect(page.getByRole('heading', { name: 'Exercise complete' })).toBeVisible();

    const trials = await records<TrialRow>(page, 'trials');
    const cl = trials.find((t) => t.mode === 'CL');
    expect(cl).toMatchObject({ status: 'completed', layoutId: 'colemak-us', inputPath: 'native', verification: 'verified', counters: { attempts: 10, attemptsCorrect: 10 } });
    const hql = trials.find((t) => t.mode === 'HQL');
    expect(hql).toMatchObject({ status: 'completed', inputPath: 'emulated', counters: { attempts: 9, attemptsCorrect: 9 } });
    expect(trials.filter((t) => ['QL', 'QR', 'DL', 'DR', 'Q2'].includes(t.mode))).toEqual([]);

    // The core modes' states and milestones are exactly as before.
    const after = await records<{ mode: string; level: number; startedAt: string | null }>(page, 'modeStates');
    for (const core of ['QL', 'QR', 'DL', 'DR']) expect(after.find((s) => s.mode === core)).toEqual(before.modeStates.find((s) => s.mode === core));
    expect(await records(page, 'milestones')).toEqual(before.milestones);
    await page.goto('/#/expansion');
    await expect(page.getByText('Emulated (physical positions; OS layout not used)').first()).toBeVisible();
  });
});
