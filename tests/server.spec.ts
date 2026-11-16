import {describe, expect, it} from 'vitest';
import {convert} from '../src/index.js';
import {telegramify} from '../src/pipeline.js';
import {InputRichMessage, richify, telegramifyRich} from '../src/rich.js';

// Live tests against the real Bot API. They run only when TELEGRAM_BOT_TOKEN
// and TELEGRAM_CHAT_ID are set, in the environment or in .env.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function call(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: CHAT_ID, disable_notification: true, ...body}),
  });
  return res.json();
}

/** Send, assert Telegram accepted it, delete it again, and return the sent Message. */
async function sendAndDelete(method: string, body: Record<string, unknown>): Promise<any> {
  const data = await call(method, body);
  if (!data.ok) console.error(`${method} rejected:`, data, body);
  expect(data.ok).toBe(true);
  await call('deleteMessage', {message_id: data.result.message_id});
  return data.result;
}

const sendRich = (richMessage: InputRichMessage) => sendAndDelete('sendRichMessage', {rich_message: richMessage});

describe.skipIf(!BOT_TOKEN || !CHAT_ID)('ServerIntegrationTest', () => {
  it('convert API format validation', async () => {
    const markdown = `# Title
**Bold** and *italic* and <u>underline</u>
[Link](https://example.com)
\`\`\`python
print("Hello")
\`\`\`
`;
    const {text, entities} = convert(markdown);
    await sendAndDelete('sendMessage', {text, entities});
  });

  it('richify API HTML validation', async () => {
    const markdown = `# Title
**Bold** and *italic*, H<sub>2</sub>O, x<sup>2</sup>, <mark>marked</mark>
[Link](https://example.com)
\`\`\`python
print("Hello")
\`\`\`
`;
    await sendRich(richify(markdown, {skipEntityDetection: true}));
  });

  it('task lists become native checkboxes', async () => {
    const message = await sendRich(richify('- [x] done\n- [ ] todo'));
    const items = message.rich_message.blocks[0].items;
    expect(items.map((item: any) => [item.has_checkbox, item.is_checked ?? false])).toEqual([[true, true], [true, false]]);
  });

  it('footnotes become references', async () => {
    await sendRich(richify('Text with a ref[^n1].\n\n[^n1]: Definition with *italic*.'));
  });

  it('media blocks with captions are accepted', async () => {
    const message = await sendRich(richify(
      'Before ![logo](https://telegram.org/img/t_logo.png "Telegram logo") after\n\n- ![](https://telegram.org/img/t_logo.png)'
    ));
    const types = message.rich_message.blocks.map((block: any) => block.type);
    expect(types).toContain('photo');
  });

  it('splits and sends extremely long rich document', async () => {
    const mdParts = [];
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
    const chunks = telegramifyRich(mdParts.join('\n\n'));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) await sendRich(chunk);
  }, 60000);

  it('a list longer than the block limit is split into accepted parts', async () => {
    const items = Array.from({length: 700}, (_, i) => `${i + 1}. item ${i}`).join('\n');
    const chunks = telegramifyRich(items);
    expect(chunks.length).toBe(2);
    for (const chunk of chunks) await sendRich(chunk);
  }, 30000);

  it('splits and sends message with excessive entities', async () => {
    const words = [];
    for (let i = 0; i < 5000; i++) {
      words.push(`**bold${i}**`);
    }
    const chunks = await telegramify(words.join(' '), {maxMessageLength: 4096});
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      if (chunk.contentType !== 'text') continue;
      await sendAndDelete('sendMessage', {text: chunk.text, entities: chunk.entities});
    }
  }, 60000);
});
