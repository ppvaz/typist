import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { freshProfile, seedCalibration, seedCore } from './helpers';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
}

async function axe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: AxeViolation[] }> } }).axe.run;
    return run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
  });
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

function describe(violations: AxeViolation[]): string {
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} ${n.failureSummary?.split('\n')[1] ?? ''}`).join('\n  ')}`).join('\n');
}

async function withHistory(page: Page): Promise<string> {
  await freshProfile(page, { qwerty: 'qwerty-us', primary: 'QR' });
  for (const l of ['qwerty-us', 'dvorak-left-us', 'dvorak-right-us']) await seedCalibration(page, l);
  await page.waitForFunction(() => !!(window as unknown as { __typistDev?: unknown }).__typistDev);
  return page.evaluate(async () => {
    const w = window as unknown as { __typistDev: { loadHistory(m: string, s: unknown): Promise<unknown> }; __typist: { setLevel(...a: unknown[]): Promise<void>; startMode(m: string): Promise<void>; getState(): { data: { sessions: { id: string }[] } } } };
    await w.__typist.startMode('QL');
    await w.__typist.setLevel('QR', 4, 'manual', [], 'a11y fixture');
    const set = (date: string, wpm: number) => ({ date, trials: [{ wpm, accuracy: 98.5 }, { wpm: wpm + 0.4, accuracy: 99 }, { wpm: wpm - 0.2, accuracy: 97.5, glances: 'unknown' }] });
    await w.__typistDev.loadHistory('QL', [set('2026-09-01', 24), set('2026-09-03', 31), set('2026-09-05', 32)]);
    await w.__typistDev.loadHistory('QR', [set('2026-09-04', 18)]);
    return w.__typist.getState().data.sessions[0]?.id ?? '';
  });
}

test.describe('A20 accessible operation', () => {
  test('no serious or critical WCAG 2.1 AA violations on the main screens, light and dark', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    expect(describe(await axe(page)), 'onboarding').toBe('');
    const sessionId = await withHistory(page);
    // Unlock the post-core screens so they are scanned too.
    await seedCore(page);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((t) => (window as unknown as { __typist: { updateUi(p: unknown): Promise<void> } }).__typist.updateUi({ theme: t }), theme);
      for (const route of ['/', '/practice', '/progress', '/progress/QL', '/progress/switching', '/progress/monthly', '/setup', '/setup/ledger/QR', '/data', `/review/${sessionId}`, '/expansion', '/dual']) {
        await page.goto(`/#${route}`);
        await page.waitForTimeout(250);
        expect(describe(await axe(page)), `${theme} ${route}`).toBe('');
      }
      await page.goto('/#/run/QR/prose');
      await page.getByRole('textbox', { name: /Typing area/ }).waitFor();
      await page.waitForTimeout(400);
      await page.keyboard.type('In the', { delay: 20 });
      expect(describe(await axe(page)), `${theme} practice`).toBe('');
      await page.goto('/#/setup/calibrate/dvorak-left-us?kind=probe');
      await page.getByRole('button', { name: 'Start the short probe' }).click();
      expect(describe(await axe(page)), `${theme} calibration`).toBe('');
    }
  });

  test('keyboard only: start, practise, leave the input, end, log and review — with visible focus and no trap', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
    await freshProfile(page, { qwerty: 'qwerty-us' });
    await seedCalibration(page, 'qwerty-us');
    await page.goto('/#/');
    const start = page.getByRole('button', { name: "Start today's session" });
    await start.waitFor();
    // Reach the primary action with Tab alone.
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      if (await start.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(start).toBeFocused();
    const outline = await start.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    const begin = page.getByRole('button', { name: 'Begin' });
    await begin.waitFor();
    await begin.focus();
    await page.keyboard.press('Enter');
    const startBlock = page.getByRole('button', { name: 'Start block' });
    await startBlock.waitFor();
    await startBlock.focus();
    await page.keyboard.press('Enter');
    const input = page.getByRole('textbox', { name: /Typing area/ });
    await input.waitFor();
    await page.waitForTimeout(400);
    await expect(input).toBeFocused();
    await page.keyboard.type('ab', { delay: 30 });
    // Tab leaves the typing area: focus is never trapped.
    await page.keyboard.press('Tab');
    await expect(input).not.toBeFocused();
    await input.focus();
    // Escape ends the exercise; the result gets focus.
    await page.keyboard.press('Escape');
    const next = page.getByRole('button', { name: 'Next exercise' });
    await expect(next).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); // End block
    const endSession = page.getByRole('button', { name: 'End session here' });
    await endSession.waitFor();
    await endSession.focus();
    await page.keyboard.press('Enter');
    // Ordinal scales are native radios operated by keyboard.
    const fatigue = page.getByRole('radiogroup', { name: 'Fatigue after the session' }).getByRole('radio').nth(2);
    await fatigue.focus();
    await page.keyboard.press('Space');
    await expect(fatigue).toBeChecked();
    const save = page.getByRole('button', { name: 'Save the log' });
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Plan tomorrow')).toBeVisible();
  });

  test('200% zoom reflows without horizontal scrolling and never changes the assistance level', async ({ page }) => {
    await withHistory(page);
    await page.setViewportSize({ width: 640, height: 360 });
    for (const route of ['/', '/progress', '/progress/QL', '/setup', '/data']) {
      await page.goto(`/#${route}`);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, route).toBeLessThanOrEqual(1);
    }
    await page.goto('/#/run/QR/prose');
    await page.getByRole('textbox', { name: /Typing area/ }).waitFor();
    await page.getByRole('radio', { name: 'Off' }).check();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setViewportSize({ width: 640, height: 360 });
    await expect(page.getByRole('radio', { name: 'Off' })).toBeChecked();
    await expect(page.locator('.kbd-map')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('reduced motion stops the caret animation; the input is labeled and results are announced once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await freshProfile(page, { qwerty: 'qwerty-us' });
    await seedCalibration(page, 'qwerty-us');
    await page.goto('/#/run/QL/custom');
    await page.getByLabel('English').check();
    await page.getByLabel('Text to practise').fill('abc');
    await page.getByRole('button', { name: 'Start' }).click();
    const input = page.getByRole('textbox', { name: /Typing area for QL/ });
    await input.waitFor();
    const animation = await page.locator('.c.current').first().evaluate((el) => getComputedStyle(el, '::before').animationName);
    expect(animation).toBe('none');
    await page.waitForTimeout(300);
    await page.keyboard.type('abc', { delay: 30 });
    await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Finished' })).toHaveCount(1);
  });
});
