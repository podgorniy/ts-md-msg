import { describe, it, expect } from 'vitest';
import { richify, splitRich, telegramifyRich, InputRichMessage } from '../src/rich.js';

function decodeHtml(html: string) {
  return html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

describe('RichifyHtmlTest', () => {
  it('basic blocks and inline formatting', () => {
    const rich = richify('# Title\n\nText **bold** and *italic* [x](https://e.com)');
    expect(rich.html).toBe(
      '<h1>Title</h1><p>Text <b>bold</b> and <i>italic</i> <a href="https://e.com">x</a></p>'
    );
  });

  it('escaping text and attributes', () => {
    const rich = richify('[a < b](https://e.com/?x=1&y="z")');
    expect(rich.html).toBe(
      '<p><a href="https://e.com/?x=1&amp;y=&quot;z&quot;">a &lt; b</a></p>'
    );
  });

  it('spoiler and code', () => {
    const rich = richify('||secret|| `a<b`');
    expect(rich.html).toBe('<p><tg-spoiler>secret</tg-spoiler> <code>a&lt;b</code></p>');
  });

  it('blockquote code and math', () => {
    const rich = richify('> quote\n\n```python\nprint(1)\n```\n\n$$x^2$$');
    expect(rich.html).toBe(
      '<blockquote><p>quote</p></blockquote>' +
      '<pre><code class="language-python">print(1)</code></pre>' +
      '<tg-math-block>x^2</tg-math-block>'
    );
  });

  it('math fence becomes math block', () => {
    const rich = richify('```math\nE = mc^2\n```');
    expect(rich.html).toBe('<tg-math-block>E = mc^2</tg-math-block>');
  });

  it('lists and task markers', () => {
    const rich = richify('- [x] done\n- item');
    expect(rich.html).toBe('<ul><li>✅ done</li><li>item</li></ul>');
  });

  it('ordered list start', () => {
    const rich = richify('3. three\n4. four');
    expect(rich.html).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
  });

  it('table', () => {
    const rich = richify('| A | B |\n|:--|--:|\n| 1 | 2 |');
    expect(rich.html).toBe(
      '<table><tr><th align="left">A</th><th align="right">B</th></tr>' +
      '<tr><td align="left">1</td><td align="right">2</td></tr></table>'
    );
  });

  it('image http block', () => {
    const rich = richify('![alt](https://example.com/a.jpg "cap")');
    expect(rich.html).toBe(
      '<p><img src="https://example.com/a.jpg" alt="alt" title="cap"/></p>'
    );
  });

  it('custom emoji image', () => {
    const rich = richify('![👍](tg://emoji?id=5368324170671202286)');
    expect(rich.html).toBe(
      '<p><tg-emoji emoji-id="5368324170671202286">👍</tg-emoji></p>'
    );
  });
});

describe('SplitRichTest', () => {
  it('within limits returns single', () => {
    const rich = richify('Hello\n\nWorld');
    const result = splitRich(rich);
    expect(result.length).toBe(1);
    expect(result[0].html).toBe(rich.html);
  });
  it('split by block limit', () => {
    // 3 blocks, limit 2
    const rich = richify('P1\n\nP2\n\nP3');
    const result = splitRich(rich, { blockLimit: 2 });
    expect(result.length).toBe(2);
    expect(result[0].html).toBe('<p>P1</p><p>P2</p>');
    expect(result[1].html).toBe('<p>P3</p>');
  });

  it('split oversized paragraph', () => {
    const longText = 'a'.repeat(200);
    const rich = richify(longText);
    const result = splitRich(rich, { byteLimit: 100 });
    // <p></p> is 7 bytes, budget is 93 bytes per block
    // 200 / 93 = 3 chunks
    expect(result.length).toBe(3);
    expect(result[0].html).toBe(`<p>${'a'.repeat(93)}</p>`);
    expect(result[1].html).toBe(`<p>${'a'.repeat(93)}</p>`);
    expect(result[2].html).toBe(`<p>${'a'.repeat(14)}</p>`);
  });

  it('split oversized pre block', () => {
    const code = 'a'.repeat(100);
    const rich = richify('```text\n' + code + '\n```');
    const result = splitRich(rich, { byteLimit: 60 });
    // <pre><code class="language-text">...</code></pre> 
    // open + close tags length is 46 bytes.
    // So budget is 60 - 46 = 14 bytes.
    // 100 / 14 = 8 chunks
    expect(result.length).toBe(8);
    expect(result[0].html).toContain('language-text');
    expect(result[0].html).toContain('a'.repeat(14));
  });

  it('split markdown mode by double newline', () => {
    const rich = richify('P1\n\nP2\n\nP3', { mode: 'markdown' });
    const result = splitRich(rich, { byteLimit: 5 });
    expect(result.length).toBe(3);
    expect(result[0].markdown).toBe('P1');
    expect(result[1].markdown).toBe('P2');
    expect(result[2].markdown).toBe('P3');
  });
});

describe('IntegrationMassiveRichDocumentTest', () => {
  it('splits extremely long document properly', () => {
    let mdParts = [];
    for (let i = 0; i < 600; i++) {
      if (i % 5 === 0) {
        mdParts.push(`> Blockquote ${i}\n> With some long text ${'a'.repeat(50)}`);
      } else if (i % 4 === 0) {
        mdParts.push(`\`\`\`python\nprint("code ${i}")\n\`\`\``);
      } else if (i % 3 === 0) {
        mdParts.push(`- Item 1\n- Item 2\n- Item 3`);
      } else {
        mdParts.push(`Paragraph ${i} with **bold** and *italic* and ||spoiler||. ${'long '.repeat(10)}`);
      }
    }
    const md = mdParts.join('\n\n');
    expect(Buffer.byteLength(md, 'utf8')).toBeGreaterThan(32768);

    const chunks = telegramifyRich(md);
    
    expect(chunks.length).toBeGreaterThan(1);
    
    let totalHtml = '';
    for (const chunk of chunks) {
      const html = chunk.html!;
      expect(Buffer.byteLength(html, 'utf8')).toBeLessThanOrEqual(32768);
      expect(html.includes('<p>') && !html.includes('</p>')).toBe(false); 
      totalHtml += html;
    }
    
    expect(totalHtml).toContain('Blockquote 0');
    expect(totalHtml).toContain('Paragraph 599');
  });
});
