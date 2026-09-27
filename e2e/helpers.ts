// Browser-test helpers. OsKeyboard emulates what an OS input source delivers
// to Chromium (key, code, committed text, dead keys) using the same layout
// tables the app ships. It exercises the browser event pipeline; it cannot
// certify an OS keymap — that is what the XKB harness and manual checks do.
import type { CDPSession, Page } from '@playwright/test';
import dvorakLeft from '../src/domain/layouts/data/dvorak-left-us.json' with { type: 'json' };
import dvorakRight from '../src/domain/layouts/data/dvorak-right-us.json' with { type: 'json' };
import colemak from '../src/domain/layouts/data/colemak-us.json' with { type: 'json' };
import qwertyUs from '../src/domain/layouts/data/qwerty-us.json' with { type: 'json' };
import workman from '../src/domain/layouts/data/workman-us.json' with { type: 'json' };
import qwertyIntl from '../src/domain/layouts/data/qwerty-us-intl.json' with { type: 'json' };

type Level = { char: string } | { dead: string } | null;
interface LayoutJson {
  id: string;
  deadKeySpace: Record<string, string>;
  keys: Record<string, { levels: Level[] }>;
}

export const LAYOUT_JSON: Record<string, LayoutJson> = {
  'qwerty-us': qwertyUs as LayoutJson,
  'qwerty-us-intl': qwertyIntl as LayoutJson,
  'dvorak-left-us': dvorakLeft as LayoutJson,
  'dvorak-right-us': dvorakRight as LayoutJson,
  'colemak-us': colemak as LayoutJson,
  'workman-us': workman as LayoutJson,
};

const VK: Record<string, number> = {
  Backquote: 192, Minus: 189, Equal: 187, BracketLeft: 219, BracketRight: 221, Backslash: 220,
  Semicolon: 186, Quote: 222, Comma: 188, Period: 190, Slash: 191, IntlBackslash: 226, IntlRo: 193,
  Space: 32, Enter: 13, Backspace: 8, ShiftLeft: 16, ShiftRight: 16, Tab: 9, Escape: 27,
};

function vk(code: string): number {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit\d$/.test(code)) return code.charCodeAt(5);
  return VK[code] ?? 0;
}

export class OsKeyboard {
  private cdp: CDPSession | null = null;
  constructor(public layout: LayoutJson) {}

  static async attach(page: Page, layoutId: string): Promise<OsKeyboard> {
    const kb = new OsKeyboard(LAYOUT_JSON[layoutId] as LayoutJson);
    kb.cdp = await page.context().newCDPSession(page);
    return kb;
  }

  setLayout(layoutId: string): void {
    this.layout = LAYOUT_JSON[layoutId] as LayoutJson;
  }

  private async send(params: Record<string, unknown>): Promise<void> {
    if (!this.cdp) throw new Error('OsKeyboard needs Chromium (CDP).');
    await this.cdp.send('Input.dispatchKeyEvent', params as never);
  }

  private async shift(down: boolean, code = 'ShiftLeft'): Promise<void> {
    await this.send({ type: down ? 'rawKeyDown' : 'keyUp', key: 'Shift', code, windowsVirtualKeyCode: 16, modifiers: down ? 8 : 0, location: code === 'ShiftRight' ? 2 : 1 });
  }

  /** Press one physical key; the OS layout decides the output. */
  async press(code: string, opts: { shift?: boolean; shiftCode?: 'ShiftLeft' | 'ShiftRight'; then?: string } = {}): Promise<void> {
    const modifiers = opts.shift ? 8 : 0;
    if (opts.shift) await this.shift(true, opts.shiftCode);
    if (code === 'Backspace' || code === 'Tab' || code === 'Escape') {
      await this.send({ type: 'rawKeyDown', key: code, code, windowsVirtualKeyCode: vk(code), modifiers });
      await this.send({ type: 'keyUp', key: code, code, windowsVirtualKeyCode: vk(code), modifiers });
    } else if (code === 'Enter') {
      await this.send({ type: 'keyDown', key: 'Enter', code, windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r', modifiers });
      await this.send({ type: 'keyUp', key: 'Enter', code, windowsVirtualKeyCode: 13, modifiers });
    } else {
      const level = this.layout.keys[code]?.levels[opts.shift ? 1 : 0] ?? null;
      if (level && 'dead' in level) {
        await this.send({ type: 'rawKeyDown', key: 'Dead', code, windowsVirtualKeyCode: vk(code), modifiers });
        await this.send({ type: 'keyUp', key: 'Dead', code, windowsVirtualKeyCode: vk(code), modifiers });
        if (opts.shift) await this.shift(false, opts.shiftCode);
        // The completing key: Space commits the dead key's own character.
        const commit = this.layout.deadKeySpace[level.dead] ?? '';
        await this.send({ type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: commit, unmodifiedText: commit });
        await this.send({ type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        return;
      }
      const text = level && 'char' in level ? level.char : '';
      if (text) await this.send({ type: 'keyDown', key: text, code, windowsVirtualKeyCode: vk(code), text, unmodifiedText: text, modifiers });
      else await this.send({ type: 'rawKeyDown', key: 'Unidentified', code, windowsVirtualKeyCode: vk(code), modifiers });
      await this.send({ type: 'keyUp', key: text || 'Unidentified', code, windowsVirtualKeyCode: vk(code), modifiers });
    }
    if (opts.shift) await this.shift(false, opts.shiftCode);
  }

  /** How the layout types a character: [code, shift]. */
  strokeFor(char: string): { code: string; shift: boolean } | null {
    if (char === ' ') return { code: 'Space', shift: false };
    if (char === '\n') return { code: 'Enter', shift: false };
    for (const [code, key] of Object.entries(this.layout.keys)) {
      for (const [i, level] of key.levels.slice(0, 2).entries()) {
        if (level && 'char' in level && level.char === char) return { code, shift: i === 1 };
      }
    }
    for (const [code, key] of Object.entries(this.layout.keys)) {
      for (const [i, level] of key.levels.slice(0, 2).entries()) {
        if (level && 'dead' in level && this.layout.deadKeySpace[level.dead] === char) return { code, shift: i === 1 };
      }
    }
    return null;
  }

  async type(text: string): Promise<void> {
    for (const char of text) {
      if (char === ' ') {
        await this.send({ type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
        await this.send({ type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        continue;
      }
      const stroke = this.strokeFor(char);
      if (!stroke) throw new Error(`${this.layout.id} cannot type ${JSON.stringify(char)}`);
      await this.press(stroke.code, { shift: stroke.shift });
    }
  }

  async backspace(times = 1): Promise<void> {
    for (let i = 0; i < times; i += 1) await this.press('Backspace');
  }

  /** An input-method composition that commits `text` (e.g. é). */
  async compose(text: string): Promise<void> {
    if (!this.cdp) throw new Error('compose needs Chromium (CDP).');
    await this.send({ type: 'rawKeyDown', key: 'Process', code: 'KeyE', windowsVirtualKeyCode: 229 });
    await this.cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await this.cdp.send('Input.insertText', { text });
    await this.send({ type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 });
  }
}

export interface OnboardOptions {
  readonly qwerty?: 'qwerty-us' | 'qwerty-us-intl';
  readonly geometry?: 'ansi-us' | 'abnt2';
  readonly primary?: 'QL' | 'QR' | 'DL' | 'DR';
  readonly weekdays?: readonly number[];
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __typist?: { getState(): { status: string } } }).__typist?.getState().status === 'ready');
}

/** Open the app with a fresh profile created through the store (fast path). */
export async function freshProfile(page: Page, opts: OnboardOptions = {}, base = ''): Promise<void> {
  await page.goto(`${base}/`);
  await page.waitForFunction(() => (window as unknown as { __typist?: { getState(): { status: string } } }).__typist?.getState().status === 'ready');
  await page.evaluate(async (o) => {
    const store = (window as unknown as { __typist: { completeOnboarding(input: unknown): Promise<void> } }).__typist;
    await store.completeOnboarding({
      preferredName: null,
      dominantHand: 'right',
      practiceWeekdays: o.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
      dailyMinutes: 30,
      startDate: new Date().toISOString().slice(0, 10),
      primaryMode: o.primary ?? 'QL',
      planStyle: 'sequential',
      geometryId: o.geometry ?? 'ansi-us',
      keyboardLabel: 'test board',
      qwertyLayoutId: o.qwerty ?? 'qwerty-us',
      modifierStrategy: 'hold-shift',
      modifierNotes: '',
      remaps: '',
      keyboardOffset: { left: '', right: '' },
      chairDeskNotes: '',
      sessionType: 'wayland',
    });
  }, opts);
}

/** Every IndexedDB record of a store, read through the page. */
export async function records<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const req = indexedDB.open('typist');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(name, 'readonly');
          const all = tx.objectStore(name).getAll();
          all.onsuccess = () => {
            resolve(all.result as T[]);
            db.close();
          };
          all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
      }),
    store,
  );
}

/** Run the calibration screen for a layout, answering with the emulated OS. */
export async function calibrate(page: Page, kb: OsKeyboard, layoutId: string, kind: 'full' | 'probe' = 'full'): Promise<string> {
  await page.goto(`/#/setup/calibrate/${layoutId}?kind=${kind}`);
  await page.getByRole('button', { name: kind === 'full' ? 'Start full calibration' : 'Start the short probe' }).click();
  const input = page.locator('#calibration-input');
  await input.focus();
  for (let guard = 0; guard < 200; guard += 1) {
    const heading = await page.locator('h2').first().textContent();
    if (!heading || /Calibration (passed|found|incomplete)/.test(heading)) break;
    if (/recorded only|optional/.test(heading)) {
      await page.getByRole('button', { name: 'Skip this check' }).click();
      await page.waitForTimeout(120);
      continue;
    }
    const m = /^(Hold (?:the )?(left |right )?Shift and press|Press|Turn Caps Lock on, press) ([A-Za-z0-9]+|Space|Enter|Backspace)/.exec(heading);
    if (!m) {
      // Informational steps: press the listed keys.
      const info = /Press ([A-Za-z0-9]+)(?:, then ([A-Za-z0-9]+))?/.exec(heading);
      const alt = /Hold AltGr/.test(heading);
      if (alt) await page.getByRole('button', { name: 'Skip this check' }).click();
      else if (info) {
        await kb.press(info[1] as string);
        if (info[2]) await kb.press(info[2]);
      } else await page.getByRole('button', { name: 'Skip this check' }).click();
      await page.waitForTimeout(150);
      continue;
    }
    const code = m[3] as string;
    if (m[1]?.startsWith('Turn Caps Lock')) {
      // Caps Lock cannot be toggled through CDP reliably; skip the check.
      await page.getByRole('button', { name: 'Skip this check' }).click();
    } else if (m[1]?.includes('Shift')) {
      await kb.press(code, { shift: true, shiftCode: m[2]?.startsWith('right') ? 'ShiftRight' : 'ShiftLeft' });
    } else {
      await kb.press(code);
    }
    await page.waitForTimeout(140);
  }
  await page.getByRole('button', { name: 'Save calibration' }).click();
  await page.getByText('Calibration saved').waitFor();
  return (await page.locator('h2').first().textContent()) ?? '';
}

/** Record core completion directly (tests of the post-core modules only; the award itself is tested in progression). */
export async function seedCore(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const store = (window as unknown as { __typist: { repo: { write(s: string[], fn: (tx: { objectStore(n: string): { put(v: unknown): Promise<unknown> } }) => Promise<void>): Promise<void> }; applyUpserts(u: unknown): void } }).__typist;
    const now = new Date().toISOString();
    const record = { schemaVersion: 1, id: crypto.randomUUID(), awardedAt: now, awardedLocalDate: now.slice(0, 10), milestoneIds: { QL: 'a', QR: 'b', DL: 'c', DR: 'd' }, stabilitySetIds: {}, origin: 'native-run' };
    await store.repo.write(['core'], async (tx) => {
      await tx.objectStore('core').put(record);
    });
    store.applyUpserts({ core: [record] });
  });
}

/** Record a passed calibration for the current setup (tests of other flows). */
export async function seedCalibration(page: Page, layoutId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const store = (window as unknown as { __typist: { getState(): { browserSession: string; data: { setups: { id: string; createdAt: string; revision: number; geometryId: string }[] } }; saveCalibration(r: unknown): Promise<void> } }).__typist;
    const state = store.getState();
    const setup = [...state.data.setups].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision)[0];
    if (!setup) throw new Error('no setup');
    const now = new Date().toISOString();
    await store.saveCalibration({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      setupRevisionId: setup.id,
      layoutId: id,
      layoutRevision: 1,
      geometryId: setup.geometryId,
      kind: 'full',
      startedAt: now,
      completedAt: now,
      status: 'passed',
      checked: 1,
      matched: 1,
      results: [],
      identified: [],
      browserSessionId: state.browserSession,
      browser: 'test',
      absent: [],
    });
  }, layoutId);
}
