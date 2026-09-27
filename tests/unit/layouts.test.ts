import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GEOMETRIES, GEOMETRY_IDS, geometryById } from '../../src/domain/layouts/geometry';
import { LAYOUTS, type LayoutId, layoutById, levelChar, levelDead, strokesFor } from '../../src/domain/layouts/registry';
import { CORE_MODES, BASELINE_MODE, layoutForMode, modeById } from '../../src/domain/modes';

const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[];

function base(id: LayoutId, code: string): string | null {
  return levelChar(layoutById(id).keys[code]?.levels[0]);
}

function shifted(id: LayoutId, code: string): string | null {
  return levelChar(layoutById(id).keys[code]?.levels[1]);
}

describe('representative outputs from docs/input-and-layouts.md', () => {
  const rows: [string, string, string, string][] = [
    ['KeyQ', 'q', ';', '5'],
    ['KeyF', 'f', 'd', 'a'],
    ['KeyJ', 'j', 'e', 't'],
    ['Digit4', '4', 'p', '4'],
    ['Digit5', '5', 'f', 'j'],
  ];
  it.each(rows)('%s → QWERTY %s, Dvorak-L %s, Dvorak-R %s', (code, q, dl, dr) => {
    expect(base('qwerty-us', code)).toBe(q);
    expect(base('qwerty-us-intl', code)).toBe(q);
    expect(base('dvorak-left-us', code)).toBe(dl);
    expect(base('dvorak-right-us', code)).toBe(dr);
  });

  it('Shift + Digit1 → ! on QWERTY and Dvorak-R, { on Dvorak-L', () => {
    expect(shifted('qwerty-us', 'Digit1')).toBe('!');
    expect(shifted('qwerty-us-intl', 'Digit1')).toBe('!');
    expect(shifted('dvorak-left-us', 'Digit1')).toBe('{');
    expect(shifted('dvorak-right-us', 'Digit1')).toBe('!');
  });

  it('matches the dedicated tutor home positions for DL and DR', () => {
    expect(['KeyF', 'KeyG', 'KeyH', 'KeyJ'].map((c) => base('dvorak-left-us', c))).toEqual(['d', 't', 'h', 'e']);
    expect(['KeyF', 'KeyG', 'KeyH', 'KeyJ'].map((c) => base('dvorak-right-us', c))).toEqual(['a', 'e', 'h', 't']);
  });

  it('keeps Dvorak-L and Dvorak-R as distinct maps rather than mirror images', () => {
    const left = layoutById('dvorak-left-us');
    const right = layoutById('dvorak-right-us');
    const mirrored = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
    const leftRow = mirrored.map((c) => levelChar(left.keys[c]?.levels[0]));
    const rightRow = [...mirrored].reverse().map((c) => levelChar(right.keys[c]?.levels[0]));
    expect(leftRow).not.toEqual(rightRow);
  });
});

describe('coverage of every supported geometry', () => {
  for (const layoutId of LAYOUT_IDS) {
    for (const geometryId of GEOMETRY_IDS) {
      const layout = layoutById(layoutId);
      const geometry = geometryById(geometryId);
      it(`${layoutId} on ${geometryId} maps every printable position and reaches every letter`, () => {
        for (const code of geometry.printableCodes) expect(layout.keys[code], code).toBeDefined();
        for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
          expect(strokesFor(layout, geometry, letter)[0], letter).toMatchObject({ level: 0 });
          expect(strokesFor(layout, geometry, letter.toUpperCase())[0], letter).toMatchObject({ level: 1 });
        }
        expect(strokesFor(layout, geometry, ' ')).toEqual([{ code: 'Space', level: 0 }]);
      });

      it(`${layoutId} on ${geometryId} reaches all printable ASCII without AltGr`, () => {
        for (let c = 0x21; c <= 0x7e; c += 1) {
          const ch = String.fromCharCode(c);
          const stroke = strokesFor(layout, geometry, ch).find((s) => s.level < 2);
          expect(stroke, `${layoutId} cannot type ${ch}`).toBeDefined();
        }
      });
    }
  }

  it('lists 47 printable ANSI positions and 49 on ABNT2', () => {
    expect(GEOMETRIES['ansi-us'].printableCodes).toHaveLength(47);
    expect(GEOMETRIES.abnt2.printableCodes).toHaveLength(49);
    expect(new Set(GEOMETRIES.abnt2.printableCodes).size).toBe(49);
  });

  it('gives ABNT2 extra keys the outputs XKB resolves for US-based layouts', () => {
    expect(layoutById('qwerty-us').keys.IntlRo?.levels).toEqual([]);
    expect(layoutById('dvorak-left-us').keys.IntlRo?.levels).toEqual([]);
    expect(base('qwerty-us', 'IntlBackslash')).toBe('<');
    expect(base('qwerty-us-intl', 'IntlBackslash')).toBe('\\');
  });
});

describe('US International dead keys', () => {
  const intl = layoutById('qwerty-us-intl');
  it("declares ' \" ` ~ ^ as dead keys completed by Space", () => {
    expect(levelDead(intl.keys.Quote?.levels[0])).toBe('acute');
    expect(levelDead(intl.keys.Quote?.levels[1])).toBe('diaeresis');
    expect(levelDead(intl.keys.Backquote?.levels[0])).toBe('grave');
    expect(levelDead(intl.keys.Backquote?.levels[1])).toBe('tilde');
    expect(levelDead(intl.keys.Digit6?.levels[1])).toBe('circumflex');
    expect(intl.deadKeySpace).toEqual({ acute: "'", diaeresis: '"', grave: '`', tilde: '~', circumflex: '^' });
    expect(intl.altGr).toBe('right-alt-level3');
  });

  it("types an apostrophe as the dead key plus Space before the AltGr alternative", () => {
    const strokes = strokesFor(intl, geometryById('ansi-us'), "'");
    expect(strokes[0]).toEqual({ code: 'Quote', level: 0, then: { code: 'Space' } });
    expect(strokes[1]).toEqual({ code: 'Quote', level: 2 });
  });

  it('offers ç directly on AltGr + comma', () => {
    expect(strokesFor(intl, geometryById('ansi-us'), 'ç')).toEqual([{ code: 'Comma', level: 2 }]);
    expect(strokesFor(layoutById('qwerty-us'), geometryById('ansi-us'), 'ç')).toEqual([]);
  });
});

describe('mode catalog', () => {
  it('keeps four core modes and a separate two-hand baseline', () => {
    expect(CORE_MODES.map((m) => m.id)).toEqual(['QL', 'QR', 'DL', 'DR']);
    expect(BASELINE_MODE).toMatchObject({ id: 'Q2', hand: 'both', countsTowardCore: false });
  });

  it('routes QWERTY modes through the setup choice and Dvorak modes to their own maps', () => {
    expect(layoutForMode(modeById('QL'), 'qwerty-us')).toBe('qwerty-us');
    expect(layoutForMode(modeById('QR'), 'qwerty-us-intl')).toBe('qwerty-us-intl');
    expect(layoutForMode(modeById('DL'), 'qwerty-us')).toBe('dvorak-left-us');
    expect(layoutForMode(modeById('DR'), 'qwerty-us')).toBe('dvorak-right-us');
  });
});

describe('provenance', () => {
  it('records the XKB source for every layout', () => {
    for (const layout of Object.values(LAYOUTS)) {
      expect(layout.source).toMatchObject({ project: 'xkeyboard-config', rules: 'evdev' });
      expect(layout.os.inputSourceLabel).toMatch(/^English/);
    }
  });

  const hasXkb = existsSync('/usr/bin/xkbcomp') && existsSync('/usr/share/X11/xkb/symbols/us');
  it.skipIf(!hasXkb)('matches the XKB definitions installed on this machine', () => {
    const output = execFileSync('node', ['scripts/xkb-extract.mjs', '--check'], { encoding: 'utf8' });
    expect(output).not.toMatch(/differs/);
  });
});
