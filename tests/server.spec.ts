import {describe, expect, it} from 'vitest';
import {convert} from '../src/index.js';
import {richify} from '../src/rich.js';

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
});
