## API

Below is the public API of the `ts-md-msg` library. All inputs should be valid Markdown strings.

### 🤔 What you want to do?

* If you just want to send *static text* and don't want to worry about formatting → use **[`convert()`](#convert)**
* If you are developing an *LLM application* or need to send potentially **super-long text** → use **[`telegramify()`](#telegramify)**
* If your middleware only supports `parse_mode="MarkdownV2"` (no `entities` parameter) → use **[`markdownify()`](#markdownify)**
* If you want Telegram Bot API 10.1 structured Rich Messages → use **[`richify()`](#richify)**
* If you need to split long Rich Messages automatically to respect Telegram limits → use **[`splitRich()`](#splitrich)**
* If you need to render standard HTML for debugging or custom logic → use **[`processMarkdown()`](#processmarkdown)**

---

### `convert`

**Signature:**
```typescript
function convert(
  markdown: string, 
  options?: { isRtl?: boolean; skipEntityDetection?: boolean }
): { text: string, entities: MessageEntity[] }
```

**Description:**
Converts Markdown into a `(text, entities)` tuple that can be sent directly via the Telegram Bot API — no `parse_mode` needed! Use this when you want to avoid MarkdownV2 escaping headaches entirely. The returned `text` is the raw string, and `entities` is an array of Telegram `MessageEntity` objects with UTF-16 code unit offsets accurately measured for Telegram. Spoilers (`||...||`) and LaTeX formulas (`$$...$$`) are automatically pre-processed.

---

### `telegramify`

**Signature:**
```typescript
function telegramify(
  markdown: string, 
  options?: { isRtl?: boolean; skipEntityDetection?: boolean; latexEscape?: boolean }
): DeliveryItem[]
```

**Description:**
Use this when you have an arbitrarily long Markdown string (like LLM output) that exceeds Telegram's 4096 character limit. It automatically splits the Markdown into a sequence of safe, chunked delivery items (`TextItem`, `FileItem`, or `PhotoItem`). It guarantees that entities are not sliced across chunk boundaries, meaning formatting won't be broken when sent as multiple messages.

---

### `markdownify`

**Signature:**
```typescript
function markdownify(
  markdown: string, 
  options?: { isRtl?: boolean; skipEntityDetection?: boolean; latexEscape?: boolean }
): string
```

**Description:**
Translates standard Markdown to Telegram's highly strict `MarkdownV2` dialect. Use this if your library or middleware strictly requires passing a single string with `parse_mode="MarkdownV2"` instead of using entities. It automatically escapes all mandatory Telegram special characters (like `(`, `)`, `.`, `-`) within text nodes while leaving your formatting intact.

---

### `richify`

**Signature:**
```typescript
function richify(
  markdown: string, 
  options?: { mode?: 'html' | 'markdown'; isRtl?: boolean; skipEntityDetection?: boolean; latexEscape?: boolean }
): InputRichMessage
```

**Description:**
Converts Markdown into an `InputRichMessage` payload specifically designed for Telegram's newer `sendRichMessage` endpoint or Telegraph flows. Telegram's Rich Message API has much broader display capabilities than standard HTML parse mode (supporting nested blockquotes, lists, tables, and math blocks like `<tg-math-block>`). Use this when you want the highest fidelity rendering of your Markdown structure natively in Telegram clients.

---

### `splitRich`

**Signature:**
```typescript
function splitRich(
  richMessage: InputRichMessage, 
  options?: { byteLimit?: number; blockLimit?: number }
): InputRichMessage[]
```

**Description:**
Use this when you are working with `richify()` and need to send extremely long documents. It automatically splits a single `InputRichMessage` into multiple sendable chunks that respect Telegram's strict Rich Message size limits (32768 bytes and 500 blocks). It guarantees safe boundaries by only splitting between top-level HTML elements (like paragraphs or tables), ensuring that nested HTML tags are never sliced in half.

---

### `processMarkdown`

**Signature:**
```typescript
function processMarkdown(markdown: string): string
```

**Description:**
A utility wrapper that renders your Markdown into standard, browser-compatible HTML. Use this primarily for debugging the underlying parser output or if you need to use the exact same Markdown AST to render a webpage preview of the message.
