import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BEGINNER_WORDS, CODE, MONTHLY, PROSE, SYMBOLS, WORDS } from '../../src/content/corpus';
import { introducedAt, keyStages, letterPositions } from '../../src/domain/curriculum';
import { customExercise, verifyExercise } from '../../src/domain/exercises/exercise';
import {
  artificialDrill,
  choosePassage,
  coverageDrill,
  relocationDrill,
  spatialDrill,
  wordDrill,
} from '../../src/domain/exercises/generators';
import { seedLedger, qwertyZones } from '../../src/domain/fingering';
import { GEOMETRY_IDS, geometryById } from '../../src/domain/layouts/geometry';
import { LAYOUTS, layoutById } from '../../src/domain/layouts/registry';
import { sha256Hex } from '../../src/domain/text/sha256';

describe('bundled corpus', () => {
  it('has twelve original prose passages of at least 2,000 printable ASCII characters', () => {
    expect(PROSE.items).toHaveLength(12);
    for (const item of PROSE.items) {
      expect(item.text.length).toBeGreaterThanOrEqual(2000);
      expect(item.text).toMatch(/^[\x20-\x7e]+$/);
      expect(item.text).toBe(item.text.normalize('NFC'));
      expect(sha256Hex(item.text)).toBe(item.sha256);
    }
    expect(MONTHLY.items).toHaveLength(1);
    expect(MONTHLY.items[0]?.text.length).toBeGreaterThanOrEqual(2000);
  });

  it('has at least 200 beginner words, plus numbers/symbols and code exercises', () => {
    expect(BEGINNER_WORDS.length).toBeGreaterThanOrEqual(200);
    expect(new Set(WORDS.words).size).toBe(WORDS.words.length);
    expect(SYMBOLS.items[0]?.text).toMatch(/\d/);
    expect(CODE.items.length).toBeGreaterThanOrEqual(3);
    for (const item of CODE.items) expect(item.text).toMatch(/^[\x20-\x7e\n]+$/);
  });

  it('matches the committed manifest', () => {
    const out = execFileSync('node', ['scripts/build-corpus.mjs', '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/up to date/);
  });

  it('every prose passage is reachable on every supported layout without AltGr', () => {
    for (const layout of Object.values(LAYOUTS)) {
      const reachable = new Set(introducedAt(layout, geometryById('ansi-us'), 4).chars);
      for (const item of PROSE.items) for (const c of new Set(item.text)) expect(reachable.has(c), `${layout.id} ${c}`).toBe(true);
    }
  });
});

describe('seeded generators', () => {
  const home = [...'asdfghjkl '];

  it('reproduces word drills from the seed and stays inside the key set', () => {
    const a = wordDrill({ seed: 11, charset: home, length: 120 });
    expect(wordDrill({ seed: 11, charset: home, length: 120 }).text).toBe(a.text);
    expect(wordDrill({ seed: 12, charset: home, length: 120 }).text).not.toBe(a.text);
    expect([...a.text].every((c) => home.includes(c))).toBe(true);
    expect(a.artificial).toBe(false);
    expect(a.text.length).toBeGreaterThanOrEqual(120);
    expect(verifyExercise(a)).toBe(true);
  });

  it('falls back to artificial groups when the keys cannot form words, and says so', () => {
    const drill = wordDrill({ seed: 1, charset: [...'qzx '], length: 40 });
    expect(drill.artificial).toBe(true);
    expect(drill.title).toMatch(/artificial/);
  });

  it('capitalizes and punctuates only when those keys are allowed', () => {
    const lower = wordDrill({ seed: 5, charset: home, length: 200, capitalFraction: 0.5, punctuationFraction: 0.5 });
    expect(lower.text).toBe(lower.text.toLowerCase());
    const upper = wordDrill({ seed: 5, charset: [...home, ...'ASDFGHJKL', ',', '.'], length: 200, capitalFraction: 0.5, punctuationFraction: 0.5 });
    expect(upper.text).toMatch(/[A-Z]/);
    expect(upper.text).toMatch(/[,.]/);
  });

  it('covers every requested character the requested number of times', () => {
    const drill = coverageDrill({ seed: 9, chars: [...'qwerty'], repeats: 2 });
    for (const c of 'qwerty') expect(drill.text.split(c).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('builds the level-0 spatial sequence: 26 letters twice, shuffled, one at a time', () => {
    const letters = [...'abcdefghijklmnopqrstuvwxyz'];
    const drill = spatialDrill({ seed: 4, letters, repeats: 2 });
    expect(drill.length).toBe(52);
    expect(drill.presentation).toBe('single');
    for (const l of letters) expect(drill.text.split(l).length - 1).toBe(2);
    for (let i = 1; i < drill.text.length; i += 1) expect(drill.text[i]).not.toBe(drill.text[i - 1]);
  });

  it('alternates relocation groups between zones', () => {
    const drill = relocationDrill({ seed: 2, zones: [{ name: 'left', chars: [...'asdf'] }, { name: 'right', chars: [...'jkl;'] }], length: 80 });
    const groups = drill.text.split(' ');
    for (let i = 1; i < groups.length; i += 1) {
      const zone = (g: string) => ('asdf'.includes(g[0] as string) ? 'L' : 'R');
      expect(zone(groups[i] as string)).not.toBe(zone(groups[i - 1] as string));
    }
  });

  it('chooses passages deterministically and avoids repeats in a set', () => {
    const first = choosePassage(PROSE, 100);
    expect(choosePassage(PROSE, 100).id).toBe(first.id);
    expect(choosePassage(PROSE, 100, [first.id]).id).not.toBe(first.id);
  });

  it('normalizes custom text: composition-friendly, tabs to spaces, LF endings', () => {
    const ex = customExercise('Olá,\tação!\r\nSegunda linha  \n', 'pt');
    expect(ex.text).toBe('Olá,  ação!\nSegunda linha');
    expect(ex.length).toBe([...'Olá,  ação!\nSegunda linha'].length);
    expect(ex.id).toMatch(/^custom:/);
  });

  it('artificial drills include every allowed character', () => {
    const drill = artificialDrill({ seed: 8, charset: [...'jkl;'], length: 30 });
    for (const c of 'jkl;') expect(drill.text).toContain(c);
  });
});

describe('curriculum', () => {
  it('introduces keys by physical row and covers the whole alphabet by the end of level 2', () => {
    for (const layout of Object.values(LAYOUTS)) {
      for (const g of GEOMETRY_IDS) {
        const geometry = geometryById(g);
        const stages = keyStages(layout, geometry);
        const letters = stages.filter((s) => s.id !== 'rest').flatMap((s) => s.chars).filter((c) => /[a-z]/.test(c));
        expect(new Set(letters).size, `${layout.id}/${g}`).toBe(26);
        expect(letterPositions(layout, geometry).size).toBe(26);
      }
    }
  });

  it('one-hand Dvorak introduces its number-row letters inside level 2', () => {
    const dl = keyStages(layoutById('dvorak-left-us'), geometryById('ansi-us'));
    expect(dl.map((s) => s.id)).toEqual(['home', 'top', 'bottom', 'number', 'rest']);
    expect(dl.find((s) => s.id === 'number')?.chars.filter((c) => /[a-z]/.test(c)).sort()).toEqual(['f', 'j', 'l', 'm', 'p']);
    expect(keyStages(layoutById('qwerty-us-intl'), geometryById('ansi-us')).map((s) => s.id)).toEqual(['home', 'top', 'bottom', 'rest']);
  });

  it('A03: a right-hand QWERTY mode trains the full board, not only the right half', () => {
    const qr = introducedAt(layoutById('qwerty-us-intl'), geometryById('ansi-us'), 3);
    for (const letter of 'qwertasdfgzxcvb') expect(qr.chars).toContain(letter);
    const ledger = seedLedger({ id: 'l', ledgerId: 'L', mode: 'QR', setupId: 's', geometry: geometryById('ansi-us'), createdAt: '', effectiveDate: '2026-09-01' });
    expect(ledger.zones.map((z) => z.name)).toEqual(['Left reach · anchor KeyF', 'Center reach', 'Home · anchor KeyJ']);
    expect(ledger.entries.filter((e) => e.finger !== null).map((e) => e.code)).toEqual(['Space']);
    const zones = qwertyZones('QR', geometryById('ansi-us'));
    const covered = new Set(zones.flatMap((z) => z.codes));
    for (const code of geometryById('ansi-us').printableCodes) expect(covered.has(code), code).toBe(true);
  });

  it('seeds the one-hand Dvorak home prompts and leaves other fingers unset', () => {
    const dl = seedLedger({ id: 'l', ledgerId: 'L', mode: 'DL', setupId: 's', geometry: geometryById('ansi-us'), createdAt: '', effectiveDate: '2026-09-01' });
    expect(dl.entries.filter((e) => e.finger && e.code !== 'Space').map((e) => [e.code, e.finger])).toEqual([
      ['KeyF', 'little'],
      ['KeyG', 'ring'],
      ['KeyH', 'middle'],
      ['KeyJ', 'index'],
    ]);
    const dr = seedLedger({ id: 'l', ledgerId: 'L', mode: 'DR', setupId: 's', geometry: geometryById('ansi-us'), createdAt: '', effectiveDate: '2026-09-01' });
    expect(dr.entries.find((e) => e.code === 'KeyF')?.finger).toBe('index');
    expect(dr.freezeUntil).toBe('2026-09-15');
  });

  it('level 1 teaches the home-row letters with Shift and Space', () => {
    const l1 = introducedAt(layoutById('dvorak-right-us'), geometryById('ansi-us'), 1);
    expect(l1.chars).toContain(' ');
    expect(l1.chars).toContain('A');
    expect(l1.chars.filter((c) => /[a-z]/.test(c)).sort().join('')).toBe('acdehktz');
  });
});
