#!/usr/bin/env node
// OS-level layout verification (Linux/X11 tooling required).
//
// For each layout, geometry and browser this script starts a private nested X
// server (Xephyr), loads the real XKB keymap with setxkbmap, opens the
// development harness page in Chrome or Firefox inside it, and presses
// physical keys with XTest. The page runs Typist's real calibration code on
// what the OS and browser commit, then scores a typed text under reference
// input rules. The user's own desktop keymap is never touched.
//
// It is stronger than synthetic KeyboardEvents (XKB really translates the
// keycodes) but it is not a physical keyboard: the manual checks in
// docs/verification.md remain necessary for the actual hardware.
//
//   node scripts/xkb-os-check.mjs [--browsers chrome,firefox] [--layouts qwerty-us-intl,...] [--geometries ansi-us,abnt2] [--out file.json]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = new URL('../', import.meta.url).pathname;
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BROWSERS = arg('browsers', 'chrome,firefox').split(',');
const LAYOUTS = arg('layouts', 'qwerty-us-intl,dvorak-left-us,dvorak-right-us,qwerty-us').split(',');
const GEOMETRIES = arg('geometries', 'ansi-us,abnt2').split(',');
const OUT = arg('out', null);
const VARIANT = { 'qwerty-us-intl': 'intl', 'dvorak-left-us': 'dvorak-l', 'dvorak-right-us': 'dvorak-r', 'qwerty-us': '', 'colemak-us': 'colemak', 'workman-us': 'workman' };
const MODEL = { 'ansi-us': 'pc105', abnt2: 'abnt2' };
const PORT = 5175;

// X keycodes (evdev + 8) for browser KeyboardEvent.code values.
const KEYCODE = {
  Backquote: 49, Digit1: 10, Digit2: 11, Digit3: 12, Digit4: 13, Digit5: 14, Digit6: 15, Digit7: 16, Digit8: 17,
  Digit9: 18, Digit0: 19, Minus: 20, Equal: 21, Backspace: 22, Tab: 23, KeyQ: 24, KeyW: 25, KeyE: 26, KeyR: 27,
  KeyT: 28, KeyY: 29, KeyU: 30, KeyI: 31, KeyO: 32, KeyP: 33, BracketLeft: 34, BracketRight: 35, Enter: 36,
  KeyA: 38, KeyS: 39, KeyD: 40, KeyF: 41, KeyG: 42, KeyH: 43, KeyJ: 44, KeyK: 45, KeyL: 46, Semicolon: 47,
  Quote: 48, ShiftLeft: 50, Backslash: 51, KeyZ: 52, KeyX: 53, KeyC: 54, KeyV: 55, KeyB: 56, KeyN: 57, KeyM: 58,
  Comma: 59, Period: 60, Slash: 61, ShiftRight: 62, Space: 65, CapsLock: 66, F8: 74, F9: 75, IntlBackslash: 94,
  IntlRo: 97, AltRight: 108,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function which(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function httpOk(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

/** Messages posted by the harness page. */
function reportServer() {
  const queue = [];
  const waiters = [];
  const server = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    if (req.method !== 'POST') {
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.end('ok');
      try {
        const msg = JSON.parse(body);
        const w = waiters.shift();
        if (w) w(msg);
        else queue.push(msg);
      } catch {
        // ignore malformed posts
      }
    });
  });
  return {
    server,
    next(timeoutMs = 8000) {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = waiters.indexOf(done);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error('no message from the harness page'));
        }, timeoutMs);
        const done = (m) => {
          clearTimeout(timer);
          resolve(m);
        };
        waiters.push(done);
      });
    },
    clear() {
      queue.length = 0;
    },
  };
}

class XTest {
  constructor(display) {
    this.proc = spawn('python3', [join(ROOT, 'scripts/xtest.py')], { env: { ...process.env, DISPLAY: display }, stdio: ['pipe', 'pipe', 'inherit'] });
    this.lines = createInterface({ input: this.proc.stdout });
    this.pending = [];
    this.lines.on('line', () => this.pending.shift()?.());
  }
  send(cmd) {
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.proc.stdin.write(`${JSON.stringify(cmd)}\n`);
    });
  }
  async key(code, down) {
    const keycode = KEYCODE[code];
    if (!keycode) throw new Error(`No X keycode for ${code}`);
    await this.send({ op: 'key', keycode, down });
  }
  async tap(code, hold = 25) {
    await this.key(code, true);
    await sleep(hold);
    await this.key(code, false);
  }
  async press(spec) {
    if (spec.capsLock) {
      await this.tap('CapsLock');
      await sleep(40);
    }
    const mod = spec.shift === 'right' ? 'ShiftRight' : spec.shift ? 'ShiftLeft' : null;
    if (mod) await this.key(mod, true);
    if (spec.altGr) await this.key('AltRight', true);
    await sleep(15);
    await this.tap(spec.code);
    await sleep(15);
    if (spec.altGr) await this.key('AltRight', false);
    if (mod) await this.key(mod, false);
    if (spec.then) {
      await sleep(40);
      await this.tap(spec.then);
    }
    if (spec.capsLock) {
      await sleep(40);
      await this.tap('CapsLock');
    }
  }
  /** The nested server can leak host modifier state; release every modifier. */
  async releaseModifiers() {
    for (const keycode of [50, 62, 64, 108, 37, 105, 133, 134]) await this.send({ op: 'key', keycode, down: false });
  }
  close() {
    this.proc.stdin.end(`${JSON.stringify({ op: 'quit' })}\n`);
  }
}

function browserCommand(browser, url, dir) {
  const env = {
    ...process.env,
    GDK_BACKEND: 'x11',
    XDG_SESSION_TYPE: 'x11',
    GTK_IM_MODULE: 'gtk-im-context-simple',
    XMODIFIERS: '@im=none',
    MOZ_ENABLE_WAYLAND: '0',
  };
  delete env.WAYLAND_DISPLAY;
  if (browser === 'chrome') {
    return {
      cmd: 'google-chrome',
      args: ['--user-data-dir=' + dir, '--no-first-run', '--no-default-browser-check', '--ozone-platform=x11', '--disable-gpu', '--disable-extensions', '--disable-sync', '--password-store=basic', '--window-position=0,0', '--window-size=1000,700', `--app=${url}`],
      env,
    };
  }
  writeFileSync(
    join(dir, 'user.js'),
    [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("startup.homepage_welcome_url", "");',
      'user_pref("browser.aboutwelcome.enabled", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
      'user_pref("browser.tabs.warnOnClose", false);',
      'user_pref("privacy.webrtc.legacyGlobalIndicator", false);',
    ].join('\n'),
  );
  return { cmd: 'firefox', args: ['--no-remote', '--new-instance', '--profile', dir, '--kiosk', url], env };
}

function browserVersion(browser) {
  try {
    return execFileSync(browser === 'chrome' ? 'google-chrome' : 'firefox', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return browser;
  }
}

async function runOne(reports, browser, layout, geometry, displayNum) {
  const display = `:${displayNum}`;
  const result = { browser: browserVersion(browser), layout, geometry, xkb: `us${VARIANT[layout] ? `(${VARIANT[layout]})` : ''}`, model: MODEL[geometry] };
  const xephyr = spawn('Xephyr', [display, '-screen', '1040x740', '-ac', '-br', '-noreset', '-title', `typist-xkb-${layout}-${geometry}-${browser}`], { stdio: 'ignore', env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' } });
  const dir = mkdtempSync(join(tmpdir(), `typist-xkb-${browser}-`));
  let browserProc = null;
  let xt = null;
  try {
    await waitFor(() => existsSync(`/tmp/.X11-unix/X${displayNum}`), 10_000, 'Xephyr');
    await sleep(500);
    const variant = VARIANT[layout];
    execFileSync('setxkbmap', ['-display', display, '-rules', 'evdev', '-model', MODEL[geometry], '-layout', 'us', ...(variant ? ['-variant', variant] : []), '-option', ''], { stdio: 'inherit' });
    result.keymap = execFileSync('setxkbmap', ['-display', display, '-query'], { encoding: 'utf8' }).trim().replace(/\s+/g, ' ');
    reports.clear();
    const url = `http://127.0.0.1:${PORT}/xkb-harness.html?layout=${layout}&geometry=${geometry}&report=${encodeURIComponent(`http://127.0.0.1:${reports.port}/`)}`;
    const { cmd, args, env } = browserCommand(browser, url, dir);
    browserProc = spawn(cmd, args, { env: { ...env, DISPLAY: display }, stdio: 'ignore' });
    const ready = await reports.next(45_000);
    if (ready.type !== 'ready') throw new Error(`unexpected first message ${ready.type}`);
    result.userAgent = ready.userAgent;
    xt = new XTest(display);
    await sleep(800);
    await xt.send({ op: 'click', x: 300, y: 400 });
    await sleep(300);
    let steps = 0;
    let last = null;
    for (;;) {
      let msg;
      try {
        msg = await reports.next(last ? 6_000 : 15_000);
      } catch (error) {
        // Nested X occasionally drops a synthetic key (seen with Caps Lock): press the stalled step once more.
        if (!last || last.retried) throw error;
        last.retried = true;
        result.retriedSteps = [...(result.retriedSteps ?? []), last.msg.id ?? null];
        await xt.releaseModifiers();
        for (const k of last.msg.keys) await xt.press(k);
        continue;
      }
      if (msg.type === 'step') {
        steps += 1;
        last = { msg, retried: false };
        // Kept on failure: how far calibration got and what was pressed last.
        result.steps = steps;
        result.lastStep = { id: msg.id ?? null, keys: msg.keys };
        await xt.releaseModifiers();
        for (const k of msg.keys) await xt.press(k);
        continue;
      }
      last = null;
      if (msg.type === 'calibration') {
        result.calibration = { status: msg.summary.status, checked: msg.summary.checked, matched: msg.summary.matched, skipped: msg.summary.skipped, absent: msg.summary.absent, mismatches: msg.mismatches, info: msg.info, identified: msg.identified?.[0] };
        continue;
      }
      if (msg.type === 'type') {
        await sleep(600);
        await xt.releaseModifiers();
        await xt.tap('F8');
        await sleep(150);
        for (const s of msg.strokes) {
          if (s.code === 'Unknown') throw new Error(`cannot type ${s.char}`);
          await xt.press(s);
          await sleep(10);
        }
        await sleep(400);
        await xt.tap('F9');
        const typed = await reports.next(15_000);
        result.typing = { text: msg.text, status: typed.status, verification: typed.verification, counters: typed.counters, invalidity: typed.invalidity, wrong: typed.wrong, paths: typed.paths };
        if (process.env.XKB_RAW || typed.wrong?.length || typed.verification !== 'verified' || typed.counters?.finalCorrect !== Array.from(msg.text).length) result.raw = typed.raw;
        break;
      }
    }
    result.steps = steps;
    delete result.lastStep;
    // Every character of the text must arrive: lost key events are a failure, not a pass.
    result.typing.complete = result.typing.counters?.finalCorrect === Array.from(result.typing.text).length;
    result.ok = result.calibration?.status === 'passed' && result.typing?.verification === 'verified' && result.typing.complete && (result.typing?.wrong?.length ?? 1) === 0 && (result.typing?.invalidity?.length ?? 1) === 0;
  } catch (error) {
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    xt?.close();
    browserProc?.kill('SIGTERM');
    await sleep(800);
    browserProc?.kill('SIGKILL');
    xephyr.kill('SIGTERM');
    await sleep(300);
    rmSync(dir, { recursive: true, force: true });
  }
  return result;
}

async function main() {
  for (const tool of ['Xephyr', 'setxkbmap', 'python3']) if (!which(tool)) throw new Error(`${tool} is required.`);
  const vite = spawn(join(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const reports = reportServer();
  await new Promise((r) => reports.server.listen(0, '127.0.0.1', r));
  reports.port = reports.server.address().port;
  const results = [];
  try {
    await waitFor(() => httpOk(`http://127.0.0.1:${PORT}/xkb-harness.html`), 30_000, 'vite');
    let displayNum = 71;
    for (const browser of BROWSERS) {
      for (const geometry of GEOMETRIES) {
        for (const layout of LAYOUTS) {
          while (existsSync(`/tmp/.X11-unix/X${displayNum}`)) displayNum += 1;
          process.stdout.write(`${browser} · ${geometry} · ${layout} … `);
          const r = await runOne(reports, browser, layout, geometry, displayNum);
          displayNum += 1;
          results.push(r);
          const c = r.calibration;
          console.log(r.ok ? `ok (calibration ${c.matched}/${c.checked}, typed ${r.typing.counters.attempts} chars, ${r.typing.paths.join('+')})` : `FAILED ${r.error ?? JSON.stringify({ calibration: c?.status, mismatches: c?.mismatches?.slice(0, 5), typing: r.typing?.wrong?.slice(0, 5), verification: r.typing?.verification })}`);
        }
      }
    }
  } finally {
    vite.kill('SIGTERM');
    reports.server.close();
  }
  const report = { generatedAt: new Date().toISOString(), host: { kernel: execFileSync('uname', ['-sr'], { encoding: 'utf8' }).trim() }, results };
  if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} combinations verified.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
