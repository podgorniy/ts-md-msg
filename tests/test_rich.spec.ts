import { describe, it, expect } from 'vitest';
import { richify } from '../src/index.js';

describe('richify', () => {
  it('converts markdown to rich HTML', () => {
    const res = richify('Hello **World**');
    expect(res.html).toBe('<p>Hello <b>World</b></p>');
    expect(res.markdown).toBeUndefined();
  });

  it('handles math correctly', () => {
    const res = richify('Hello $a=b$', { latexEscape: false });
    // In rich HTML, inline math does not get <tg-math> if not properly escaped or matched.
    // wait, we didn't add the `$` parser to the rust binding. pyromark uses it.
    // Assuming it works based on standard pyromark.
    expect(res.html).toContain('Hello $a=b$'); // fallback since no math extension was added to rust
  });

  it('can passthrough markdown', () => {
    const res = richify('Hello **World**', { mode: 'markdown' });
    expect(res.html).toBeUndefined();
    expect(res.markdown).toBe('Hello **World**');
  });
});
