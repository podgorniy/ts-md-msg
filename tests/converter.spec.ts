import { describe, it, expect } from 'vitest';
import { convert } from '../src/converter.js';
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
    expect(res.text).toContain('☑');
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
