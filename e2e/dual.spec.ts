// Milestone 6: two "machines" are two isolated browser contexts (separate
// IndexedDB, separate focus) talking to the real coordinator, which also
// serves the production build, as on a home network.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { startServer } from '../server/coordinator.mjs';
import { freshProfile, OsKeyboard, records, seedCalibration, seedCore, waitReady } from './helpers';

let base = '';
let close: (() => Promise<void>) | null = null;

test.beforeAll(async () => {
  const started = await startServer({ port: 0, host: '127.0.0.1', http: true, dist: 'dist', log: () => {} });
  base = `http://127.0.0.1:${started.port}`;
  close = () =>
    new Promise((resolve) => {
      for (const ws of started.wss.clients) ws.terminate();
      started.server.close(() => resolve());
    });
});

test.afterAll(async () => {
  await close?.();
});

interface Machine {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly kb: OsKeyboard;
}

/** A machine with a profile, a calibrated layout and core completion (the module's gate). */
async function machine(browser: Browser, layoutId: 'qwerty-us' | 'dvorak-right-us', primary: 'QL' | 'DR'): Promise<Machine> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await freshProfile(page, { qwerty: 'qwerty-us', primary }, base);
  await seedCalibration(page, layoutId);
  await seedCore(page);
  const kb = await OsKeyboard.attach(page, layoutId);
  return { context, page, kb };
}

async function openRoom(left: Machine, right: Machine, level: 'D1' | 'D5' = 'D1'): Promise<string> {
  await left.page.goto(`${base}/#/dual`);
  await left.page.getByLabel(level, { exact: true }).check();
  await left.page.getByRole('button', { name: 'Create a room' }).click();
  const link = (await left.page.getByTestId('join-link').textContent()) ?? '';
  expect(link).toContain('role=right');
  await right.page.goto(link);
  await waitReady(right.page);
  await expect(right.page.getByTestId('dual-role')).toHaveText(/Right machine/);
  await right.page.getByRole('button', { name: 'Join as the right machine' }).click();
  await expect(left.page.getByTestId('peer-right')).toContainText('connected · DR');
  await expect(right.page.getByTestId('peer-left')).toContainText('connected · QL');
  return (await left.page.getByTestId('room-code').textContent()) ?? '';
}

async function proposeAndArm(left: Machine, right: Machine, level: 'D1' | 'D5'): Promise<void> {
  await left.page.getByRole('button', { name: `Propose a ${level} run` }).click();
  for (const m of [left, right]) {
    await expect(m.page.getByTestId('manifest')).toContainText(`Proposed run · ${level}`);
    await m.page.getByRole('button', { name: 'Acknowledge this manifest' }).click();
  }
  for (const m of [left, right]) await m.page.getByRole('button', { name: 'Ready to start' }).click();
  // The coordinator schedules a common start at least five seconds ahead.
  for (const m of [left, right]) await m.page.waitForURL(/#\/dual\/run/);
}

async function waitForGo(page: Page): Promise<void> {
  await page.locator('.start-cue[data-state="go"], .start-cue[data-state="done"]').waitFor({ timeout: 15_000 });
}

async function target(page: Page): Promise<string> {
  const text = await page.locator('p.visually-hidden').first().textContent();
  return (text ?? '').replace(/^Target text: /, '');
}

async function report(page: Page): Promise<void> {
  await page.getByLabel('None', { exact: true }).check();
  await page.getByRole('button', { name: "Save and send this side's result" }).click();
  await page.waitForURL(/#\/dual$/);
}

test.describe('M6 two machines', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Layout-accurate typing on two machines uses Chromium’s input emulation.');
  });

  test('A23: QL and DR join one room, verify one manifest, and record separate outputs in a shared minute', async ({ browser }) => {
    test.setTimeout(240_000);
    const left = await machine(browser, 'qwerty-us', 'QL');
    const right = await machine(browser, 'dvorak-right-us', 'DR');
    await openRoom(left, right);

    // A third machine cannot take a role that is already assigned.
    const third = await machine(browser, 'qwerty-us', 'QL');
    const code = (await left.page.getByTestId('room-code').textContent()) ?? '';
    await third.page.goto(`${base}/#/dual?room=${code}&role=right`);
    await third.page.getByRole('button', { name: 'Join as the right machine' }).click();
    await expect(third.page.getByText('The right role is already taken in this room.')).toBeVisible();
    await third.context.close();

    await proposeAndArm(left, right, 'D1');
    await Promise.all([waitForGo(left.page), waitForGo(right.page)]);
    const text = await target(left.page);
    expect(await target(right.page)).toBe(text);
    await left.kb.type(text.slice(0, 20));
    await right.kb.type(text.slice(0, 14));
    for (const m of [left, right]) await expect(m.page.getByRole('heading', { name: 'Shared minute over' })).toBeVisible({ timeout: 75_000 });
    await report(left.page);
    await report(right.page);

    for (const m of [left, right]) {
      await expect(m.page.getByTestId('run-verdict')).toHaveText(/Complete: both results arrived/);
      await expect(m.page.getByTestId('run-sync')).toContainText('Synchronized');
      await expect(m.page.getByTestId('side-left')).toContainText('QL · d1-string');
      await expect(m.page.getByTestId('side-right')).toContainText('DR · d1-string');
      // No matched solo baselines were measured, so there is no ratio.
      await expect(m.page.getByTestId('run-efficiency')).toContainText('Efficiency unavailable');
      await expect(m.page.getByTestId('run-efficiency')).toContainText('solo baseline is missing');
    }
    await expect(left.page.getByTestId('side-left')).toContainText('4.0 WPM');
    const leftRuns = await records<{ role: string; source: string; coordinated: string; stream: unknown[] | null }>(left.page, 'dualRuns');
    expect(leftRuns.map((r) => [r.role, r.source, r.coordinated]).sort()).toEqual([
      ['left', 'local', 'complete'],
      ['right', 'relay', 'complete'],
    ]);
    const leftTrials = await records<{ kind: string; status: string; protocolId: string }>(left.page, 'trials');
    expect(leftTrials.filter((t) => t.kind === 'dual')).toEqual([expect.objectContaining({ status: 'completed', protocolId: 'dual-copy-60-v1' })]);

    // Cross-stream analysis: import the right machine's side file on the left, twice.
    const download = right.page.waitForEvent('download');
    await right.page.getByRole('button', { name: 'Export right side' }).click();
    const file = join(test.info().outputDir, 'right-side.json');
    await (await download).saveAs(file);
    await left.page.locator('#side-files').setInputFiles(file);
    await expect(left.page.getByTestId('import-outcomes')).toContainText('Added the detailed stream for the right side');
    await expect(left.page.getByTestId('cross-stream-run')).toContainText('possible substitution');
    await left.page.locator('#side-files').setInputFiles([]);
    await left.page.locator('#side-files').setInputFiles(file);
    await expect(left.page.getByTestId('import-outcomes')).toContainText('Already stored: the right side');
    expect(await records(left.page, 'dualRuns')).toHaveLength(2);
    // A file whose manifest was altered cannot merge.
    const tampered = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8')) as { record: { manifest: { seed: number } } };
    tampered.record.manifest.seed += 1;
    const tamperedFile = join(test.info().outputDir, 'tampered.json');
    writeFileSync(tamperedFile, JSON.stringify(tampered));
    await left.page.locator('#side-files').setInputFiles(tamperedFile);
    await expect(left.page.getByTestId('import-outcomes')).toContainText('Rejected');
    await left.context.close();
    await right.context.close();
  });

  test('A23: a mismatched manifest cannot be acknowledged; a stop and a lost side end the run explicitly', async ({ browser }) => {
    test.setTimeout(180_000);
    const left = await machine(browser, 'qwerty-us', 'QL');
    const right = await machine(browser, 'dvorak-right-us', 'DR');
    await openRoom(left, right);
    await left.page.getByRole('button', { name: 'Propose a D1 run' }).click();
    await expect(right.page.getByTestId('manifest')).toBeVisible();
    // The right machine switches to QR after the proposal: the manifest no longer matches it.
    await right.page.getByLabel(/^QR/).check();
    await expect(right.page.getByText(/The manifest expects DR here, but this machine is set up for QR/)).toBeVisible();
    await expect(right.page.getByRole('button', { name: 'Acknowledge this manifest' })).toHaveCount(0);
    await right.page.getByLabel(/^DR/).check();

    // Stop on one machine notifies the other; neither timer freezes.
    for (const m of [left, right]) await m.page.getByRole('button', { name: 'Acknowledge this manifest' }).click();
    for (const m of [left, right]) await m.page.getByRole('button', { name: 'Ready to start' }).click();
    for (const m of [left, right]) await m.page.waitForURL(/#\/dual\/run/);
    await Promise.all([waitForGo(left.page), waitForGo(right.page)]);
    await left.kb.type((await target(left.page)).slice(0, 6));
    await left.page.getByRole('button', { name: 'Stop both machines' }).click();
    await expect(right.page.getByText('Stopped by the left side: stopped on the left machine')).toBeVisible();
    await report(left.page);
    await report(right.page);
    for (const m of [left, right]) await expect(m.page.getByTestId('run-verdict')).toHaveText(/Stopped by the left machine/);
    const rightTrials = await records<{ kind: string; status: string; interruption: string | null }>(right.page, 'trials');
    expect(rightTrials.find((t) => t.kind === 'dual')).toMatchObject({ status: 'interrupted', interruption: 'peer-stopped' });

    // Focus loss on one machine interrupts its side and notifies the other.
    await left.page.getByRole('button', { name: 'Set up another run' }).click();
    await expect(right.page.getByText('Waiting for the left machine to propose a run.')).toBeVisible();
    await proposeAndArm(left, right, 'D1');
    await Promise.all([waitForGo(left.page), waitForGo(right.page)]);
    await right.kb.type((await target(right.page)).slice(0, 4));
    await right.page.getByRole('textbox', { name: /Typing area/ }).evaluate((el) => (el as HTMLTextAreaElement).blur());
    await expect(left.page.getByText('Stopped by the right side: focus lost on the right machine')).toBeVisible();
    await report(right.page);
    await report(left.page);
    await expect(left.page.getByTestId('run-verdict')).toHaveText(/Stopped by the right machine \(focus lost on the right machine\)/);

    // A lost side: the run is incomplete, and local work is kept.
    await left.page.getByRole('button', { name: 'Set up another run' }).click();
    await expect(right.page.getByText('Waiting for the left machine to propose a run.')).toBeVisible();
    await proposeAndArm(left, right, 'D1');
    await waitForGo(left.page);
    await left.kb.type((await target(left.page)).slice(0, 5));
    await right.context.close();
    await expect(left.page.getByText(/The right side disconnected; this run is incomplete/)).toBeVisible();
    await left.page.getByRole('button', { name: 'Stop both machines' }).click();
    await report(left.page);
    await expect(left.page.getByTestId('run-verdict')).toHaveText(/Incomplete/);
    const runs = await records<{ coordinated: string; role: string }>(left.page, 'dualRuns');
    expect(runs.filter((r) => r.coordinated === 'incomplete')).toEqual([expect.objectContaining({ role: 'left' })]);
    await left.context.close();
  });

  test('A23: clock uncertainty above 100 ms labels the run unsynchronized', async ({ browser }) => {
    test.setTimeout(120_000);
    const left = await machine(browser, 'qwerty-us', 'QL');
    const right = await machine(browser, 'dvorak-right-us', 'DR');
    // Every coordinator message reaches the right machine 250 ms late: its
    // best ping round trip is at least that, so its uncertainty exceeds 100 ms.
    await right.page.routeWebSocket(/\/dual\/ws$/, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => setTimeout(() => ws.send(message), 250));
      ws.onMessage((message) => server.send(message));
    });
    // The route replaces the page's WebSocket on the next load.
    await right.page.reload();
    await waitReady(right.page);
    await openRoom(left, right);
    await expect(left.page.getByTestId('peer-right')).toContainText(/clock ±1\d\d ms/);
    await proposeAndArm(left, right, 'D1');
    await Promise.all([waitForGo(left.page), waitForGo(right.page)]);
    await left.kb.type((await target(left.page)).slice(0, 5));
    await left.page.getByRole('button', { name: 'Stop both machines' }).click();
    await expect(right.page.getByText(/Stopped by the left side/)).toBeVisible();
    await report(left.page);
    await report(right.page);
    for (const m of [left, right]) await expect(m.page.getByTestId('run-sync')).toContainText(/Unsynchronized: The right clock uncertainty was 1\d\d ms \(limit 100\)/);
    await left.context.close();
    await right.context.close();
  });

  test('A24: in D5 the copy side is scored and the composition side has production WPM and no accuracy', async ({ browser }) => {
    test.setTimeout(200_000);
    const left = await machine(browser, 'qwerty-us', 'QL');
    const right = await machine(browser, 'dvorak-right-us', 'DR');
    await openRoom(left, right, 'D5');
    await proposeAndArm(left, right, 'D5');
    await Promise.all([waitForGo(left.page), waitForGo(right.page)]);
    await left.kb.type((await target(left.page)).slice(0, 15));
    await right.page.locator('#composition').focus();
    await right.kb.type('the rain fell hard');
    await right.kb.backspace(4);
    await expect(right.page.getByRole('heading', { name: 'Shared minute over' })).toBeVisible({ timeout: 75_000 });
    await expect(right.page.getByText('accuracy not measured')).toBeVisible();
    await right.page.getByLabel('3', { exact: true }).check();
    await report(right.page);
    await expect(left.page.getByRole('heading', { name: 'Shared minute over' })).toBeVisible({ timeout: 10_000 });
    await report(left.page);
    for (const m of [left, right]) {
      await expect(m.page.getByTestId('run-verdict')).toHaveText(/Complete/);
      await expect(m.page.getByTestId('side-right')).toContainText('2.8 production WPM · 4 deletions · accuracy not measured · coherence 3/5');
      await expect(m.page.getByTestId('side-left')).toContainText('%');
      await expect(m.page.getByTestId('run-efficiency')).toContainText('A composition side has no verified copy WPM');
    }
    const [rightLocal] = (await records<{ source: string; compositionText: string | null; result: { accuracy: number | null } }>(right.page, 'dualRuns')).filter((r) => r.source === 'local');
    expect(rightLocal).toMatchObject({ compositionText: 'the rain fell ', result: { accuracy: null } });
    await left.context.close();
    await right.context.close();
  });

  test('solo practice still works with the relay unavailable', async ({ browser }) => {
    const solo = await machine(browser, 'qwerty-us', 'QL');
    await solo.page.goto(`${base}/#/dual`);
    await solo.page.getByLabel('Coordinator address').fill('ws://127.0.0.1:9/dual/ws');
    await solo.page.getByRole('button', { name: 'Create a room' }).click();
    await expect(solo.page.getByText('The coordinator is not reachable. Solo practice still works without it.')).toBeVisible();
    await solo.page.goto(`${base}/#/run/QL/custom`);
    await solo.page.getByLabel('English').check();
    await solo.page.getByLabel('Text to practise').fill('still works');
    await solo.page.getByRole('button', { name: 'Start' }).click();
    const input = solo.page.getByRole('textbox', { name: /Typing area/ });
    await input.waitFor();
    await solo.page.waitForTimeout(300);
    await solo.kb.type('still works');
    await expect(solo.page.getByRole('heading', { name: 'Exercise complete' })).toBeVisible();
    await solo.context.close();
  });
});
