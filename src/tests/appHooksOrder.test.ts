import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Regression: App() returns the landing page early (`if (!hasEnteredApp)`).
 * Any hook declared AFTER that return runs on a different render than before
 * the user clicks "Get started", so React throws "Rendered more hooks than
 * during the previous render" and the whole app dies.
 */
describe('App hook order', () => {
  it('declares no React hooks after the landing-page early return', () => {
    const src = readFileSync('src/App.tsx', 'utf8');
    const early = src.indexOf('if (!hasEnteredApp)');
    expect(early).toBeGreaterThan(0);
    const after = src.slice(early);
    // top-level hook calls inside the App component body (2-space indent)
    const offenders = after.match(/^ {2}(?:const [^=]+= )?use[A-Z]\w*(?:<[^>]*>)?\(/gm) || [];
    expect(offenders).toEqual([]);
  });
});
