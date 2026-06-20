# tg-md-msg

Convert Markdown to Telegram-compatible messages. A TypeScript port of [telegramify-markdown](https://github.com/sudoskys/telegramify-markdown) (Python).

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
- `sendRichMessage` (Bot API 10.1+): **32,768 bytes** and **500 blocks** per message

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
  options?: { latexEscape?: boolean }
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
  }
): InputRichMessage
```

Converts Markdown into an `InputRichMessage` for Telegram's `sendRichMessage` endpoint (Bot API 10.1+). Rich Messages support a broader set of block types than standard messages: nested blockquotes, tables, math expressions, collages, and 20+ other block types.

`mode: 'html'` (default) runs the Markdown through the full TS rendering pipeline and produces an `{ html }` payload. `mode: 'markdown'` passes the string through directly as `{ markdown }` for Telegram to render server-side.

If the result may exceed Telegram's 32,768-byte / 500-block limits, use [`telegramifyRich()`](#telegramifyrich) instead.

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
    byteLimit?: number;    // default: 32768
    blockLimit?: number;   // default: 500
  }
): InputRichMessage[]
```

Convenience wrapper that calls `richify()` then `splitRich()`. Use this when sending rich content of unknown length.

```typescript
const chunks = telegramifyRich(markdown);
for (const chunk of chunks) {
  await bot.sendRichMessage(chatId, chunk);
}
```

---

### `splitRich`

```typescript
function splitRich(
  richMessage: InputRichMessage,
  options?: { byteLimit?: number; blockLimit?: number }
): InputRichMessage[]
```

Splits an `InputRichMessage` into chunks that satisfy Telegram's limits (default: 32,768 bytes, 500 blocks). Only splits between top-level block elements — nested tags are never sliced in half.

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

`parse()` returns a JSON-serialized array of `[Event, Range]` tuples where ranges carry UTF-16 code unit offsets. The `Event`, `Tag`, `Range`, and `Segment` TypeScript types exported from the main package describe this AST exactly.

`renderHtml()` is dead code — the TypeScript layer (`rich.ts`) generates Telegram-safe HTML directly and renders the native HTML export obsolete.

---

## Configuration

### `getRuntimeConfig`

```typescript
function getRuntimeConfig(): RenderConfig
```

Returns the global `RenderConfig` singleton. Mutate its properties to change rendering behavior for all subsequent calls.

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
| `taskUncompleted` | `☑️` |
| `horizontalRule` | `————————` |

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

Cross-compilation for Linux ARM targets uses [`cross`](https://github.com/cross-rs/cross).

---

## License

MIT
