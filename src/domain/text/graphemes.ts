// Text is compared as NFC-normalized grapheme clusters, so a composed "é"
// counts once however the operating system produced it.

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function normalizeText(text: string): string {
  return text.normalize('NFC');
}

export function toGraphemes(text: string): string[] {
  const graphemes: string[] = [];
  for (const { segment } of segmenter.segment(normalizeText(text))) graphemes.push(segment);
  return graphemes;
}

export function graphemeCount(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(normalizeText(text))) count += 1;
  return count;
}

/** Printable ASCII (U+0020–U+007E), the reference English character set. */
export function isPrintableAscii(grapheme: string): boolean {
  if (grapheme.length !== 1) return false;
  const code = grapheme.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e;
}
