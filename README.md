# tg-md-msg

Convert Markdown to Telegram-compatible messages. A TypeScript port of [telegramify-markdown](https://github.com/sudoskys/telegramify-markdown) (Python).

Tracks upstream telegramify-markdown 1.4.2 and Telegram Bot API 10.4.

> **Note:** Mermaid diagram rendering is not currently supported. Mermaid code blocks fall back to plain `.txt` file uploads.

---

## Installation

Install directly from GitHub:

```bash
npm install github:podgorniy/ts-md-msg
```

This library uses a Rust native module ([pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark) via N-API) for fast, accurate Markdown parsing. A `postinstall` script automatically downloads the correct pre-compiled binary from [GitHub Releases](https://github.com/podgorniy/ts-md-msg/releases) for your platform:

| Platform | Target triple |
|---|---|
| macOS Intel | `x86_64-apple-darwin` |
| macOS Apple Silicon | `aarch64-apple-darwin` |
| Windows 64-bit | `x86_64-pc-windows-msvc` |
| Linux GNU x86_64 | `x86_64-unknown-linux-gnu` |
| Linux GNU ARM64 | `aarch64-unknown-linux-gnu` |
| Linux musl x86_64 | `x86_64-unknown-linux-musl` |
| Linux musl ARM64 | `aarch64-unknown-linux-musl` |

**Cloning the repository directly** (e.g. for development or an unsupported platform): the postinstall download will be skipped if no matching release binary exists, so you must build the native module yourself — see [Building from source](#building-from-source).

---

## Background: Telegram formatting options

Telegram's `sendMessage` supports three approaches to text formatting:

| Approach | How | Notes |
|---|---|---|
| `parse_mode: 'HTML'` | Subset of HTML tags in the text | Tags must be valid; limited set |
| `parse_mode: 'MarkdownV2'` | Markdown dialect with ~20 mandatory escape characters | Fragile; easy to produce invalid strings |
| `entities` parameter | Plain text + structured `MessageEntity[]` array | Most reliable; no escaping needed |

The `entities` approach is the recommended integration point for this library — pass the raw text and the entity array directly to Telegram without any `parse_mode`.

**Limits:**
- `sendMessage` text: **4096 UTF-16 code units**
- `sendDocument` / media captions: **1024 UTF-16 code units**
- `sendRichMessage` (Bot API 10.1+): **32,768 characters** of text, **500 blocks** (nested blocks, list items and table rows included), **50 media**, 16 nesting levels and 20 table columns per message. This library budgets the HTML markup's UTF-8 bytes against the character limit, which is a safe upper bound.

---

## Quick start

```typescript
import { convert } from 'tg-md-msg';

const { text, entities } = convert('**Hello** `world`');
await bot.sendMessage(chatId, text, { entities });
```

For LLM output that may exceed the 4096-character limit:

```typescript
import { telegramify, ContentType } from 'tg-md-msg';

const items = await telegramify(llmMarkdownOutput);
for (const item of items) {
  if (item.contentType === ContentType.TEXT) {
    await bot.sendMessage(chatId, item.text, { entities: item.entities });
  } else if (item.contentType === ContentType.FILE) {
    await bot.sendDocument(chatId, Buffer.from(item.fileData), {}, { filename: item.fileName });
  }
}
```

---

## Which function should I use?

| I want to… | Use |
|---|---|
| Send formatted text via `sendMessage` (single message, not too long) | [`convert()`](#convert) |
| Send LLM output that might exceed 4096 chars, including code files | [`telegramify()`](#telegramify) |
| My bot framework requires a `parse_mode="MarkdownV2"` string | [`markdownify()`](#markdownify) |
| Use `sendRichMessage` for structured, document-like content | [`richify()`](#richify) / [`telegramifyRich()`](#telegramifyrich) |
| Split an `InputRichMessage` I already built | [`splitRich()`](#splitrich) |
| Stream LLM output while it is generated (`sendMessageDraft` / `sendRichMessageDraft` / edits) | [`DraftStream` / `EditStream`](#streaming) |

---

## API

All functions accept valid Markdown strings as input.

### `convert`

```typescript
function convert(
  markdown: string,
  options?: { latexEscape?: boolean; config?: RenderConfig }
): { text: string; entities: MessageEntity[] }
```

Converts Markdown into a `(text, entities)` pair for use with Telegram's `sendMessage` — no `parse_mode` needed. Entity offsets are measured in UTF-16 code units as required by Telegram.

`latexEscape` (default `true`) converts LaTeX `\(...\)` / `\[...\]` notation to Unicode math symbols before parsing. Spoiler syntax `||text||` is pre-processed automatically.

```typescript
const { text, entities } = convert(markdown);
await bot.sendMessage(chatId, text, { entities });
```

---

### `telegramify`

```typescript
async function telegramify(
  markdown: string,
  options?: {
    maxMessageLength?: number;  // default: 4096
    latexEscape?: boolean;      // default: true
    renderMermaid?: boolean;    // default: true (falls back to .txt file)
    minFileLines?: number;      // default: 1 — code blocks with >= N lines become file uploads
    config?: RenderConfig;      // default: the global config
  }
): Promise<Content[]>
```

The primary function for sending arbitrarily long Markdown content. Splits the input into a sequence of `Content` items that each fit within Telegram's limits. Code blocks above `minFileLines` are extracted as `File` items.

Dispatch each item to the appropriate Telegram method:

```typescript
for (const item of await telegramify(markdown)) {
  switch (item.contentType) {
    case ContentType.TEXT:
      await bot.sendMessage(chatId, item.text, { entities: item.entities });
      break;
    case ContentType.FILE:
      await bot.sendDocument(chatId, Buffer.from(item.fileData), {}, { filename: item.fileName });
      break;
    case ContentType.PHOTO:
      await bot.sendPhoto(chatId, Buffer.from(item.fileData));
      break;
  }
}
```

---

### `markdownify`

```typescript
function markdownify(
  markdown: string,
  options?: { latexEscape?: boolean; config?: RenderConfig }
): string
```

Converts Markdown to Telegram's `MarkdownV2` dialect. Use this only if your bot framework or middleware requires a `parse_mode="MarkdownV2"` string and cannot accept the `entities` parameter.

All mandatory Telegram special characters (`(`, `)`, `.`, `-`, `!`, etc.) are escaped within text nodes while formatting syntax is preserved.

```typescript
await bot.sendMessage(chatId, markdownify(markdown), { parse_mode: 'MarkdownV2' });
```

---

### `richify`

```typescript
function richify(
  markdown: string,
  options?: {
    mode?: 'html' | 'markdown';       // default: 'html'
    isRtl?: boolean;
    skipEntityDetection?: boolean;
    latexEscape?: boolean;             // default: false
    media?: InputRichMessageMedia[];   // files referenced via tg://photo?id=… links (Bot API 10.2)
  }
): InputRichMessage

interface InputRichMessage {          // exactly Telegram's shape: pass it as `rich_message`
  html?: string;
  markdown?: string;
  media?: InputRichMessageMedia[];
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
}
```

Converts Markdown into an `InputRichMessage` for Telegram's `sendRichMessage` endpoint (Bot API 10.1+). The result is already in the Bot API's wire format, so send it as-is:

```typescript
await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, rich_message: richify(markdown) }),
});
```

`mode: 'html'` (default) parses the Markdown and renders Telegram Rich HTML. `mode: 'markdown'` passes the string through as `{ markdown }` for Telegram to render server-side.

How Markdown maps to Rich HTML:

| Markdown | Rich HTML |
|---|---|
| `- [x] done` / `- [ ] todo` | native checkboxes `<input type="checkbox" checked/>` |
| `![](https://…/a.png "Caption")` | a standalone media block; the title becomes `<figcaption>` |
| `.mp4` / `.gif`, `.mp3` / `.ogg`, other extensions | `<video>`, `<audio>`, `<tg-document>` |
| `![](tg://photo?id=x)` (also `video`, `audio`, `document`) | media from the `media` option |
| `text[^n]` + `[^n]: definition` | `<a href="#n">` + `<tg-reference name="n">` |
| `$x$`, `$$x$$`, ```` ```math ```` | `<tg-math>`, `<tg-math-block>` |
| `\|\|spoiler\|\|` | `<tg-spoiler>` |
| `<u>`, `<ins>`, `<sub>`, `<sup>`, `<mark>` (bare tags) | passed through |

Media is always a block of its own: an image in the middle of a paragraph closes the paragraph around it. Inside a heading, a table cell or an inline tag, where a block cannot go, it is rendered as a link instead. `$10 … $20` reads as prices, and a single `~` doesn't start a strikethrough.

If the result may exceed Telegram's limits, use [`telegramifyRich()`](#telegramifyrich) instead.

---

### `telegramifyRich`

```typescript
function telegramifyRich(
  markdown: string,
  options?: {
    mode?: 'html' | 'markdown';
    isRtl?: boolean;
    skipEntityDetection?: boolean;
    latexEscape?: boolean;
    media?: InputRichMessageMedia[];
    byteLimit?: number;    // default: 32768
    blockLimit?: number;   // default: 500
    mediaLimit?: number;   // default: 50
  }
): InputRichMessage[]
```

Converts Markdown into one or more `InputRichMessage` chunks that each fit Telegram's limits. In html mode it splits at the exact block boundaries of the source. Blocks that are still too big are split further: paragraphs by text with inline formatting reopened in the next part, code blocks by lines, and lists, quotes and tables by child (ordered lists keep their numbering). Each chunk carries only the `media` entries its HTML references.

```typescript
for (const chunk of telegramifyRich(markdown)) {
  await sendRichMessage({ chat_id: chatId, rich_message: chunk });
}
```

---

### `splitRich`

```typescript
function splitRich(
  richMessage: InputRichMessage,
  options?: { byteLimit?: number; blockLimit?: number; mediaLimit?: number }
): InputRichMessage[]
```

Splits an `InputRichMessage` you already have into chunks that fit Telegram's limits. HTML is split at block boundaries recovered from the markup (bare text between blocks is kept), and nested tags are never cut in half. Markdown is split at blank lines, by bytes only.

---

### Streaming

```typescript
import { DraftStream, EditStream } from 'tg-md-msg';

const stream = new DraftStream({
  mode: 'rich',                       // or 'entity'
  sendDraft: (p) => api('sendRichMessageDraft', { chat_id: chatId, ...p }),
  sendFinal: (p) => api('sendRichMessage', { chat_id: chatId, ...p }),
  canStop: true,                      // Bot API 10.3: show a stop button
  // keepOnStop, draftId, interval (ms, default 300), thinkingDelay (ms, default 500), config…
});
await stream.consume(llmTokenStream); // or stream.feed(token) …
await stream.finish();                // sends the final message
```

A transport-agnostic port of upstream's streaming support. `DraftStream` throttles the accumulating Markdown into `sendMessageDraft` / `sendRichMessageDraft` calls, shows a `<tg-thinking>` placeholder until the first token arrives, keeps the draft alive past Telegram's 30-second expiry, and sends the complete message through `sendFinal` at the end. Payloads use Telegram's parameter names (`draft_id`, `text`, `entities`, `rich_message`, `can_stop`, `keep_on_stop`), so you can spread them into the API call. When the user presses stop, Telegram sends a `stopped_message_generation` update. Call `stream.cancel()` when it arrives.

`EditStream` takes `sendMessage` (returns the message id) and `editMessage(id, payload)` instead, for chats where drafts are unavailable. Its interval is at least 1000 ms. Durations are in milliseconds. The final message is not split, so for very long output, send `telegramifyRich()` chunks yourself.

---

## MarkdownV2 utilities

### `entitiesToMarkdownV2`

```typescript
function entitiesToMarkdownV2(
  text: string,
  entities?: MessageEntity[]
): string
```

Converts an entity-based `(text, entities)` pair back into a properly-escaped MarkdownV2 string. Useful for round-tripping or for systems that only accept MarkdownV2.

---

### `splitMarkdownV2`

```typescript
function splitMarkdownV2(
  text: string,
  entities?: MessageEntity[],
  maxUtf16Len?: number  // default: 4096
): string[]
```

Splits a MarkdownV2 string into chunks at entity-safe boundaries. Each chunk is a standalone valid MarkdownV2 string within the length limit.

---

## Markdown parser API

The underlying `pulldown-cmark` Rust parser is accessible directly through the TypeScript layer. This is useful for building custom renderers or extracting structured information from Markdown.

### `convertWithSegments`

```typescript
function convertWithSegments(
  markdown: string,
  options?: { latexEscape?: boolean; config?: RenderConfig }
): { text: string; entities: MessageEntity[]; segments: Segment[] }
```

Runs the full parsing pipeline and returns the rendered text, entity array, and a `segments` list. Each `Segment` identifies a code block or mermaid block with its character offsets in both JS string (`textStart`/`textEnd`) and UTF-16 (`utf16Start`/`utf16End`) coordinates — useful for building custom extraction or chunking logic.

### `escapeLatex` / `preprocessSpoilers`

```typescript
function escapeLatex(text: string): string
function preprocessSpoilers(text: string): string
```

Pre-processing helpers used internally before the Rust parser is invoked. `escapeLatex` converts `\(...\)` / `\[...\]` LaTeX to Unicode via symbol lookup. `preprocessSpoilers` converts `||text||` into `<tg-spoiler>text</tg-spoiler>` HTML inline tags.

### Native binding

The raw Rust module is located at `native/` within the package and exposes two functions:

```typescript
// native/index.d.ts
function parse(markdown: string, options?: MarkdownOptions): string        // → JSON [Event, Range][]
function renderHtml(markdown: string, options?: MarkdownOptions): string   // unused by this library
```

`parse()` returns a JSON-serialized array of `[Event, Range]` tuples. The `Event`, `Tag`, `Range`, and `Segment` TypeScript types exported from the main package describe this AST exactly.

`renderHtml()` is dead code — the TypeScript layer (`rich.ts`) generates Telegram-safe HTML directly and renders the native HTML export obsolete.

Ranges are **UTF-8 byte offsets** into the parsed string (pulldown-cmark's native unit), not JS string indices.

---

## Configuration

### `getRuntimeConfig` / `RenderConfig.isolated()`

```typescript
function getRuntimeConfig(): RenderConfig
RenderConfig.isolated(): RenderConfig
config.copy(): RenderConfig
```

`getRuntimeConfig()` returns the global `RenderConfig` singleton. Mutating it changes rendering for every later call that doesn't pass its own `config`, including concurrent requests. For per-chat or per-request settings, build an independent config with `RenderConfig.isolated()` (or `copy()` an existing one) and pass it as `config` to `convert`, `telegramify`, `markdownify`, `DraftStream` or `EditStream`.

### `RenderConfig`

| Property | Type | Description |
|---|---|---|
| `markdownSymbol` | `MarkdownSymbol` | Symbols prepended to headings, images, links, tasks, and horizontal rules |
| `citeExpandable` | `boolean` | Blockquotes longer than 200 chars use `expandable_blockquote` entity type |

### `MarkdownSymbol` defaults

| Field | Default |
|---|---|
| `headingLevel1` | `📌` |
| `headingLevel2` | `✏️` |
| `headingLevel3` | `📚` |
| `headingLevel4` | `🔖` |
| `headingLevel5` | _(empty)_ |
| `headingLevel6` | _(empty)_ |
| `image` | `🖼` |
| `taskCompleted` | `✅` |
| `taskUncompleted` | `☐` |
| `horizontalRule` | `————————` |
| `unorderedListItem` | `⦁` |
| `orderedListSuffix` | `.` |

Example:

```typescript
import { getRuntimeConfig } from 'tg-md-msg';

const config = getRuntimeConfig();
config.markdownSymbol.headingLevel1 = '#';
config.citeExpandable = false;
```

---

## Content types

`telegramify()` returns `Content[]`. The `contentType` discriminant determines which Telegram method to use:

```typescript
import { ContentType } from 'tg-md-msg';

// ContentType.TEXT — send as a text message
item.text       // string
item.entities   // MessageEntity[]

// ContentType.FILE — send as a document (code blocks, mermaid fallbacks)
item.fileName         // string — suggested filename with extension
item.fileData         // Uint8Array
item.captionText      // string
item.captionEntities  // MessageEntity[]

// ContentType.PHOTO — send as a photo
item.fileName         // string
item.fileData         // Uint8Array
item.captionText      // string
item.captionEntities  // MessageEntity[]
```

`contentTrace.sourceType` (`'text'`, `'file'`, `'mermaid'`) provides additional context about why an item was produced.

---

## Building from source

Requires a stable Rust toolchain and Node 18+.

```bash
git clone https://github.com/your-org/tg-md-msg
cd tg-md-msg
npm install
npm run build        # builds Rust native module + TypeScript
npm test
```

`tests/server.spec.ts` sends real messages and runs only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set (in the environment or `.env`). It deletes each message after sending.

Cross-compilation for Linux ARM targets uses [`cross`](https://github.com/cross-rs/cross).

---

## License

MIT
