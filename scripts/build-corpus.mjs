#!/usr/bin/env node
// Builds the bundled exercise corpus from the original sources in content/src.
//
// Prose, the monthly passage and the numbers/symbols text are authored as
// wrapped lines; lines are joined with single spaces. Code keeps its newlines
// and has tabs normalized to two spaces. Every item is NFC-normalized, checked
// against its allowed character set and minimum length, and hashed (SHA-256 of
// the UTF-8 bytes), so a stored trial can prove which exact text it used.
//
//   node scripts/build-corpus.mjs          write src/content/corpus.json and content/manifest.json
//   node scripts/build-corpus.mjs --check  fail if the committed files are stale or invalid
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('content/src/', ROOT);
const CORPUS_OUT = new URL('src/content/corpus.json', ROOT);
const MANIFEST_OUT = new URL('content/manifest.json', ROOT);

const LICENSE =
  'Original text written for Typist and distributed with this repository. No third-party text is included.';
const PROSE_MIN_CHARS = 2000;
const PROSE_PASSAGES_REQUIRED = 12;
const BEGINNER_WORDS_REQUIRED = 200;

const PRINTABLE = /^[\x20-\x7e]*$/;
const PRINTABLE_WITH_NEWLINES = /^[\x20-\x7e\n]*$/;

function sha256(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function files(dir) {
  return readdirSync(new URL(`${dir}/`, SRC))
    .filter((f) => f.endsWith('.txt'))
    .sort();
}

function read(dir, file) {
  return readFileSync(new URL(`${dir}/${file}`, SRC), 'utf8');
}

function slug(file) {
  return file.replace(/\.txt$/, '');
}

function titleOf(file) {
  const words = slug(file).replace(/^[a-z]\d+-/, '').split('-');
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinLines(raw) {
  return raw.normalize('NFC').split(/\s*\n\s*/).join(' ').replace(/ {2,}/g, ' ').trim();
}

function normalizeCode(raw) {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

const problems = [];
function check(condition, message) {
  if (!condition) problems.push(message);
}

function item(corpusId, file, text, extra = {}) {
  return { id: `${corpusId}/${slug(file).split('-')[0]}`, title: titleOf(file), file: `content/src/${extra.dir}/${file}`, text, chars: [...text].length, sha256: sha256(text) };
}

function buildTextCorpus({ id, dir, kind, textClass, minChars, code = false }) {
  const items = files(dir).map((file) => {
    const raw = read(dir, file);
    const text = code ? normalizeCode(raw) : joinLines(raw);
    check((code ? PRINTABLE_WITH_NEWLINES : PRINTABLE).test(text), `${dir}/${file}: contains characters outside printable ASCII${code ? ' and newline' : ''}.`);
    check(text === text.normalize('NFC'), `${dir}/${file}: not NFC-normalized.`);
    if (minChars) check([...text].length >= minChars, `${dir}/${file}: ${[...text].length} characters, fewer than ${minChars}.`);
    check(!/ {2,}/.test(code ? '' : text), `${dir}/${file}: repeated spaces.`);
    const entry = item(id, file, text, { dir });
    if (code) entry.language = /^#!\/bin\/sh/.test(text) ? 'sh' : /\bdef \w+\(|^from \w+ import/m.test(text) ? 'python' : /\btype \w+ =|: \w+\[\]/.test(text) ? 'typescript' : 'javascript';
    return entry;
  });
  const ids = new Set(items.map((i) => i.id));
  check(ids.size === items.length, `${id}: duplicate item IDs.`);
  return { id, version: 1, kind, textClass, language: code ? 'code' : 'en', license: LICENSE, items };
}

function buildWords() {
  const lines = read('words', 'en-common.txt').split('\n').map((l) => l.trim());
  const words = [];
  let beginnerCount = null;
  for (const line of lines) {
    if (line === '# general') {
      beginnerCount = words.length;
      continue;
    }
    if (line === '' || line.startsWith('#')) continue;
    check(/^[a-z]+$/.test(line), `words: "${line}" is not a lowercase ASCII word.`);
    words.push(line);
  }
  const seen = new Set();
  for (const w of words) {
    check(!seen.has(w), `words: "${w}" appears more than once.`);
    seen.add(w);
  }
  check(beginnerCount !== null, 'words: missing the "# general" marker.');
  check((beginnerCount ?? 0) >= BEGINNER_WORDS_REQUIRED, `words: ${beginnerCount} beginner words, fewer than ${BEGINNER_WORDS_REQUIRED}.`);
  const text = words.join('\n');
  return { id: 'en-words-v1', version: 1, kind: 'words', textClass: 'words', language: 'en', license: LICENSE, beginnerCount, words, sha256: sha256(text) };
}

function build() {
  const prose = buildTextCorpus({ id: 'en-prose-v1', dir: 'prose', kind: 'prose', textClass: 'prose', minChars: PROSE_MIN_CHARS });
  check(prose.items.length >= PROSE_PASSAGES_REQUIRED, `prose: ${prose.items.length} passages, fewer than ${PROSE_PASSAGES_REQUIRED}.`);
  const monthly = buildTextCorpus({ id: 'en-monthly-v1', dir: 'monthly', kind: 'monthly', textClass: 'prose', minChars: PROSE_MIN_CHARS });
  check(monthly.items.length === 1, 'monthly: exactly one fixed passage is expected.');
  const symbols = buildTextCorpus({ id: 'en-symbols-v1', dir: 'symbols', kind: 'symbols', textClass: 'numbers-symbols', minChars: 600 });
  const code = buildTextCorpus({ id: 'code-v1', dir: 'code', kind: 'code', textClass: 'code', code: true });
  const words = buildWords();
  const corpora = { prose, monthly, symbols, code, words };
  const fingerprint = sha256(
    Object.values(corpora)
      .map((c) => `${c.id}@${c.version}:${c.items ? c.items.map((i) => i.sha256).join(',') : c.sha256}`)
      .join('\n'),
  );
  const corpus = { formatVersion: 1, fingerprint, ...corpora };
  const manifest = {
    formatVersion: 1,
    description: 'Exercise content bundled with Typist. Generated by scripts/build-corpus.mjs from content/src; do not edit by hand.',
    license: LICENSE,
    fingerprint,
    corpora: Object.values(corpora).map((c) => ({
      id: c.id,
      version: c.version,
      kind: c.kind,
      textClass: c.textClass,
      language: c.language,
      ...(c.items
        ? { items: c.items.map(({ id, title, file, chars, sha256: hash, language }) => ({ id, title, file, chars, sha256: hash, ...(language ? { language } : {}) })) }
        : { words: c.words.length, beginnerWords: c.beginnerCount, sha256: c.sha256 }),
    })),
  };
  return { corpus, manifest };
}

function main() {
  const { corpus, manifest } = build();
  if (problems.length > 0) {
    for (const p of problems) console.error(`content: ${p}`);
    process.exitCode = 1;
    return;
  }
  const corpusJson = `${JSON.stringify(corpus, null, 1)}\n`;
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    let stale = 0;
    for (const [url, json] of [
      [CORPUS_OUT, corpusJson],
      [MANIFEST_OUT, manifestJson],
    ]) {
      const current = existsSync(url) ? readFileSync(url, 'utf8') : '';
      if (current !== json) {
        stale += 1;
        console.error(`content: ${url.pathname} is stale; run npm run content:build.`);
      }
    }
    if (stale > 0) process.exitCode = 1;
    else console.log(`content: ${manifest.corpora.length} corpora valid and up to date (fingerprint ${manifest.fingerprint.slice(0, 12)}).`);
    return;
  }
  writeFileSync(CORPUS_OUT, corpusJson);
  writeFileSync(MANIFEST_OUT, manifestJson);
  console.log(`content: wrote ${CORPUS_OUT.pathname} and ${MANIFEST_OUT.pathname}`);
  for (const c of manifest.corpora) {
    console.log(`  ${c.id}: ${c.items ? `${c.items.length} items, ${c.items.map((i) => i.chars).join('/')} chars` : `${c.words} words (${c.beginnerWords} beginner)`}`);
  }
}

main();
