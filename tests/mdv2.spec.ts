import { describe, it, expect } from 'vitest';
import { entitiesToMarkdownV2 } from '../src/mdv2.js';
import { MessageEntity } from '../src/types.js';

describe('BoldTest', () => {
  it('bold', () => {
    const text = 'hello world';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 0, length: 5 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('*hello* world');
  });

  it('bold middle', () => {
    const text = 'say hello please';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 4, length: 5 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('say *hello* please');
  });
});

describe('ItalicTest', () => {
  it('italic', () => {
    const text = 'hello world';
    const entities: MessageEntity[] = [{ type: 'italic', offset: 0, length: 5 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('_hello_ world');
  });
});

describe('UnderlineTest', () => {
  it('underline', () => {
    const text = 'hello';
    const entities: MessageEntity[] = [{ type: 'underline', offset: 0, length: 5 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('__hello__');
  });
});

describe('StrikethroughTest', () => {
  it('strikethrough', () => {
    const text = 'deleted';
    const entities: MessageEntity[] = [{ type: 'strikethrough', offset: 0, length: 7 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('~deleted~');
  });
});

describe('SpoilerTest', () => {
  it('spoiler', () => {
    const text = 'secret';
    const entities: MessageEntity[] = [{ type: 'spoiler', offset: 0, length: 6 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('||secret||');
  });
});

describe('CodeTest', () => {
  it('code', () => {
    const text = 'use print()';
    const entities: MessageEntity[] = [{ type: 'code', offset: 4, length: 7 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('use `print()`');
  });

  it('code with backtick', () => {
    const text = 'a`b';
    const entities: MessageEntity[] = [{ type: 'code', offset: 0, length: 3 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('`a\\`b`');
  });

  it('code special chars not escaped', () => {
    const text = 'a*b_c';
    const entities: MessageEntity[] = [{ type: 'code', offset: 0, length: 5 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('`a*b_c`');
  });
});

describe('PreTest', () => {
  it('pre no lang', () => {
    const text = 'line1\nline2';
    const entities: MessageEntity[] = [{ type: 'pre', offset: 0, length: 11 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('```\nline1\nline2\n```');
  });

  it('pre with lang', () => {
    const text = 'print(1)';
    const entities: MessageEntity[] = [{ type: 'pre', offset: 0, length: 8, language: 'python' }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('```python\nprint(1)\n```');
  });

  it('adjacent pre blocks do not gain blank line', () => {
    const text = 'a\n\nb';
    const entities: MessageEntity[] = [
      { type: 'pre', offset: 0, length: 1, language: 'py' },
      { type: 'pre', offset: 3, length: 1, language: 'py' },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('```py\na\n```\n```py\nb\n```');
  });
});

describe('TextLinkTest', () => {
  it('text link', () => {
    const text = 'click here';
    const entities: MessageEntity[] = [
      { type: 'text_link', offset: 0, length: 10, url: 'https://example.com' },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('[click here](https://example.com)');
  });

  it('text link url with paren', () => {
    const text = 'link';
    const entities: MessageEntity[] = [
      { type: 'text_link', offset: 0, length: 4, url: 'https://a.com/b(c)' },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('[link](https://a.com/b(c\\))');
  });
});

describe('CustomEmojiTest', () => {
  it('custom emoji', () => {
    const text = '😀';
    const entities: MessageEntity[] = [
      { type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '12345' },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('![😀](tg://emoji?id=12345)');
  });
});

describe('DateTimeTest', () => {
  it('date time', () => {
    const text = '22:45 tomorrow';
    const entities: MessageEntity[] = [
      {
        type: 'date_time',
        offset: 0,
        length: text.length,
        unix_time: 1647531900,
        date_time_format: 'wDT',
      },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('![22:45 tomorrow](tg://time?unix=1647531900&format=wDT)');
  });
});

describe('BlockquoteTest', () => {
  it('blockquote single line', () => {
    const text = 'quoted text';
    const entities: MessageEntity[] = [{ type: 'blockquote', offset: 0, length: 11 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('>quoted text');
  });

  it('blockquote multi line', () => {
    const text = 'line1\nline2\nline3';
    const entities: MessageEntity[] = [{ type: 'blockquote', offset: 0, length: text.length }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('>line1\n>line2\n>line3');
  });
});

describe('ExpandableBlockquoteTest', () => {
  it('expandable blockquote', () => {
    const text = 'summary\ndetails';
    const entities: MessageEntity[] = [{ type: 'expandable_blockquote', offset: 0, length: text.length }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('**>summary\n>details||');
  });

  it('expandable blockquote with same range bold', () => {
    const text = 'line1\nline2';
    const entities: MessageEntity[] = [
      { type: 'bold', offset: 0, length: text.length },
      { type: 'expandable_blockquote', offset: 0, length: text.length },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('**>*line1\n>line2*||');
  });
});

describe('NestedEntityTest', () => {
  it('nested bold italic', () => {
    const text = 'bold italic end';
    const entities: MessageEntity[] = [
      { type: 'bold', offset: 0, length: 15 },
      { type: 'italic', offset: 5, length: 6 },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('*bold _italic_ end*');
  });

  it('nested italic in bold', () => {
    const text = 'abcdefghij';
    const entities: MessageEntity[] = [
      { type: 'bold', offset: 0, length: 10 },
      { type: 'italic', offset: 3, length: 4 },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('*abc_defg_hij*');
  });
});

describe('AdjacentEntityTest', () => {
  it('adjacent entities', () => {
    const text = 'bolditalic';
    const entities: MessageEntity[] = [
      { type: 'bold', offset: 0, length: 4 },
      { type: 'italic', offset: 4, length: 6 },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('*bold*_italic_');
  });
});

describe('EmojiUtf16Test', () => {
  it('emoji utf16 offset', () => {
    // 📌 = 2 UTF-16 code units
    const text = '📌bold';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 2, length: 4 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('📌*bold*');
  });

  it('emoji before and after', () => {
    const text = '📌hello📌';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 2, length: 5 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('📌*hello*📌');
  });
});

describe('NoEntitiesTest', () => {
  it('no entities', () => {
    const text = 'hello *world*';
    const result = entitiesToMarkdownV2(text, []);
    expect(result).toBe('hello \\*world\\*');
  });

  it('undefined entities', () => {
    const text = 'hello';
    const result = entitiesToMarkdownV2(text, undefined);
    expect(result).toBe('hello');
  });
});

import { splitMarkdownV2 } from '../src/mdv2.js';

describe('SplitMarkdownV2Test', () => {
  it('split respects rendered limit after escaping', () => {
    const text = 'a.b! '.repeat(30).trim();
    const chunks = splitMarkdownV2(text, [], 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
    expect(chunks.join('')).toBe(entitiesToMarkdownV2(text, []));
  });
});

describe('EmptyTextTest', () => {
  it('empty text', () => {
    const result = entitiesToMarkdownV2('', []);
    expect(result).toBe('');
  });

  it('empty text undefined entities', () => {
    const result = entitiesToMarkdownV2('', undefined);
    expect(result).toBe('');
  });
});

import { convert } from '../src/converter.js';

describe('RoundtripTest', () => {
  it('roundtrip basic', () => {
    const { text, entities } = convert('**bold** and _italic_');
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toContain('*');
    expect(result).toContain('_');
  });

  it('roundtrip code', () => {
    const { text, entities } = convert('use `print()` function');
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toContain('`');
  });

  it('roundtrip link', () => {
    const { text, entities } = convert('[click](https://example.com)');
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toContain('[');
    expect(result).toContain('https://example.com');
  });
});

describe('SpecialCharInEntityTest', () => {
  it('bold with special chars', () => {
    const text = 'a.b';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 0, length: 3 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('*a\\.b*');
  });
});

describe('PreBeforeBlockquoteTest', () => {
  it('pre before blockquote', () => {
    const text = 'code\nquoted';
    const entities: MessageEntity[] = [
      { type: 'pre', offset: 0, length: 4 },
      { type: 'blockquote', offset: 5, length: 6 },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toContain('>quoted');
    expect(result).not.toContain('>code');
  });

  it('pre inside blockquote', () => {
    const text = 'quoted code here';
    const entities: MessageEntity[] = [
      { type: 'blockquote', offset: 0, length: 16 },
      { type: 'pre', offset: 7, length: 4 },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    for (const line of result.split('\n')) {
      expect(line.startsWith('>')).toBe(true);
    }
  });

  it('blockquote not at start', () => {
    const text = 'normal\nquoted';
    const entities: MessageEntity[] = [{ type: 'blockquote', offset: 7, length: 6 }];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toBe('normal\n>quoted');
  });

  it('multiple pre before blockquote', () => {
    const text = 'a\nb\nquoted';
    const entities: MessageEntity[] = [
      { type: 'pre', offset: 0, length: 1 },
      { type: 'pre', offset: 2, length: 1 },
      { type: 'blockquote', offset: 4, length: 6 },
    ];
    const result = entitiesToMarkdownV2(text, entities);
    expect(result).toContain('>quoted');
  });
});
