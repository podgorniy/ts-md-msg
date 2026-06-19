import { describe, it, expect } from 'vitest';
import { splitEntities, MessageEntity, utf16Len } from '../src/entity.js';

describe('SplitEntitiesTest', () => {
  it('no split needed', () => {
    const text = 'hello';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 0, length: 5 }];
    const result = splitEntities(text, entities, 100);
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('hello');
    expect(result[0].entities.length).toBe(1);
  });

  it('empty text', () => {
    const result = splitEntities('', [], 100);
    expect(result.length).toBe(0);
  });

  it('whitespace only text is omitted without splitting', () => {
    const result = splitEntities('\n\n', [], 100);
    expect(result.length).toBe(0);
  });

  it('whitespace only chunks are omitted after splitting', () => {
    const result = splitEntities('\n'.repeat(5000), [], 4096);
    expect(result.length).toBe(0);
  });

  it('omits whitespace only chunk but keeps content chunk', () => {
    const text = '\n'.repeat(5000) + 'hello';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 5000, length: 5 }];
    const result = splitEntities(text, entities, 4096);
    expect(result).toEqual([
      {
        text: '\n'.repeat(904) + 'hello',
        entities: [{ type: 'bold', offset: 904, length: 5 }],
      },
    ]);
  });

  it('split at newline', () => {
    const text = 'aaa\nbbb\nccc';
    const result = splitEntities(text, [], 5);
    // "aaa\n" = 4 code units, "bbb\n" = 4, "ccc" = 3
    expect(result.length).toBeGreaterThanOrEqual(2);
    const combined = result.map((c) => c.text).join('');
    expect(combined).toBe(text);
  });

  it('entity fully in first chunk', () => {
    const text = 'bold\nnormal';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 0, length: 4 }];
    const result = splitEntities(text, entities, 5);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First chunk should have the bold entity
    expect(result[0].entities.length).toBe(1);
    expect(result[0].entities[0].type).toBe('bold');
  });

  it('entity fully in second chunk', () => {
    const text = 'normal\nbold';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 7, length: 4 }];
    const result = splitEntities(text, entities, 7);
    // Second chunk should have the entity with adjusted offset
    let found = false;
    for (const chunk of result) {
      for (const e of chunk.entities) {
        if (e.type === 'bold') {
          expect(e.offset).toBe(0);
          expect(e.length).toBe(4);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('entity spans split boundary', () => {
    const text = 'aabbcc\nddee';
    const entities: MessageEntity[] = [{ type: 'bold', offset: 0, length: utf16Len(text) }];
    const result = splitEntities(text, entities, 7);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Both chunks should have a bold entity
    for (const chunk of result) {
      expect(chunk.entities.some((e) => e.type === 'bold')).toBe(true);
    }
  });

  it('split preserves date time fields', () => {
    const text = 'time\nlater';
    const entities: MessageEntity[] = [
      {
        type: 'date_time',
        offset: 0,
        length: 4,
        unix_time: 1647531900,
        date_time_format: 'wDT',
      },
    ];
    const result = splitEntities(text, entities, 5);
    expect(result[0].entities[0].unix_time).toBe(1647531900);
    expect(result[0].entities[0].date_time_format).toBe('wDT');
  });

  it('split preserves total text', () => {
    const text = 'line1\nline2\nline3\nline4\nline5';
    const entities: MessageEntity[] = [{ type: 'italic', offset: 0, length: 5 }];
    const result = splitEntities(text, entities, 12);
    const combined = result.map((c) => c.text).join('');
    expect(combined).toBe(text);
  });

  it('split with emoji', () => {
    // 📌 = 2 UTF-16 code units
    const text = '📌\n📌\n📌';
    const result = splitEntities(text, [], 4);
    const combined = result.map((c) => c.text).join('');
    expect(combined).toBe(text);
  });

  it('hard split no newlines', () => {
    const text = 'abcdefghij';
    const result = splitEntities(text, [], 4);
    const combined = result.map((c) => c.text).join('');
    expect(combined).toBe(text);
    for (const chunk of result) {
      expect(utf16Len(chunk.text)).toBeLessThanOrEqual(4);
    }
  });
});
