import { describe, it, expect } from 'vitest';
import { telegramify, convert, markdownify } from '../src/index.js';
import { ContentType, Text, File, Photo } from '../src/content.js';

describe('telegramify basic', () => {
  it('converts basic markdown to text', async () => {
    const res = await telegramify('Hello **World**');
    expect(res.length).toBe(1);
    expect(res[0].contentType).toBe(ContentType.TEXT);
    const textObj = res[0] as Text;
    expect(textObj.text).toBe('Hello World');
    expect(textObj.entities.length).toBe(1);
    expect(textObj.entities[0].type).toBe('bold');
  });

  it('handles code blocks and converts to file', async () => {
    const md = '```python\nprint("Hello")\n```';
    const res = await telegramify(md);
    console.log(res);
    expect(res.length).toBe(1);
    expect(res[0].contentType).toBe(ContentType.FILE);
    const fileObj = res[0] as File;
    expect(fileObj.fileName).toBe('readable.py');
    expect(new TextDecoder().decode(fileObj.fileData)).toBe('print("Hello")');
  });
});

describe('convert', () => {
  it('returns text and entities', () => {
    const res = convert('Hello _World_');
    expect(res.text).toBe('Hello World');
    expect(res.entities.length).toBe(1);
    expect(res.entities[0].type).toBe('italic');
  });
});

describe('markdownify', () => {
  it('escapes standard markdown characters', () => {
    const res = markdownify('Hello * World');
    expect(res).toBe('Hello \\* World');
  });

  it('converts formatting properly back to mdv2', () => {
    const res = markdownify('Hello **World**');
    expect(res).toBe('Hello *World*');
  });
});
