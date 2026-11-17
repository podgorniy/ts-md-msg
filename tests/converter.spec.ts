import { describe, it, expect } from 'vitest';
import { convert, validateTelegramEmoji, preprocessSpoilers } from '../src/converter.js';
import { MessageEntity } from '../src/entity.js';

function findEntity(entities: MessageEntity[], type: string): MessageEntity | undefined {
  return entities.find((e) => e.type === type);
}

function extractEntityText(text: string, entity: MessageEntity): string {
  // In JavaScript, string indices are exactly UTF-16 code units.
  return text.slice(entity.offset, entity.offset + entity.length);
}

describe('BoldTest', () => {
  it('simple bold', () => {
    const res = convert('**hello**');
    expect(res.text).toContain('hello');
    const bold = findEntity(res.entities, 'bold');
    expect(bold).toBeDefined();
    expect(extractEntityText(res.text, bold!)).toBe('hello');
  });

  it('bold in sentence', () => {
    const res = convert('foo **bar** baz');
    const bold = findEntity(res.entities, 'bold');
    expect(bold).toBeDefined();
    expect(extractEntityText(res.text, bold!)).toBe('bar');
  });
});

describe('ItalicTest', () => {
  it('simple italic', () => {
    const res = convert('*hello*');
    const italic = findEntity(res.entities, 'italic');
    expect(italic).toBeDefined();
    expect(extractEntityText(res.text, italic!)).toBe('hello');
  });
});

describe('StrikethroughTest', () => {
  it('simple strikethrough', () => {
    const res = convert('~~hello~~');
    const s = findEntity(res.entities, 'strikethrough');
    expect(s).toBeDefined();
    expect(extractEntityText(res.text, s!)).toBe('hello');
  });
});

describe('NestedFormattingTest', () => {
  it('bold italic', () => {
    const res = convert('**bold *italic* bold**');
    const bold = findEntity(res.entities, 'bold');
    const italic = findEntity(res.entities, 'italic');
    expect(bold).toBeDefined();
    expect(italic).toBeDefined();
    expect(italic!.offset).toBeGreaterThanOrEqual(bold!.offset);
    expect(italic!.offset + italic!.length).toBeLessThanOrEqual(bold!.offset + bold!.length);
    expect(extractEntityText(res.text, italic!)).toBe('italic');
  });
});

describe('InlineCodeTest', () => {
  it('inline code', () => {
    const res = convert('use `print()` here');
    const code = findEntity(res.entities, 'code');
    expect(code).toBeDefined();
    expect(extractEntityText(res.text, code!)).toBe('print()');
  });
});

describe('CodeBlockTest', () => {
  it('fenced code block', () => {
    const res = convert('```python\nprint("hello")\n```');
    const pre = findEntity(res.entities, 'pre');
    expect(pre).toBeDefined();
    expect(pre!.language).toBe('python');
    expect(extractEntityText(res.text, pre!)).toContain('print("hello")');
  });

  it('code block no language', () => {
    const res = convert('```\nsome code\n```');
    const pre = findEntity(res.entities, 'pre');
    expect(pre).toBeDefined();
    expect(pre!.language).toBeUndefined();
  });
});

describe('HeadingTest', () => {
  it('h1', () => {
    const res = convert('# Title');
    expect(res.text).toContain('📌');
    expect(findEntity(res.entities, 'bold')).toBeDefined();
    expect(findEntity(res.entities, 'underline')).toBeDefined();
  });

  it('h2', () => {
    const res = convert('## Subtitle');
    expect(res.text).toContain('✏');
    expect(findEntity(res.entities, 'bold')).toBeDefined();
    expect(findEntity(res.entities, 'underline')).toBeDefined();
  });
});

describe('LinkTest', () => {
  it('inline link', () => {
    const res = convert('[Google](https://google.com)');
    const link = findEntity(res.entities, 'text_link');
    expect(link).toBeDefined();
    expect(link!.url).toBe('https://google.com');
    expect(extractEntityText(res.text, link!)).toBe('Google');
  });

  it('autolink', () => {
    const res = convert('visit https://example.com today');
    expect(res.text).toContain('https://example.com');
  });
});

describe('ImageTest', () => {
  it('image', () => {
    const res = convert('![alt](https://example.com/img.png)');
    const link = findEntity(res.entities, 'text_link');
    expect(link).toBeDefined();
    expect(link!.url).toBe('https://example.com/img.png');
  });

  it('telegram emoji', () => {
    const res = convert('![emoji](tg://emoji?id=5368324170671202286)');
    const emoji = findEntity(res.entities, 'custom_emoji');
    expect(emoji).toBeDefined();
    expect(emoji!.custom_emoji_id).toBe('5368324170671202286');
  });
});

describe('BlockquoteTest', () => {
  it('simple blockquote', () => {
    const res = convert('> quoted text');
    const bq = findEntity(res.entities, 'blockquote');
    expect(bq).toBeDefined();
    expect(extractEntityText(res.text, bq!)).toContain('quoted text');
  });
});

describe('TableTest', () => {
  it('simple table', () => {
    const res = convert('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const pre = findEntity(res.entities, 'pre');
    expect(pre).toBeDefined();
    const tableText = extractEntityText(res.text, pre!);
    expect(tableText).toContain('a');
    expect(tableText).toContain('b');
    expect(tableText).toContain('1');
    expect(tableText).toContain('2');
  });
});

describe('ListTest', () => {
  it('unordered list', () => {
    const res = convert('- item1\n- item2');
    expect(res.text).toContain('⦁ item1');
    expect(res.text).toContain('⦁ item2');
  });

  it('ordered list', () => {
    const res = convert('1. first\n2. second');
    expect(res.text).toContain('1. first');
    expect(res.text).toContain('2. second');
  });

  it('task list', () => {
    const res = convert('- [x] done\n- [ ] todo');
    expect(res.text).toContain('✅');
    expect(res.text).toContain('☐');
  });
});

describe('SpoilerTest', () => {
  it('spoiler', () => {
    const res = convert('this is ||secret|| text');
    const spoiler = findEntity(res.entities, 'spoiler');
    expect(spoiler).toBeDefined();
    expect(extractEntityText(res.text, spoiler!)).toBe('secret');
  });

  it('spoiler not in code', () => {
    const res = convert('`||not spoiler||`');
    const spoiler = findEntity(res.entities, 'spoiler');
    expect(spoiler).toBeUndefined();
  });
});

describe('Utf16OffsetTest', () => {
  it('emoji offset', () => {
    // 📌 is 2 UTF-16 code units
    const res = convert('📌 **bold**');
    const bold = findEntity(res.entities, 'bold');
    expect(bold).toBeDefined();
    // "📌 " = 2 + 1 = 3 UTF-16 code units
    expect(bold!.offset).toBe(3);
    expect(bold!.length).toBe(4);
  });

  it('cjk offset', () => {
    const res = convert('你好 **世界**');
    const bold = findEntity(res.entities, 'bold');
    expect(bold).toBeDefined();
    // "你好 " = 2 + 1 = 3 UTF-16 code units
    expect(bold!.offset).toBe(3);
    expect(bold!.length).toBe(2);
  });
});

describe('PreprocessingUtilitiesTest', () => {
  it('validateTelegramEmoji', () => {
    expect(validateTelegramEmoji('tg://emoji?id=1234567890123456789')).toBe('1234567890123456789');
    expect(validateTelegramEmoji('tg://emoji?id=123')).toBeNull();
    expect(validateTelegramEmoji('https://example.com')).toBeNull();
  });

  it('preprocessSpoilers with code blocks', () => {
    const text = '||secret|| `||not secret||`\n\n```\n||not secret||\n```\n\n~~~\n||not secret||\n~~~\n\n    ||indented code||';
    const result = preprocessSpoilers(text);
    expect(result).toBe('<tg-spoiler>secret</tg-spoiler> `||not secret||`\n\n```\n||not secret||\n```\n\n~~~\n||not secret||\n~~~\n\n    ||indented code||');
  });

  it('preprocessSpoilers keeps the open tag off a line of its own', () => {
    expect(preprocessSpoilers('||\nhidden\n||')).toBe('\n<tg-spoiler>hidden</tg-spoiler>\n');
    expect(convert('a ||\nhidden|| b').entities.map(e => e.type)).toEqual(['spoiler']);
  });
});

describe('FootnotesTest', () => {
  it('footnote references and definitions', () => {
    const res = convert('word[^1]\n\n[^1]: note');
    expect(res.text).toContain('word');
    expect(res.text).toContain('[1]');
    expect(res.text).toContain('note');
  });
});

describe('NestedBlockquoteTest', () => {
  it('nested blockquotes stack entities', () => {
    const res = convert('> level 1\n>> level 2');
    const bqs = res.entities.filter(e => e.type === 'blockquote');
    expect(bqs.length).toBeGreaterThanOrEqual(2);
    expect(bqs.some(e => extractEntityText(res.text, e).includes('level 1') && extractEntityText(res.text, e).includes('level 2'))).toBe(true);
    expect(bqs.some(e => extractEntityText(res.text, e).includes('level 2') && !extractEntityText(res.text, e).includes('level 1'))).toBe(true);
  });
});

describe('TableEdgeCasesTest', () => {
  it('uneven rows padding', () => {
    const res = convert('| a | b |\n| --- | --- |\n| 1 |');
    const pre = findEntity(res.entities, 'pre');
    expect(pre).toBeDefined();
    const tableText = extractEntityText(res.text, pre!);
    expect(tableText).toContain('a | b');
    expect(tableText).toContain('1 |');
  });
});

describe('InlineMathTest', () => {
  it('inline math becomes code entity', () => {
    const res = convert('$x^2$');
    const code = findEntity(res.entities, 'code');
    expect(code).toBeDefined();
    expect(code!.length).toBeGreaterThan(0);
  });
});

describe('DisplayMathTest', () => {
  it('display math block becomes pre entity', () => {
    const res = convert('$$E = mc^2$$');
    const pre = findEntity(res.entities, 'pre');
    expect(pre).toBeDefined();
    expect(pre!.length).toBeGreaterThan(0);
  });

  it('math fence block becomes pre entity with content', () => {
    const res = convert('```math\nE = mc^2\n```');
    const pre = findEntity(res.entities, 'pre');
    expect(pre).toBeDefined();
    expect(extractEntityText(res.text, pre!)).toContain('E');
  });
});

describe('HeadingLevelEntityTest', () => {
  it('h3 bold only, no underline or italic', () => {
    const res = convert('### Section');
    expect(res.text).toContain('📚');
    expect(findEntity(res.entities, 'bold')).toBeDefined();
    expect(findEntity(res.entities, 'underline')).toBeUndefined();
    expect(findEntity(res.entities, 'italic')).toBeUndefined();
  });

  it('h4 bold only, no underline', () => {
    const res = convert('#### Sub');
    expect(res.text).toContain('🔖');
    expect(findEntity(res.entities, 'bold')).toBeDefined();
    expect(findEntity(res.entities, 'underline')).toBeUndefined();
  });

  it('h5 italic only, no bold', () => {
    const res = convert('##### Minor');
    expect(findEntity(res.entities, 'italic')).toBeDefined();
    expect(findEntity(res.entities, 'bold')).toBeUndefined();
  });

  it('h6 italic only, no bold', () => {
    const res = convert('###### Tiny');
    expect(findEntity(res.entities, 'italic')).toBeDefined();
    expect(findEntity(res.entities, 'bold')).toBeUndefined();
  });
});

describe('SpecialLinkSchemeTest', () => {
  it('tel: link keeps its text without a text_link, which Telegram would reject', () => {
    const res = convert('[call me](tel:+123456789)');
    expect(findEntity(res.entities, 'text_link')).toBeUndefined();
    expect(res.text).toBe('call me');
  });

  it('mailto: link produces text_link entity', () => {
    const res = convert('[email me](mailto:user@example.com)');
    const link = findEntity(res.entities, 'text_link');
    expect(link).toBeDefined();
    expect(link!.url).toBe('mailto:user@example.com');
  });

  it('tg://user mention link produces text_link entity', () => {
    const res = convert('[User](tg://user?id=123456789)');
    const link = findEntity(res.entities, 'text_link');
    expect(link).toBeDefined();
    expect(link!.url).toBe('tg://user?id=123456789');
  });

  it('tg://time image produces text_link entity with full url', () => {
    const res = convert('![22:45 tomorrow](tg://time?unix=1647531900&format=wDT)');
    const link = findEntity(res.entities, 'text_link');
    expect(link).toBeDefined();
    expect(link!.url).toBe('tg://time?unix=1647531900&format=wDT');
  });
});

describe('HorizontalRuleTest', () => {
  it('horizontal rule emits the rule symbol', () => {
    const res = convert('before\n\n---\n\nafter');
    expect(res.text).toContain('————————');
  });
});

describe('AltBoldSyntaxTest', () => {
  it('__bold__ produces bold entity identical to **bold**', () => {
    const res = convert('__hello__');
    const bold = findEntity(res.entities, 'bold');
    expect(bold).toBeDefined();
    expect(extractEntityText(res.text, bold!)).toBe('hello');
  });
});

describe('NestedListTest', () => {
  it('nested unordered list items all appear in text', () => {
    const res = convert('- parent\n  - child');
    expect(res.text).toContain('parent');
    expect(res.text).toContain('child');
    expect(res.text).toContain('⦁');
  });

  it('nested ordered list numbers each level independently', () => {
    const res = convert('1. first\n   1. nested first\n   2. nested second\n2. second');
    expect(res.text).toContain('1. first');
    expect(res.text).toContain('1. nested first');
    expect(res.text).toContain('2. nested second');
    expect(res.text).toContain('2. second');
  });
});

describe('ExpandableBlockquoteConverterTest', () => {
  it('blockquote longer than 200 chars becomes expandable_blockquote', () => {
    const longText = 'a'.repeat(201);
    const res = convert(`> ${longText}`);
    expect(findEntity(res.entities, 'expandable_blockquote')).toBeDefined();
  });

  it('short blockquote stays as blockquote', () => {
    const res = convert('> short quote');
    expect(findEntity(res.entities, 'blockquote')).toBeDefined();
    expect(findEntity(res.entities, 'expandable_blockquote')).toBeUndefined();
  });
});

describe('Upstream 1.3-1.4 parity', () => {
  it('keeps the blank line between blocks after non-ASCII text', () => {
    // Ranges are UTF-8 byte offsets; reading them as string indices lost the gap
    expect(convert('Привет мир 😀\n\nsecond').text).toBe('Привет мир 😀\n\nsecond');
    expect(convert('Привет мир 😀\nsecond').text).toBe('Привет мир 😀\nsecond');
  });

  it('keeps the blank line after a list', () => {
    expect(convert('- a\n- b\n\nafter').text).toBe('⦁ a\n⦁ b\n\nafter');
  });

  it('reads $ followed by a digit as prices, not math', () => {
    const res = convert('$10.49, with tax (**~$11.20**)');
    expect(res.text).toBe('$10.49, with tax (~$11.20)');
    expect(res.entities.map(e => e.type)).toEqual(['bold']);
  });

  it('requires ~~ for strikethrough', () => {
    const res = convert('~700 JPY (**~$4.50**)');
    expect(res.text).toBe('~700 JPY (~$4.50)');
    expect(res.entities.map(e => e.type)).toEqual(['bold']);
    expect(convert('~~gone~~').entities[0].type).toBe('strikethrough');
  });

  it('still renders real inline math', () => {
    const res = convert('area $x^2$ ok');
    expect(res.entities.map(e => e.type)).toEqual(['code']);
  });

  it('keeps an image symbol inside its table cell', () => {
    const res = convert('| a | b |\n|---|---|\n| ![x](https://e.com/i.png) | y |');
    expect(res.text.startsWith('a')).toBe(true);
    expect(res.entities).toEqual([{ type: 'pre', offset: 0, length: res.text.length }]);
  });

  it('uses configurable list markers', async () => {
    const { RenderConfig } = await import('../src/config.js');
    const cfg = RenderConfig.isolated();
    cfg.markdownSymbol.unorderedListItem = '-';
    cfg.markdownSymbol.orderedListSuffix = ')';
    expect(convert('- a\n\n1. b', { config: cfg }).text).toBe('- a\n\n1) b\n');
    // the global config is untouched
    expect(convert('- a').text).toBe('⦁ a\n');
  });

  it('copies a config independently', async () => {
    const { RenderConfig } = await import('../src/config.js');
    const a = RenderConfig.isolated();
    a.markdownSymbol.headingLevel1 = '#';
    a.citeExpandable = false;
    const b = a.copy();
    b.markdownSymbol.headingLevel1 = '!';
    expect(a.markdownSymbol.headingLevel1).toBe('#');
    expect(b.citeExpandable).toBe(false);
  });
});

describe('InlineHtmlEntitiesTest', () => {
  it('maps bare formatting tags to entities', () => {
    const res = convert('a <u>under</u> <ins>line</ins> <b>b</b> <s>s</s>');
    expect(res.text).toBe('a under line b s');
    expect(res.entities.map(e => e.type)).toEqual(['underline', 'underline', 'bold', 'strikethrough']);
  });
});
