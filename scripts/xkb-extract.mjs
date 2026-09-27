#!/usr/bin/env node
// Regenerates src/domain/layouts/data/*.json from the installed XKB data.
//
// Each layout is compiled into a complete keymap with `xkbcomp`, exactly as the
// evdev rules would assemble it (`pc+<layout>+inet(evdev)`), so inherited keys
// are resolved. Compiling a keymap file does not touch the running keyboard
// configuration. Dead-key + Space results come from the system Compose table.
//
//   node scripts/xkb-extract.mjs          write the data files
//   node scripts/xkb-extract.mjs --check  fail if the committed files differ
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const XKB_ROOT = '/usr/share/X11/xkb';
const COMPOSE_FILE = '/usr/share/X11/locale/en_US.UTF-8/Compose';
const OUT_DIR = new URL('../src/domain/layouts/data/', import.meta.url);

const LAYOUTS = [
  { id: 'qwerty-us-intl', family: 'qwerty', xkbLayout: 'us', xkbVariant: 'intl' },
  { id: 'qwerty-us', family: 'qwerty', xkbLayout: 'us', xkbVariant: null },
  { id: 'dvorak-left-us', family: 'dvorak-left', xkbLayout: 'us', xkbVariant: 'dvorak-l' },
  { id: 'dvorak-right-us', family: 'dvorak-right', xkbLayout: 'us', xkbVariant: 'dvorak-r' },
  // Optional expansion layouts (milestone 5): standard Colemak, not Colemak-DH;
  // standard Workman, not its variants.
  { id: 'colemak-us', family: 'colemak', xkbLayout: 'us', xkbVariant: 'colemak' },
  { id: 'workman-us', family: 'workman', xkbLayout: 'us', xkbVariant: 'workman' },
];

// XKB key names for every printable position on ANSI and ABNT2 boards, plus Space.
const XKB_TO_CODE = {
  TLDE: 'Backquote',
  AE01: 'Digit1', AE02: 'Digit2', AE03: 'Digit3', AE04: 'Digit4', AE05: 'Digit5',
  AE06: 'Digit6', AE07: 'Digit7', AE08: 'Digit8', AE09: 'Digit9', AE10: 'Digit0',
  AE11: 'Minus', AE12: 'Equal',
  AD01: 'KeyQ', AD02: 'KeyW', AD03: 'KeyE', AD04: 'KeyR', AD05: 'KeyT',
  AD06: 'KeyY', AD07: 'KeyU', AD08: 'KeyI', AD09: 'KeyO', AD10: 'KeyP',
  AD11: 'BracketLeft', AD12: 'BracketRight',
  AC01: 'KeyA', AC02: 'KeyS', AC03: 'KeyD', AC04: 'KeyF', AC05: 'KeyG',
  AC06: 'KeyH', AC07: 'KeyJ', AC08: 'KeyK', AC09: 'KeyL',
  AC10: 'Semicolon', AC11: 'Quote', BKSL: 'Backslash',
  LSGT: 'IntlBackslash',
  AB01: 'KeyZ', AB02: 'KeyX', AB03: 'KeyC', AB04: 'KeyV', AB05: 'KeyB',
  AB06: 'KeyN', AB07: 'KeyM', AB08: 'Comma', AB09: 'Period', AB10: 'Slash',
  AB11: 'IntlRo',
  SPCE: 'Space',
};

// Keysym names that occur in the extracted layouts, mapped to the character
// they produce. keysymdef.h is not always installed, so the table is explicit;
// an unknown keysym stops the extraction instead of being guessed.
const ASCII_KEYSYMS = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%',
  ampersand: '&', apostrophe: "'", parenleft: '(', parenright: ')', asterisk: '*',
  plus: '+', comma: ',', minus: '-', period: '.', slash: '/', colon: ':', semicolon: ';',
  less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`',
  braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
};
const LATIN_KEYSYMS = {
  exclamdown: '¡', cent: '¢', sterling: '£', currency: '¤', yen: '¥', brokenbar: '¦',
  section: '§', copyright: '©', guillemotleft: '«', notsign: '¬', registered: '®',
  degree: '°', plusminus: '±', twosuperior: '²', threesuperior: '³', mu: 'µ',
  paragraph: '¶', periodcentered: '·', onesuperior: '¹', guillemotright: '»',
  onequarter: '¼', onehalf: '½', threequarters: '¾', questiondown: '¿',
  Aacute: 'Á', Adiaeresis: 'Ä', Aring: 'Å', AE: 'Æ', Ccedilla: 'Ç', Eacute: 'É',
  Ediaeresis: 'Ë', Iacute: 'Í', Idiaeresis: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Oacute: 'Ó',
  Odiaeresis: 'Ö', multiply: '×', Oslash: 'Ø', Uacute: 'Ú', Udiaeresis: 'Ü', THORN: 'Þ',
  ssharp: 'ß', aacute: 'á', adiaeresis: 'ä', aring: 'å', ae: 'æ', ccedilla: 'ç',
  eacute: 'é', ediaeresis: 'ë', iacute: 'í', idiaeresis: 'ï', eth: 'ð', ntilde: 'ñ',
  oacute: 'ó', odiaeresis: 'ö', division: '÷', oslash: 'ø', uacute: 'ú',
  udiaeresis: 'ü', thorn: 'þ', OE: 'Œ', oe: 'œ', EuroSign: '€', trademark: '™',
  leftsinglequotemark: '‘', rightsinglequotemark: '’', leftdoublequotemark: '“',
  rightdoublequotemark: '”',
  masculine: 'º', ordfeminine: 'ª', hstroke: 'ħ', Hstroke: 'Ħ', dstroke: 'đ', Dstroke: 'Đ',
  lstroke: 'ł', Lstroke: 'Ł', atilde: 'ã', Atilde: 'Ã', otilde: 'õ', Otilde: 'Õ', endash: '–',
  emdash: '—', nobreakspace: '\u00a0', acircumflex: 'â', Acircumflex: 'Â', ecircumflex: 'ê',
  Ecircumflex: 'Ê', icircumflex: 'î', Icircumflex: 'Î', ocircumflex: 'ô', Ocircumflex: 'Ô',
  ucircumflex: 'û', Ucircumflex: 'Û', agrave: 'à', Agrave: 'À', egrave: 'è', Egrave: 'È',
  igrave: 'ì', Igrave: 'Ì', ograve: 'ò', Ograve: 'Ò', ugrave: 'ù', Ugrave: 'Ù', eng: 'ŋ', ENG: 'Ŋ',
  kra: 'ĸ', idotless: 'ı', oe: 'œ', ydiaeresis: 'ÿ', yacute: 'ý', Yacute: 'Ý', scaron: 'š',
  Scaron: 'Š', zcaron: 'ž', Zcaron: 'Ž', ccaron: 'č', Ccaron: 'Č', ellipsis: '…', dagger: '†',
  doubledagger: '‡', infinity: '∞', notequal: '≠', lessthanequal: '≤', greaterthanequal: '≥',
  cedilla: '¸', diaeresis: '¨', acute: '´', macron: '¯', hyphen: '\u00ad',
};
const DEAD_PREFIX = 'dead_';
const CAPS_TYPES = new Set(['ALPHABETIC', 'FOUR_LEVEL_ALPHABETIC', 'FOUR_LEVEL_SEMIALPHABETIC']);

function keysymToChar(name) {
  if (/^[a-zA-Z0-9]$/.test(name)) return name;
  if (name in ASCII_KEYSYMS) return ASCII_KEYSYMS[name];
  if (name in LATIN_KEYSYMS) return LATIN_KEYSYMS[name];
  const unicode = /^U([0-9A-Fa-f]{4,6})$/.exec(name);
  if (unicode) return String.fromCodePoint(Number.parseInt(unicode[1], 16));
  // Unicode keysyms may also appear as 0x01000000 + code point.
  const hex = /^0x0?1([0-9A-Fa-f]{6})$/.exec(name);
  if (hex) return String.fromCodePoint(Number.parseInt(hex[1], 16));
  return undefined;
}

function level(name, where) {
  if (name === undefined || name === 'NoSymbol') return null;
  if (name.startsWith(DEAD_PREFIX)) return { dead: name.slice(DEAD_PREFIX.length) };
  const char = keysymToChar(name);
  if (char === undefined) throw new Error(`Unknown keysym "${name}" at ${where}; add it to the table.`);
  return { char };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function tryExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function compileKeymap(symbols) {
  const dir = mkdtempSync(join(tmpdir(), 'typist-xkb-'));
  try {
    const input = join(dir, 'keymap.xkb');
    const output = join(dir, 'compiled.xkb');
    writeFileSync(
      input,
      [
        'xkb_keymap {',
        '  xkb_keycodes { include "evdev+aliases(qwerty)" };',
        '  xkb_types    { include "complete" };',
        '  xkb_compat   { include "complete" };',
        `  xkb_symbols  { include "${symbols}" };`,
        '};',
        '',
      ].join('\n'),
    );
    execFileSync('xkbcomp', ['-w0', '-xkb', input, output], { stdio: ['ignore', 'pipe', 'pipe'] });
    return readFileSync(output, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseSymbols(compiled) {
  const start = compiled.indexOf('xkb_symbols');
  if (start < 0) throw new Error('Compiled keymap has no xkb_symbols section.');
  const section = compiled.slice(start);
  const groupName = /name\[group1\]\s*=\s*"([^"]*)"/i.exec(section)?.[1] ?? null;
  const keys = new Map();
  for (const match of section.matchAll(/key\s+<([A-Z0-9]+)>\s*\{([\s\S]*?)\};/g)) {
    const [, xkbName, body] = match;
    const type = /type(?:\[Group1\])?\s*=\s*"([^"]+)"/.exec(body)?.[1] ?? null;
    const list = /symbols\[Group1\]\s*=\s*\[([^\]]*)\]/.exec(body)?.[1] ?? /^\s*\[([^\]]*)\]/.exec(body)?.[1];
    if (list === undefined) continue;
    keys.set(xkbName, { type, syms: list.split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return { groupName, keys };
}

function parseComposeSpace(composeText) {
  const result = {};
  for (const match of composeText.matchAll(/^<dead_([a-z]+)>\s+<space>\s*:\s*"((?:\\.|[^"\\])*)"/gm)) {
    result[match[1]] = match[2].replace(/\\(.)/g, '$1');
  }
  return result;
}

function extractLayout(spec, composeSpace, provenance) {
  const symbols = `pc+${spec.xkbLayout}${spec.xkbVariant ? `(${spec.xkbVariant})` : ''}+inet(evdev)`;
  const { groupName, keys } = parseSymbols(compileKeymap(symbols));
  const outputKeys = {};
  for (const [xkbName, code] of Object.entries(XKB_TO_CODE)) {
    const entry = keys.get(xkbName);
    const syms = entry?.syms ?? [];
    const levels = [0, 1, 2, 3].map((i) => level(syms[i], `${spec.id} ${xkbName} level ${i + 1}`));
    while (levels.length > 0 && levels.at(-1) === null) levels.pop();
    outputKeys[code] = {
      xkb: xkbName,
      type: entry?.type ?? null,
      capsLock: entry?.type && CAPS_TYPES.has(entry.type) ? 'shift-level' : 'none',
      levels,
    };
  }
  const deadKeys = [
    ...new Set(
      Object.values(outputKeys)
        .flatMap((k) => k.levels.slice(0, 2))
        .filter((l) => l && 'dead' in l)
        .map((l) => l.dead),
    ),
  ].sort();
  const deadKeySpace = {};
  for (const dead of deadKeys) {
    if (!(dead in composeSpace)) throw new Error(`No "<dead_${dead}> <space>" entry in ${COMPOSE_FILE}.`);
    deadKeySpace[dead] = composeSpace[dead];
  }
  const ralt = keys.get('RALT')?.syms[0] ?? null;
  // Colemak and Workman turn the Caps Lock key into Backspace.
  const caps = keys.get('CAPS')?.syms[0] ?? null;
  return {
    id: spec.id,
    revision: 1,
    family: spec.family,
    os: {
      platform: 'linux',
      xkbLayout: spec.xkbLayout,
      xkbVariant: spec.xkbVariant,
      inputSourceLabel: groupName,
    },
    source: { ...provenance, symbols },
    altGr: ralt === 'ISO_Level3_Shift' ? 'right-alt-level3' : 'none',
    capsLockKey: caps === 'Caps_Lock' ? 'caps-lock' : caps === 'BackSpace' ? 'backspace' : 'other',
    deadKeySpace,
    keys: outputKeys,
  };
}

// One line per physical key keeps the generated tables reviewable in diffs.
function serialize(layout) {
  const { keys, ...header } = layout;
  const headerJson = JSON.stringify(header, null, 2).replace(/\n}$/, '');
  const keyLines = Object.entries(keys).map(([code, entry]) => `    ${JSON.stringify(code)}: ${JSON.stringify(entry)}`);
  return `${headerJson},\n  "keys": {\n${keyLines.join(',\n')}\n  }\n}\n`;
}

function main() {
  const check = process.argv.includes('--check');
  if (!tryExec('xkbcomp', ['-version']) && !existsSync('/usr/bin/xkbcomp')) {
    console.log('xkbcomp is not installed; skipping XKB layout extraction.');
    return;
  }
  const composeText = readFileSync(COMPOSE_FILE, 'utf8');
  const provenance = {
    project: 'xkeyboard-config',
    package: tryExec('dpkg-query', ['-W', '-f=${Package} ${Version}', 'xkb-data']),
    files: {
      'symbols/us': sha256(readFileSync(join(XKB_ROOT, 'symbols/us'))),
      'symbols/pc': sha256(readFileSync(join(XKB_ROOT, 'symbols/pc'))),
      'locale/en_US.UTF-8/Compose': sha256(Buffer.from(composeText)),
    },
    rules: 'evdev',
    compiler: tryExec('xkbcomp', ['-version'])?.split('\n')[0] ?? 'xkbcomp',
    license: 'xkeyboard-config MIT/X11-style license; see licenses/xkeyboard-config.txt',
  };
  const composeSpace = parseComposeSpace(composeText);
  let differences = 0;
  for (const spec of LAYOUTS) {
    const json = serialize(extractLayout(spec, composeSpace, provenance));
    const target = new URL(`${spec.id}.json`, OUT_DIR);
    if (check) {
      const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
      if (current !== json) {
        differences += 1;
        console.error(`${spec.id}: committed data differs from the installed XKB definition.`);
      } else {
        console.log(`${spec.id}: matches the installed XKB definition.`);
      }
    } else {
      writeFileSync(target, json);
      console.log(`${spec.id}: wrote ${target.pathname}`);
    }
  }
  if (differences > 0) process.exitCode = 1;
}

main();
