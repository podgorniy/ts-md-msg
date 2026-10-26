import { describe, it, expect } from 'vitest';
import {
  toTelegraphNodes,
  splitTelegraphNodes,
  telegraphByteLength,
  isTelegraphSafe,
  TelegraphNode,
} from '../src/telegraph.js';

describe('toTelegraphNodes', () => {
  it('wraps paragraphs and inline formatting', () => {
    expect(toTelegraphNodes('Hello **bold** _it_ ~~gone~~ `x`')).toEqual([
      {
        tag: 'p',
        children: [
          'Hello ',
          { tag: 'b', children: ['bold'] },
          ' ',
          { tag: 'i', children: ['it'] },
          ' ',
          { tag: 's', children: ['gone'] },
          ' ',
          { tag: 'code', children: ['x'] },
        ],
      },
    ]);
  });

  it('maps h1/h2 to h3 and deeper headings to h4', () => {
    expect(toTelegraphNodes('# A\n\n## B\n\n### C\n\n###### D')).toEqual([
      { tag: 'h3', children: ['A'] },
      { tag: 'h3', children: ['B'] },
      { tag: 'h4', children: ['C'] },
      { tag: 'h4', children: ['D'] },
    ]);
  });

  it('renders code fences as pre without a language', () => {
    expect(toTelegraphNodes('```ts\nconst a = 1;\n```')).toEqual([{ tag: 'pre', children: ['const a = 1;'] }]);
  });

  it('keeps only safe links', () => {
    expect(toTelegraphNodes('[ok](https://e.com) [bad](javascript:alert(1)) [rel](/x)')).toEqual([
      {
        tag: 'p',
        children: [{ tag: 'a', attrs: { href: 'https://e.com' }, children: ['ok'] }, ' bad rel'],
      },
    ]);
  });

  it('flattens nested lists into lines of the outer item', () => {
    const nodes = toTelegraphNodes('1. a\n   - b\n   - c\n2. d');
    expect(nodes).toEqual([
      {
        tag: 'ol',
        children: [
          {
            tag: 'li',
            children: ['a', { tag: 'br' }, '   ◦ b', { tag: 'br' }, '   ◦ c'],
          },
          { tag: 'li', children: ['d'] },
        ],
      },
    ]);
  });

  it('flattens loose-list paragraphs into lines', () => {
    const nodes = toTelegraphNodes('- one\n\n  more\n\n- two');
    expect(nodes).toEqual([
      {
        tag: 'ul',
        children: [
          { tag: 'li', children: ['one', { tag: 'br' }, 'more'] },
          { tag: 'li', children: ['two'] },
        ],
      },
    ]);
  });

  it('renders tables as aligned preformatted text', () => {
    const nodes = toTelegraphNodes('| a | bb |\n|---|---|\n| ccc | **d** |');
    expect(nodes).toEqual([{ tag: 'pre', children: ['a   │ bb\n────┼───\nccc │ d'] }]);
  });

  it('turns blockquote paragraphs into lines', () => {
    expect(toTelegraphNodes('> one\n>\n> two')).toEqual([
      { tag: 'blockquote', children: ['one', { tag: 'br' }, 'two'] },
    ]);
  });

  it('makes images links, since Telegraph cannot host them', () => {
    expect(toTelegraphNodes('![cat](https://x.org/c.png)')).toEqual([
      { tag: 'p', children: [{ tag: 'a', attrs: { href: 'https://x.org/c.png' }, children: ['🖼 cat'] }] },
    ]);
  });

  it('drops spoiler markers, keeps math and footnotes as text', () => {
    const nodes = toTelegraphNodes('||secret|| $x^2$ ref[^1]\n\n[^1]: note');
    expect(isTelegraphSafe(nodes)).toBe(true);
    const flat = JSON.stringify(nodes);
    expect(flat).toContain('secret');
    expect(flat).not.toContain('tg-spoiler');
    expect(flat).toContain('x^2');
    expect(flat).toContain('[1] ');
  });

  it('renders rules and task lists', () => {
    expect(toTelegraphNodes('a\n\n---\n\n- [x] done')).toEqual([
      { tag: 'p', children: ['a'] },
      { tag: 'hr' },
      { tag: 'ul', children: [{ tag: 'li', children: ['✅ done'] }] },
    ]);
  });

  it('never emits a tag or attribute Telegraph rejects', () => {
    const sample = [
      '# T', '<div>raw</div>', '| a |\n|---|\n| b |', '```math\nx\n```', '$$y$$',
      '* [l](https://a.b "t")', '![i](data:image/png;base64,xx)', '> q\n> - nested',
    ].join('\n\n');
    expect(isTelegraphSafe(toTelegraphNodes(sample))).toBe(true);
  });
});

describe('splitTelegraphNodes', () => {
  const paragraph = (text: string): TelegraphNode => ({ tag: 'p', children: [text] });

  it('keeps everything on one page when it fits', () => {
    const nodes = [paragraph('a'), paragraph('b')];
    expect(splitTelegraphNodes(nodes, 1000)).toEqual([nodes]);
  });

  it('packs pages within the budget, counting UTF-8 bytes', () => {
    const cyrillic = 'Привет мир '.repeat(30);
    const nodes = Array.from({ length: 20 }, () => paragraph(cyrillic));
    const budget = 2000;
    const pages = splitTelegraphNodes(nodes, budget);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(telegraphByteLength(page)).toBeLessThanOrEqual(budget);
    expect(pages.flat()).toEqual(nodes);
  });

  it('splits a single oversized node into copies of itself', () => {
    const long = paragraph('слово '.repeat(2000));
    const budget = 3000;
    const pages = splitTelegraphNodes([long], budget);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(telegraphByteLength(page)).toBeLessThanOrEqual(budget);
      for (const node of page) expect(typeof node === 'object' && node.tag).toBe('p');
    }
    const text = pages.flat().map((n) => (typeof n === 'string' ? n : (n.children ?? []).join(''))).join('');
    expect(text).toBe('слово '.repeat(2000));
  });

  it('splits an oversized list by items', () => {
    const list: TelegraphNode = {
      tag: 'ul',
      children: Array.from({ length: 200 }, (_, i) => ({ tag: 'li' as const, children: [`item ${i} `.repeat(5)] })),
    };
    const pages = splitTelegraphNodes([list], 2500);
    for (const page of pages) expect(telegraphByteLength(page)).toBeLessThanOrEqual(2500);
    const items = pages.flat().flatMap((n) => (typeof n === 'string' ? [] : n.children ?? []));
    expect(items).toHaveLength(200);
  });

  it('rejects a budget no page can meet', () => {
    expect(() => splitTelegraphNodes([paragraph('a')], 10)).toThrow();
  });
});
