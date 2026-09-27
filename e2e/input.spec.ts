import { expect, test } from '@playwright/test';
import { calibrate, freshProfile, OsKeyboard, records, seedCalibration } from './helpers';

test.describe('first use', () => {
  test('onboarding creates a profile and Today lists calibration, the optional Q2 baseline and level 0', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Setting up · step 1 of 4')).toBeVisible();
    await page.getByLabel('Right').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Typist' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('US', { exact: false }).first().check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Create my plan' }).click();
    await expect(page.getByText('Getting started')).toBeVisible();
    await expect(page.getByText('Optional two-hand QWERTY baseline (Q2)')).toBeVisible();
    const profiles = await records(page, 'profile');
    expect(profiles).toHaveLength(1);
    const states = await records<{ mode: string; level: number; startedAt: string | null }>(page, 'modeStates');
    expect(states.find((s) => s.mode === 'QL')).toMatchObject({ level: 0 });
    expect(states.filter((s) => s.startedAt).map((s) => s.mode)).toEqual(['QL']);
    expect((await records<{ mode: string }>(page, 'ledgers')).map((l) => l.mode).sort()).toEqual(['CL', 'CR', 'DL', 'DR', 'HQL', 'HQR', 'Q2', 'QL', 'QR', 'WL', 'WR']);
  });
});

test.describe('calibration against emulated OS output (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Needs the Chromium DevTools protocol to emulate an OS layout');

  test('US International passes, with dead keys completed by Space', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us-intl' });
    const kb = await OsKeyboard.attach(page, 'qwerty-us-intl');
    const heading = await calibrate(page, kb, 'qwerty-us-intl', 'full');
    expect(heading).toBe('Calibration passed');
    const [cal] = await records<{ status: string; kind: string; checked: number; matched: number }>(page, 'calibrations');
    expect(cal).toMatchObject({ status: 'passed', kind: 'full' });
    expect(cal?.matched).toBe(cal?.checked);
  });

  test('A02: selecting DL while QWERTY is active identifies the mismatch and the likely OS layout', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us' });
    const kb = await OsKeyboard.attach(page, 'qwerty-us');
    await page.goto('/#/setup/calibrate/dvorak-left-us?kind=full');
    await page.getByRole('button', { name: 'Start full calibration' }).click();
    for (const code of ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) {
      await kb.press(code);
      await page.waitForTimeout(120);
    }
    // Skip the rest quickly; the six presses are enough to identify the layout.
    for (let i = 0; i < 200; i += 1) {
      const skip = page.getByRole('button', { name: 'Skip this check' });
      if (!(await skip.isVisible().catch(() => false))) break;
      await skip.click();
    }
    await expect(page.getByRole('heading', { name: 'Calibration found mismatches' })).toBeVisible();
    await expect(page.getByText('The output matches')).toContainText('us');
  });

  test('A02: with Dvorak-L active, KeyQ yields ; and KeyF yields d', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us', primary: 'DL' });
    const kb = await OsKeyboard.attach(page, 'dvorak-left-us');
    await page.goto('/#/setup/calibrate/dvorak-left-us?kind=probe');
    await page.getByRole('button', { name: 'Start the short probe' }).click();
    await kb.press('KeyQ');
    await page.waitForTimeout(120);
    await kb.press('KeyF');
    await page.waitForTimeout(120);
    await kb.press('KeyJ');
    await page.waitForTimeout(120);
    await kb.press('Digit5');
    await page.waitForTimeout(120);
    await kb.press('Digit1', { shift: true });
    await expect(page.getByRole('heading', { name: 'Calibration passed' })).toBeVisible();
  });
});

test.describe('practice input (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Needs the Chromium DevTools protocol to emulate an OS layout');

  async function customPractice(page: import('@playwright/test').Page, text: string, language = 'en') {
    await page.goto('/#/run/QL/custom');
    await page.getByLabel(language === 'pt' ? 'Portuguese' : 'English').check();
    await page.getByLabel('Text to practise').fill(text);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('textbox', { name: /Typing area/ }).waitFor();
    await page.waitForTimeout(300);
  }

  test('A04: c, x, Backspace, a, t against "cat" is 75% attempt accuracy with one correction', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us' });
    const kb = await OsKeyboard.attach(page, 'qwerty-us');
    await seedCalibration(page, 'qwerty-us');
    await customPractice(page, 'cat');
    await kb.type('cx');
    await kb.backspace();
    await kb.type('at');
    await expect(page.getByRole('heading', { name: 'Exercise complete' })).toBeVisible();
    await expect(page.getByText(/Accuracy 75\.00%/)).toBeVisible();
    await expect(page.getByText(/Saved locally/)).toBeVisible();
    const trials = await records<{ counters: Record<string, number>; status: string; verification: string; exercise: { sha256: string } }>(page, 'trials');
    const t = trials.find((x) => x.status === 'completed');
    expect(t?.counters).toMatchObject({ attempts: 4, attemptsCorrect: 3, finalCorrect: 3, corrections: 1 });
    expect(t?.verification).toBe('verified');
    const events = await records<{ trialId: string; events: { kind: string; input?: { code: string | null } }[] }>(page, 'events');
    const inserts = events.flatMap((c) => c.events).filter((e) => e.kind === 'insert');
    expect(inserts.map((e) => e.input?.code)).toEqual(['KeyC', 'KeyX', 'KeyA', 'KeyT']);
    const exercises = await records<{ sha256: string; exercise: { text: string } }>(page, 'exercises');
    expect(exercises.find((e) => e.sha256 === t?.exercise.sha256)?.exercise.text).toBe('cat');
  });

  test('A19: a composed é in custom practice counts as one grapheme', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us' });
    const kb = await OsKeyboard.attach(page, 'qwerty-us');
    await seedCalibration(page, 'qwerty-us');
    await customPractice(page, 'pé', 'pt');
    await kb.type('p');
    await kb.compose('é');
    await expect(page.getByRole('heading', { name: 'Exercise complete' })).toBeVisible();
    const t = (await records<{ counters: Record<string, number>; status: string }>(page, 'trials')).find((x) => x.status === 'completed');
    expect(t?.counters).toMatchObject({ attempts: 2, attemptsCorrect: 2, finalCorrect: 2 });
  });

  test('refuses pasted text in practice and says so', async ({ page }) => {
    await freshProfile(page, { qwerty: 'qwerty-us' });
    const kb = await OsKeyboard.attach(page, 'qwerty-us');
    await seedCalibration(page, 'qwerty-us');
    await customPractice(page, 'the quiet hand');
    await kb.type('th');
    await page.evaluate(() => {
      const el = document.querySelector('textarea.typing-surface') as HTMLTextAreaElement;
      const data = new DataTransfer();
      data.setData('text/plain', 'e quiet hand');
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: 'e quiet hand', bubbles: true, cancelable: true }));
    });
    await expect(page.getByText('Pasted text was refused.')).toBeVisible();
    await expect(page.locator('.counters')).toContainText('2 attempts');
  });
});
