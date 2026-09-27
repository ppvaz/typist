#!/usr/bin/env node
// Copies third-party license texts into dist/licenses and writes a notice
// listing every bundled third-party component with its version and license.
// Fonts ship locally for offline use and keep their SIL Open Font License.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('dist/licenses/', ROOT);

const COMPONENTS = [
  { name: '@fontsource/ibm-plex-sans', what: 'IBM Plex Sans font files (latin 400/500/600)', license: 'node_modules/@fontsource/ibm-plex-sans/LICENSE' },
  { name: '@fontsource/jetbrains-mono', what: 'JetBrains Mono font files (latin 400/500)', license: 'node_modules/@fontsource/jetbrains-mono/LICENSE' },
  { name: '@fontsource/newsreader', what: 'Newsreader font files (latin 400/400 italic/500)', license: 'node_modules/@fontsource/newsreader/LICENSE' },
  { name: 'react', what: 'React runtime', license: 'node_modules/react/LICENSE' },
  { name: 'react-dom', what: 'React DOM runtime', license: 'node_modules/react-dom/LICENSE' },
  { name: 'scheduler', what: 'React scheduler', license: 'node_modules/scheduler/LICENSE' },
  { name: 'idb', what: 'IndexedDB promise wrapper', license: 'node_modules/idb/LICENSE' },
];

function version(name) {
  return JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, ROOT), 'utf8')).version;
}

function licenseName(name) {
  const pkg = JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, ROOT), 'utf8'));
  return typeof pkg.license === 'string' ? pkg.license : 'see license file';
}

function main() {
  if (!existsSync(new URL('dist/', ROOT))) throw new Error('Run vite build first.');
  mkdirSync(OUT, { recursive: true });
  const lines = [
    'Typist third-party notices',
    '==========================',
    '',
    'Typist bundles the following third-party components. Their license texts are in this directory.',
    'Keyboard layout tables are generated from xkeyboard-config and keep its notice.',
    '',
  ];
  for (const c of COMPONENTS) {
    const file = `${c.name.replace(/[@/]/g, '_').replace(/^_/, '')}.LICENSE.txt`;
    copyFileSync(new URL(c.license, ROOT), new URL(file, OUT));
    lines.push(`- ${c.name} ${version(c.name)} (${licenseName(c.name)}): ${c.what}. License: ${file}`);
  }
  copyFileSync(new URL('licenses/xkeyboard-config.txt', ROOT), new URL('xkeyboard-config.txt', OUT));
  lines.push('- xkeyboard-config (MIT/X11-style): layout data in src/domain/layouts/data. License: xkeyboard-config.txt');
  lines.push('', 'Exercise text (content/) is original Typist content.', '');
  writeFileSync(new URL('THIRD_PARTY_NOTICES.txt', OUT), lines.join('\n'));
  console.log(`licenses: wrote ${COMPONENTS.length + 1} license files and THIRD_PARTY_NOTICES.txt to dist/licenses`);
}

main();
