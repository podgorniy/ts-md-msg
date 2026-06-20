import { describe, it, expect } from 'vitest';
import { processMarkdown, telegramify, markdownify } from '../src/pipeline.js';
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

describe('ApiWrappersTest', () => {
  it('telegramify wrapper', async () => {
    const results = await telegramify('**test**');
    expect(results.length).toBe(1);
    expect((results[0] as Text).text).toBe('test');
    expect((results[0] as Text).entities[0].type).toBe('bold');
  });

  it('markdownify wrapper', () => {
    const mdv2 = markdownify('**test**');
    expect(mdv2).toBe('*test*');
  });
});

describe('StripNewlinesAdjustEdgeTest', () => {
  it('entities starting exactly on boundary of stripped newlines', async () => {
    const md = '\n'.repeat(10) + '**hello**' + '\n'.repeat(10);
    const results = await processMarkdown(md);
    expect(results.length).toBe(1);
    const textRes = results[0] as Text;
    expect(textRes.text).toBe('hello');
    expect(textRes.entities.length).toBe(1);
    expect(textRes.entities[0].offset).toBe(0);
    expect(textRes.entities[0].length).toBe(5);
  });
});

describe('MermaidHandlingTest', () => {
  it('mermaid block becomes mermaid.txt file when renderMermaid is true', async () => {
    const md = '```mermaid\ngraph LR\nA --> B\n```';
    const results = await processMarkdown(md, { renderMermaid: true });
    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe(ContentType.FILE);
    const file = results[0] as File;
    expect(file.fileName).toBe('mermaid.txt');
    const decoder = new TextDecoder();
    expect(decoder.decode(file.fileData)).toContain('graph LR');
  });

  it('mermaid block stays as text with pre entity when renderMermaid is false', async () => {
    const md = '```mermaid\ngraph LR\nA --> B\n```';
    const results = await processMarkdown(md, { renderMermaid: false });
    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe(ContentType.TEXT);
    const textRes = results[0] as Text;
    expect(textRes.entities.some(e => e.type === 'pre')).toBe(true);
  });
});

describe('CodeFileNamingTest', () => {
  it('code block without language gets txt extension', async () => {
    const md = '```\nsome code\n```';
    const results = await processMarkdown(md, { minFileLines: 1 });
    expect(results[0].contentType).toBe(ContentType.FILE);
    expect((results[0] as File).fileName).toBe('readable.txt');
  });

  it('rust code block gets rs extension', async () => {
    const md = '```rust\nfn main() {}\n```';
    const results = await processMarkdown(md, { minFileLines: 1 });
    expect(results[0].contentType).toBe(ContentType.FILE);
    expect((results[0] as File).fileName).toContain('.rs');
  });

  it('json code block gets json extension', async () => {
    const md = '```json\n{"key": "value"}\n```';
    const results = await processMarkdown(md, { minFileLines: 1 });
    expect(results[0].contentType).toBe(ContentType.FILE);
    expect((results[0] as File).fileName).toContain('.json');
  });

  it('unknown language falls back to txt extension', async () => {
    const md = '```brainfuck\n++++\n```';
    const results = await processMarkdown(md, { minFileLines: 1 });
    expect(results[0].contentType).toBe(ContentType.FILE);
    expect((results[0] as File).fileName).toContain('.txt');
  });
});

describe('IntegrationExcessiveEntityCountTest', () => {
  it('handles thousands of entities without crashing and preserves counts', async () => {
    const words = [];
    for (let i = 0; i < 5000; i++) {
      words.push(`**bold${i}**`);
    }
    const md = words.join(' ');
    
    // Default maxMessageLength is 4096. 5000 entities will exceed it.
    const results = await processMarkdown(md, { maxMessageLength: 4096 });
    expect(results.length).toBeGreaterThan(1);
    
    let entityCount = 0;
    for (const res of results) {
      if (res.contentType === ContentType.TEXT) {
        entityCount += (res as Text).entities.length;
      }
    }
    // Hard splits may duplicate an entity spanning the boundary
    expect(entityCount).toBeGreaterThanOrEqual(5000);
    expect(entityCount).toBeLessThan(5050);
  });
});
