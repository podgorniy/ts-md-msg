import { describe, it, expect } from 'vitest';
import { processMarkdown } from '../src/pipeline.js';
import { ContentType, Text, File, Photo } from '../src/content.js';

describe('ProcessMarkdownTest', () => {
  it('simple text', async () => {
    const results = await processMarkdown('Hello **world**');
    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe(ContentType.TEXT);
    const textRes = results[0] as Text;
    expect(textRes.text).toContain('world');
    expect(textRes.entities.some((e) => e.type === 'bold')).toBe(true);
  });

  it('code block extracted as file', async () => {
    const md = "Some text\n\n```python\nprint('hello')\n```\n\nMore text";
    const results = await processMarkdown(md);
    const hasFile = results.some((r) => r.contentType === ContentType.FILE);
    expect(hasFile).toBe(true);
    const fileResult = results.find((r) => r.contentType === ContentType.FILE) as File;
    expect(fileResult.fileName).toContain('py');
    const decoder = new TextDecoder('utf-8');
    expect(decoder.decode(fileResult.fileData)).toContain("print('hello')");
  });

  it('code block as text', async () => {
    const md = "Some text\n\n```python\nprint('hello')\n```\n\nMore text";
    const results = await processMarkdown(md, { minFileLines: 0 });
    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe(ContentType.TEXT);
    const textRes = results[0] as Text;
    expect(textRes.text).toContain("print('hello')");
    expect(textRes.entities.length).toBe(1);
    expect(textRes.entities[0].type).toBe('pre');
    expect(textRes.entities[0].language).toBe('python');
  });

  it('code block min lines', async () => {
    const md = "Some text\n\n```python\nprint('line1')\nprint('line2')\n```\n\nMore text";
    const results = await processMarkdown(md, { minFileLines: 3 });
    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe(ContentType.TEXT);
    const textRes = results[0] as Text;
    expect(textRes.entities.length).toBe(1);
    expect(textRes.entities[0].type).toBe('pre');
    expect(textRes.entities[0].language).toBe('python');
  });

  it('text around code block', async () => {
    const md = 'Before\n\n```python\ncode\n```\n\nAfter';
    const results = await processMarkdown(md);
    const textResults = results.filter((r) => r.contentType === ContentType.TEXT) as Text[];
    const allText = textResults.map((t) => t.text).join(' ');
    expect(allText).toContain('Before');
    expect(allText).toContain('After');
  });

  it('splitting long text', async () => {
    const md = Array.from({ length: 100 }, (_, i) => `Paragraph ${i} with some content.`).join('\n\n');
    const results = await processMarkdown(md, { maxMessageLength: 200 });
    const textResults = results.filter((r) => r.contentType === ContentType.TEXT) as Text[];
    expect(textResults.length).toBeGreaterThan(1);
    const combined = textResults.map((t) => t.text).join(' ');
    expect(combined).toContain('Paragraph 0');
    expect(combined).toContain('Paragraph 99');
  });

  it('empty input', async () => {
    const results = await processMarkdown('');
    expect(results.length).toBe(0);
  });

  it('only code block', async () => {
    const md = "```python\nprint('hello')\n```";
    const results = await processMarkdown(md);
    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe(ContentType.FILE);
  });

  it('multiple code blocks', async () => {
    const md = 'text\n\n```python\na=1\n```\n\nmiddle\n\n```js\nb=2\n```\n\nend';
    const results = await processMarkdown(md);
    const files = results.filter((r) => r.contentType === ContentType.FILE);
    const texts = results.filter((r) => r.contentType === ContentType.TEXT);
    expect(files.length).toBe(2);
    expect(texts.length).toBeGreaterThanOrEqual(1);
  });

  it('content ordering', async () => {
    const md = 'first\n\n```python\ncode\n```\n\nlast';
    const results = await processMarkdown(md);
    // Order should be: Text("first"), File, Text("last")
    expect(results[0].contentType).toBe(ContentType.TEXT);
    expect((results[0] as Text).text).toContain('first');
    expect(results[1].contentType).toBe(ContentType.FILE);
    expect(results[2].contentType).toBe(ContentType.TEXT);
    expect((results[2] as Text).text).toContain('last');
  });
});
