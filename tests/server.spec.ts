import {describe, expect, it} from 'vitest';
import {convert} from '../src/index.js';
import {telegramify} from '../src/pipeline.js';
import {richify, telegramifyRich} from '../src/rich.js';

const BOT_TOKEN = '8626125265:AAHjyt_j4-05kA30sgiu4w1L2uAkuagUOTQ';
const CHAT_ID = 301347024;

describe('ServerIntegrationTest', () => {
  it('convert API format validation', async () => {
    if (!BOT_TOKEN) {
      console.warn('Skipping test: No TELEGRAM_BOT_TOKEN found');
      return;
    }

    const markdown = `# Title
**Bold** and *italic*
[Link](https://example.com)
\`\`\`python
print("Hello")
\`\`\`
`;
    const { text, entities } = convert(markdown);

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: text,
        entities: entities
      })
    });
    
    const data = await res.json();
    if (!data.ok) {
      // If it fails (e.g. invalid chat ID or bot), ensure it's not a parsing error
      expect(data.description).not.toContain('can\'t parse entities');
    } else {
      // If it succeeds, that means the payload format was accepted by Telegram
      expect(data.ok).toBe(true);
    }
  });

  it('richify API HTML validation', async () => {
    if (!BOT_TOKEN) {
      console.warn('Skipping test: No TELEGRAM_BOT_TOKEN found');
      return;
    }

    const markdown = `# Title
**Bold** and *italic*
[Link](https://example.com)
\`\`\`python
print("Hello")
\`\`\`
`;
    const rich = richify(markdown);

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        rich_message: {
          html: rich.html,
          is_rtl: rich.isRtl,
          skip_entity_detection: rich.skipEntityDetection
        }
      })
    });

    const data = await res.json();
    if (!data.ok) {
      // If it fails, make sure it's not complaining about parsing or something
      expect(data.description).not.toContain('can\'t parse entities');
      expect(data.description).not.toContain('Unsupported start tag');
    }
  });

  it('splits and sends extremely long rich document', async () => {
    if (!BOT_TOKEN) {
      console.warn('Skipping test: No TELEGRAM_BOT_TOKEN found');
      return;
    }

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
    const markdown = mdParts.join('\n\n');
    
    // Use the pipeline wrapper to split
    const chunks = telegramifyRich(markdown);
    expect(chunks.length).toBeGreaterThan(1);
    
    for (const [index, chunk] of chunks.entries()) {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendRichMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          rich_message: {
            html: chunk.html,
            is_rtl: chunk.isRtl,
            skip_entity_detection: chunk.skipEntityDetection
          }
        })
      });

      const data = await res.json();
      if (!data.ok) {
        console.error(`Failed to send chunk ${index}:`, data);
        expect(data.ok).toBe(true);
      }
    }
  });

  it('splits and sends message with excessive entities', async () => {
    if (!BOT_TOKEN) {
      console.warn('Skipping test: No TELEGRAM_BOT_TOKEN found');
      return;
    }

    const words = [];
    for (let i = 0; i < 5000; i++) {
      words.push(`**bold${i}**`);
    }
    const markdown = words.join(' ');
    
    // Use the standard pipeline wrapper to split
    const chunks = await telegramify(markdown, { maxMessageLength: 4096 });
    expect(chunks.length).toBeGreaterThan(1);
    
    for (const [index, chunk] of chunks.entries()) {
      if (chunk.contentType !== 'text') continue;
      
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: chunk.text,
          entities: chunk.entities
        })
      });

      const data = await res.json();
      if (!data.ok) {
        console.error(`Failed to send entity chunk ${index}:`, data);
        expect(data.ok).toBe(true);
      }
    }
  }, 20000); // Give it extra time in case of rate limits
});
