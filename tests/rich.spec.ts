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
    expect(rich.html).toBe('<ul><li><input type="checkbox" checked/>done</li><li>item</li></ul>');
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
    // Media is a block of its own; the title is its caption
    const rich = richify('![alt](https://example.com/a.jpg "cap")');
    expect(rich.html).toBe(
      '<figure><img src="https://example.com/a.jpg"/><figcaption>cap</figcaption></figure>'
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

describe('RichifyHtmlExtendedTest', () => {
  it('strikethrough', () => {
    const rich = richify('~~struck~~');
    expect(rich.html).toBe('<p><s>struck</s></p>');
  });

  it('heading levels h2 through h6', () => {
    expect(richify('## H2').html).toBe('<h2>H2</h2>');
    expect(richify('### H3').html).toBe('<h3>H3</h3>');
    expect(richify('#### H4').html).toBe('<h4>H4</h4>');
    expect(richify('##### H5').html).toBe('<h5>H5</h5>');
    expect(richify('###### H6').html).toBe('<h6>H6</h6>');
  });

  it('inline math', () => {
    const rich = richify('$x^2 + y^2$');
    expect(rich.html).toBe('<p><tg-math>x^2 + y^2</tg-math></p>');
  });

  it('horizontal rule', () => {
    const rich = richify('---');
    expect(rich.html).toBe('<hr/>');
  });

  it('soft break becomes br', () => {
    const rich = richify('line1\nline2');
    expect(rich.html).toBe('<p>line1<br/>line2</p>');
  });

  it('nested bold and italic', () => {
    const rich = richify('**_nested_**');
    expect(rich.html).toBe('<p><b><i>nested</i></b></p>');
  });

  it('strikethrough inside bold', () => {
    const rich = richify('**~~struck~~**');
    expect(rich.html).toBe('<p><b><s>struck</s></b></p>');
  });

  it('unchecked task list marker', () => {
    const rich = richify('- [ ] todo');
    expect(rich.html).toBe('<ul><li><input type="checkbox"/>todo</li></ul>');
  });

  it('table with center alignment', () => {
    const rich = richify('| A | B |\n|:--|:--:|\n| 1 | 2 |');
    expect(rich.html).toContain('<td align="left">1</td>');
    expect(rich.html).toContain('<td align="center">2</td>');
  });

  it('bold text inside table cell', () => {
    const rich = richify('| A |\n|--|\n| **bold** |');
    expect(rich.html).toContain('<b>bold</b>');
  });

  it('code block without language', () => {
    const rich = richify('```\nplain code\n```');
    expect(rich.html).toBe('<pre>plain code</pre>');
  });

  it('code block escapes html chars', () => {
    const rich = richify('```\n<b>text & more</b>\n```');
    expect(rich.html).toBe('<pre>&lt;b&gt;text &amp; more&lt;/b&gt;</pre>');
  });

  it('nested blockquote', () => {
    const rich = richify('> > inner');
    expect(rich.html).toBe('<blockquote><blockquote><p>inner</p></blockquote></blockquote>');
  });

  it('two sequential blockquotes', () => {
    const rich = richify('> first\n\n> second');
    expect(rich.html).toBe('<blockquote><p>first</p></blockquote><blockquote><p>second</p></blockquote>');
  });

  it('footnote reference in text', () => {
    const rich = richify('See note[^fn1].\n\n[^fn1]: Footnote body.');
    expect(rich.html).toContain('<a href="#fn1">[fn1]</a>');
  });

  it('footnote definition becomes tg-reference', () => {
    // RichTextReference is inline, so it sits inside the definition's paragraph
    const rich = richify('See[^n1].\n\n[^n1]: Body *it*.');
    expect(rich.html).toBe(
      '<p>See<a href="#n1">[n1]</a>.</p><p>[n1] <tg-reference name="n1">Body <i>it</i>.</tg-reference></p>'
    );
  });

  it('image with non-http url falls back to link', () => {
    const rich = richify('![alt](ftp://example.com/file)');
    expect(rich.html).toBe('<p><a href="ftp://example.com/file">alt</a></p>');
  });

  it('image with empty url becomes plain text', () => {
    const rich = richify('![my alt]()');
    expect(rich.html).toBe('<p>my alt</p>');
  });

  it('custom emoji via link syntax', () => {
    // validateTelegramEmoji requires a 19-digit id (matching Telegram's format)
    const rich = richify('[thumbs up](tg://emoji?id=5368324170671202286)');
    expect(rich.html).toBe('<p><tg-emoji emoji-id="5368324170671202286">thumbs up</tg-emoji></p>');
  });

  it('link with empty dest produces plain text', () => {
    const rich = richify('[text]()');
    expect(rich.html).toBe('<p>text</p>');
  });

  it('tg-spoiler via raw inline html', () => {
    const rich = richify('The <tg-spoiler>secret</tg-spoiler> text');
    expect(rich.html).toBe('<p>The <tg-spoiler>secret</tg-spoiler> text</p>');
  });

  it('isRtl option propagates', () => {
    const rich = richify('hello', { isRtl: true });
    expect(rich.is_rtl).toBe(true);
  });

  it('skipEntityDetection option propagates', () => {
    const rich = richify('hello', { skipEntityDetection: true });
    expect(rich.skip_entity_detection).toBe(true);
  });

  it('mode markdown returns passthrough without parsing', () => {
    const md = '**bold** _italic_';
    const rich = richify(md, { mode: 'markdown' });
    expect(rich.markdown).toBe(md);
    expect(rich.html).toBeUndefined();
  });

  it('invalid mode throws', () => {
    expect(() => richify('text', { mode: 'invalid' as any })).toThrow(/mode must be/);
  });

  it('latexEscape option does not break normal text', () => {
    const rich = richify('Normal text', { latexEscape: true });
    expect(rich.html).toBe('<p>Normal text</p>');
  });
});

describe('SplitRichExtendedTest', () => {
  it('isRtl is preserved across split chunks', () => {
    const rich = richify('P1\n\nP2\n\nP3', { isRtl: true });
    const chunks = splitRich(rich, { blockLimit: 2 });
    expect(chunks.length).toBe(2);
    expect(chunks[0].is_rtl).toBe(true);
    expect(chunks[1].is_rtl).toBe(true);
  });

  it('skipEntityDetection is preserved across split chunks', () => {
    const rich = richify('P1\n\nP2\n\nP3', { skipEntityDetection: true });
    const chunks = splitRich(rich, { blockLimit: 2 });
    expect(chunks.length).toBe(2);
    expect(chunks[0].skip_entity_detection).toBe(true);
    expect(chunks[1].skip_entity_detection).toBe(true);
  });

  it('markdown mode splits oversized single paragraph by bytes', () => {
    const longPara = 'x'.repeat(200);
    const rich = richify(longPara, { mode: 'markdown' });
    const chunks = splitRich(rich, { byteLimit: 50 });
    expect(chunks.length).toBe(4);
    for (const c of chunks) {
      expect(Buffer.byteLength(c.markdown!, 'utf8')).toBeLessThanOrEqual(50);
    }
    expect(chunks.map(c => c.markdown!).join('')).toBe(longPara);
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

describe('RichifySpecialLinksTest', () => {
  it('tel: link produces anchor with tel: href', () => {
    const rich = richify('[call](tel:+123456789)');
    expect(rich.html).toBe('<p><a href="tel:+123456789">call</a></p>');
  });

  it('mailto: link produces anchor with mailto: href', () => {
    const rich = richify('[email](mailto:user@example.com)');
    expect(rich.html).toBe('<p><a href="mailto:user@example.com">email</a></p>');
  });

  it('tg://user mention produces anchor with tg:// href', () => {
    const rich = richify('[User](tg://user?id=123456789)');
    expect(rich.html).toBe('<p><a href="tg://user?id=123456789">User</a></p>');
  });

  it('tg://time image becomes a regular link (not tg-time tag)', () => {
    const rich = richify('![22:45 tomorrow](tg://time?unix=1647531900&format=wDT)');
    expect(rich.html).toContain('<a href="tg://time?unix=1647531900&amp;format=wDT">');
    expect(rich.html).toContain('22:45 tomorrow');
  });
});

describe('RichifyLatexEscapeTest', () => {
  it('\\[...\\] becomes tg-math-block when latexEscape is on', () => {
    const rich = richify('\\[E = mc^2\\]', { latexEscape: true });
    expect(rich.html).toContain('<tg-math-block>');
  });

  it('\\(...\\) becomes tg-math inline when latexEscape is on', () => {
    // content must be >= 5 chars for containsLatexSymbols to detect it
    const rich = richify('prefix \\(x^2 + y^2\\) suffix', { latexEscape: true });
    expect(rich.html).toContain('<tg-math>');
  });

  it('latexEscape false leaves \\[...\\] as literal escaped text', () => {
    const rich = richify('\\[x^2\\]', { latexEscape: false });
    expect(rich.html).not.toContain('<tg-math-block>');
  });
});

describe('RichifyHardBreakTest', () => {
  it('two trailing spaces produce a hard break br tag', () => {
    const rich = richify('first line  \nsecond line');
    expect(rich.html).toBe('<p>first line<br/>second line</p>');
  });
});

describe('RichifyInlineHtmlTest', () => {
  it('bare formatting tags Telegram supports pass through', () => {
    expect(richify('The <u>underlined</u> text').html).toBe('<p>The <u>underlined</u> text</p>');
    expect(richify('text<sup>2</sup>').html).toBe('<p>text<sup>2</sup></p>');
    expect(richify('H<sub>2</sub>O').html).toBe('<p>H<sub>2</sub>O</p>');
    expect(richify('a <mark>hi</mark>').html).toBe('<p>a <mark>hi</mark></p>');
  });

  it('unknown tags, attributes and unbalanced closers are escaped', () => {
    expect(richify('a <font>x</font>').html).toBe('<p>a &lt;font&gt;x&lt;/font&gt;</p>');
    expect(richify('a <u class="x">x</u>').html).toBe('<p>a &lt;u class="x"&gt;x&lt;/u&gt;</p>');
    expect(richify('a </u> b').html).toBe('<p>a &lt;/u&gt; b</p>');
  });
});

describe('RichifyOrderedListTest', () => {
  it('ordered list starting at 1 emits start="1"', () => {
    const rich = richify('1. first\n2. second');
    expect(rich.html).toBe('<ol start="1"><li>first</li><li>second</li></ol>');
  });
});

describe('RichifyNestedListTest', () => {
  it('nested unordered list contains outer and inner ul elements', () => {
    const rich = richify('- parent\n  - child');
    expect(rich.html).toContain('<ul>');
    expect(rich.html).toContain('parent');
    expect(rich.html).toContain('child');
    const ulCount = (rich.html!.match(/<ul>/g) || []).length;
    expect(ulCount).toBeGreaterThanOrEqual(2);
  });
});

describe('RichMediaBlocksTest', () => {
  it('lifts media out of a paragraph into its own block', () => {
    const rich = richify('before ![a](https://e.com/p.png) after');
    expect(rich.html).toBe('<p>before </p><img src="https://e.com/p.png"/><p>after</p>');
  });

  it('chooses the media tag from the extension', () => {
    expect(richify('![](https://e.com/v.mp4)').html).toBe('<video src="https://e.com/v.mp4"></video>');
    expect(richify('![](https://e.com/a.gif)').html).toBe('<video src="https://e.com/a.gif"></video>');
    expect(richify('![](https://e.com/s.mp3)').html).toBe('<audio src="https://e.com/s.mp3"></audio>');
    expect(richify('![](https://e.com/f.zip?x=1)').html).toBe('<tg-document src="https://e.com/f.zip?x=1"></tg-document>');
    expect(richify('![](https://e.com/photo)').html).toBe('<img src="https://e.com/photo"/>');
  });

  it('supports tg:// media links', () => {
    expect(richify('![](tg://video?id=clip1)').html).toBe('<video src="tg://video?id=clip1"></video>');
  });

  it('degrades media to a link where a block cannot go', () => {
    expect(richify('# Title ![logo](https://e.com/l.png)').html).toBe('<h1>Title <a href="https://e.com/l.png">logo</a></h1>');
    expect(richify('| a |\n|---|\n| ![x](https://e.com/l.png) |').html).toContain('<td><a href="https://e.com/l.png">x</a></td>');
    expect(richify('**b ![x](https://e.com/l.png)**').html).toBe('<p><b>b <a href="https://e.com/l.png">x</a></b></p>');
  });

  it('keeps media inside list items', () => {
    expect(richify('- ![](https://e.com/p.png)').html).toBe('<ul><li><img src="https://e.com/p.png"/></li></ul>');
  });

  it('carries only the referenced media into each chunk', () => {
    const media = [
      { id: 'p1', media: { type: 'photo', media: 'attach://p1' } },
      { id: 'p2', media: { type: 'photo', media: 'attach://p2' } },
    ];
    const chunks = telegramifyRich('![](tg://photo?id=p1)\n\ntext\n\n![](tg://photo?id=p2)', { media, blockLimit: 2 });
    expect(chunks.map(c => c.media?.map(m => m.id))).toEqual([['p1'], ['p2']]);
  });
});

describe('RichLimitsTest', () => {
  it('counts list items and table rows against the block limit', () => {
    const items = Array.from({ length: 600 }, (_, i) => `${i + 1}. item ${i}`).join('\n');
    const chunks = telegramifyRich(items);
    expect(chunks.length).toBe(2);
    for (const chunk of chunks) {
      expect((chunk.html!.match(/<li>/g) || []).length).toBeLessThan(500);
    }
    // the second part continues the numbering
    expect(chunks[1].html!.startsWith('<ol start="500">')).toBe(true);
  });

  it('splits by the media limit', () => {
    const md = Array.from({ length: 60 }, (_, i) => `![](https://e.com/${i}.png)`).join('\n\n');
    const chunks = telegramifyRich(md);
    expect(chunks.length).toBe(2);
    expect((chunks[0].html!.match(/<img/g) || []).length).toBe(50);
  });

  it('keeps inline formatting when splitting an oversized paragraph', () => {
    const rich = richify('**' + 'word '.repeat(60).trim() + '**');
    const chunks = splitRich(rich, { byteLimit: 120 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.html).toMatch(/^<p><b>.*<\/b><\/p>$/s);
      expect(Buffer.byteLength(chunk.html!)).toBeLessThanOrEqual(120);
    }
  });

  it('splits an oversized pre block into well-formed parts', () => {
    const rich = richify('```js\n' + 'x < y;\n'.repeat(40) + '```');
    const chunks = splitRich(rich, { byteLimit: 100 });
    for (const chunk of chunks) {
      expect(chunk.html).toMatch(/^<pre><code class="language-js">[^<]*<\/code><\/pre>$/);
    }
  });

  it('splits after an HTML block instead of merging what follows', () => {
    const md = '<div>raw</div>\n\n' + Array.from({ length: 5 }, (_, i) => `para ${i}`).join('\n\n');
    const chunks = telegramifyRich(md, { blockLimit: 2 });
    expect(chunks.length).toBe(3);
  });

  it('keeps bare text when splitting caller-written HTML', () => {
    const chunks = splitRich({ html: 'lead<p>a</p>tail' }, { blockLimit: 1 });
    expect(chunks.map(c => c.html)).toEqual(['lead', '<p>a</p>', 'tail']);
  });
});
