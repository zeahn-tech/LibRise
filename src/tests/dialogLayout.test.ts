import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the dialog layout rules so the "dialog runs off the top/bottom of the phone" problem cannot come back:
 *  - heights are capped with dvh (the visible viewport), never vh (which ignores mobile browser bars);
 *  - a centred overlay never scrolls itself (a centred flex box taller than its scroller loses its top edge); the
 *    dialog card scrolls internally instead;
 *  - close buttons sit at the upper edge (top-3/right-3), not top-6/right-6 where they crowd header text.
 */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });

const files = walk('src/components').map((f) => ({ f, lines: readFileSync(f, 'utf8').split('\n') }));

describe('dialog layout rules', () => {
  it('never caps dialog height with vh', () => {
    const bad = files.flatMap(({ f, lines }) => lines.map((l, i) => (/max-h-\[\d+vh\]/.test(l) ? `${f}:${i + 1}` : '')).filter(Boolean));
    expect(bad).toEqual([]);
  });

  it('centred full-screen overlays do not scroll themselves', () => {
    const bad = files.flatMap(({ f, lines }) =>
      lines
        .map((l, i) => (/fixed inset-0/.test(l) && /items-center/.test(l) && !/items-end/.test(l) && /overflow-y-auto/.test(l) ? `${f}:${i + 1}` : ''))
        .filter(Boolean)
    );
    expect(bad).toEqual([]);
  });

  it('dialog cards are not vertically centred with margins that push them off-screen', () => {
    const bad = files.flatMap(({ f, lines }) =>
      lines.map((l, i) => (/max-h-\[9\dd?vh\]|max-h-\[9\ddvh\]/.test(l) && /\bmy-(8|auto)\b/.test(l) ? `${f}:${i + 1}` : '')).filter(Boolean)
    );
    expect(bad).toEqual([]);
  });

  it('absolute close buttons are at the upper edge', () => {
    const bad = files.flatMap(({ f, lines }) =>
      lines.map((l, i) => (/absolute top-6 right-6/.test(l) && /w-11 h-11/.test(l) ? `${f}:${i + 1}` : '')).filter(Boolean)
    );
    expect(bad).toEqual([]);
  });
});
