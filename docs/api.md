# API reference

Everything is exported from the package root:

```ts
import { convert, telegramifyRich, DraftStream } from 'tg-md-msg';
```

For when to use what, and complete examples, see the [README](../README.md).

- [Entities](#entities): [`convert`](#convert), [`telegramify`](#telegramify), [`splitEntities`](#splitentities), [`MessageEntity`](#messageentity), [`Content`](#content)
- [Rich messages](#rich-messages): [`richify`](#richify), [`telegramifyRich`](#telegramifyrich), [`splitRich`](#splitrich), [`InputRichMessage`](#inputrichmessage)
- [MarkdownV2](#markdownv2): [`markdownify`](#markdownify), [`entitiesToMarkdownV2`](#entitiestomarkdownv2), [`splitMarkdownV2`](#splitmarkdownv2)
- [Streaming](#streaming): [`DraftStream`](#draftstream), [`EditStream`](#editstream), [`StreamCore`](#streamcore)
- [Telegraph](#telegraph): [`toTelegraphNodes`](#totelegraphnodes), [`splitTelegraphNodes`](#splittelegraphnodes), [`telegraphByteLength`](#telegraphbytelength), [`isTelegraphSafe`](#istelegraphsafe)
- [Configuration](#configuration): [`RenderConfig`](#renderconfig), [`getRuntimeConfig`](#getruntimeconfig)
- [Low-level](#low-level)

## Supported Markdown

CommonMark plus tables, strikethrough (`~~text~~`), task lists, footnotes and math (`$…$`, `$$…$$`), and these Telegram extensions:

| Syntax | Meaning |
|---|---|
| `\|\|text\|\|` | spoiler |
| `![👍](tg://emoji?id=5368324170671202286)` | custom emoji; the alt text is the fallback emoji |
| `<u>`, `<ins>`, `<b>`, `<strong>`, `<i>`, `<em>`, `<s>`, `<del>`, `<strike>`, `<tg-spoiler>` | inline formatting written as HTML |
| `\(…\)`, `\[…\]` | LaTeX, converted to Unicode when `latexEscape` is on |

## Entities

### `convert`

```ts
function convert(
  markdown: string,
  options?: { latexEscape?: boolean; config?: RenderConfig },
): { text: string; entities: MessageEntity[] }
```

Renders Markdown as plain text plus entities, for `sendMessage`, `editMessageText` or a media caption. Send the two together, without `parse_mode`. Entity offsets and lengths are in UTF-16 code units, as Telegram requires.

The output isn't split; see [`splitEntities`](#splitentities).

| Option | Default | |
|---|---|---|
| `latexEscape` | `true` | Convert `\(…\)` and `\[…\]` LaTeX to Unicode |
| `config` | the global config | Symbols for headings, lists, tasks; see [`RenderConfig`](#renderconfig) |

How elements render: headings get a symbol and are bold and underlined (levels 1–2), bold (3–4) or italic (5–6). Lists are indented with `⦁` or `1.`, task items get `✅` or `☐`, and tables become a monospace `pre` block. Images become a `🖼` link. Blockquotes longer than 200 characters become `expandable_blockquote`.

### `telegramify`

```ts
function telegramify(
  markdown: string,
  options?: {
    maxMessageLength?: number; // default 4096
    minFileLines?: number;     // default 1
    latexEscape?: boolean;     // default true
    renderMermaid?: boolean;   // default true
    config?: RenderConfig;
  },
): Promise<Content[]>
```

Renders Markdown and splits it into items to send in order: text messages of at most `maxMessageLength` UTF-16 code units, and files.

- Code blocks with at least `minFileLines` lines become [`File`](#content) items, named from the language (`readable.py`). The default, 1, extracts every code block; `0` keeps all code inline.
- Mermaid blocks become `mermaid.txt` files while `renderMermaid` is on, because diagrams are not rendered. With it off, they are treated like any other code block.
- Whitespace-only input returns `[]`.

`processMarkdown` is the same function under its upstream name.

### `splitEntities`

```ts
function splitEntities(
  text: string,
  entities: MessageEntity[],
  maxUtf16Len: number,
): { text: string; entities: MessageEntity[] }[]
```

Splits the output of `convert()` into chunks of at most `maxUtf16Len` UTF-16 code units. It cuts after the last line break that fits, or at the limit if a line is longer. An entity that crosses a cut is clipped into both chunks, and each chunk's offsets start from 0. Returns `[]` for whitespace-only text.

### `MessageEntity`

```ts
interface MessageEntity {
  type: string; // 'bold', 'italic', 'underline', 'strikethrough', 'spoiler', 'code', 'pre',
                // 'text_link', 'blockquote', 'expandable_blockquote', 'custom_emoji'
  offset: number;
  length: number;
  url?: string;             // text_link
  language?: string;        // pre
  custom_emoji_id?: string; // custom_emoji
}
```

Telegram's own shape. `type` is a `string`, so typed clients such as grammY need a cast or a filter.

`utf16Len(text)` returns the length Telegram counts, which in JavaScript is `text.length`.

### `Content`

`telegramify()` returns a discriminated union on `contentType`:

```ts
type Content = Text | File | Photo | RichMessage;

interface Text {
  contentType: ContentType.TEXT;  // 'text'
  text: string;
  entities: MessageEntity[];
  contentTrace: ContentTrace;
}

interface File {
  contentType: ContentType.FILE;  // 'file'
  fileName: string;
  fileData: Uint8Array;
  captionText: string;
  captionEntities: MessageEntity[];
  contentTrace: ContentTrace;     // sourceType 'file' (extra.language) or 'mermaid'
}
```

`Photo` (`'photo'`) has the same fields as `File`, and `RichMessage` (`'rich'`) carries a `richMessage: InputRichMessage`. `telegramify()` doesn't produce either today; handle them if you exhaustively match on `contentType`.

## Rich messages

Rich messages (`sendRichMessage`, Bot API 10.1+) render Telegram's Rich HTML: headings, tables, checkboxes, math, footnotes and media blocks. The functions here return [`InputRichMessage`](#inputrichmessage) objects in Telegram's wire format.

### `richify`

```ts
function richify(markdown: string, options?: RichifyOptions): InputRichMessage

interface RichifyOptions {
  mode?: 'html' | 'markdown'; // default 'html'
  latexEscape?: boolean;      // default false
  isRtl?: boolean;
  skipEntityDetection?: boolean;
  media?: InputRichMessageMedia[];
}
```

Renders Markdown as one rich message, without splitting. Use it when the text is known to fit; otherwise use [`telegramifyRich`](#telegramifyrich).

| Option | |
|---|---|
| `mode` | `'html'` renders the HTML here. `'markdown'` sends the input as `{ markdown }` for Telegram to render. |
| `latexEscape` | Convert `\(…\)` and `\[…\]` to Unicode. Rich HTML renders `$…$` math natively, so this is off by default. |
| `isRtl` | Sent as `is_rtl`: lay the message out right to left. |
| `skipEntityDetection` | Sent as `skip_entity_detection`: don't turn bare URLs, `@mentions` and the like into links. |
| `media` | Files referenced from the text as `tg://photo?id=…`, `tg://video?id=…`, `tg://audio?id=…` or `tg://document?id=…` (Bot API 10.2). |

Empty input returns `{ html: '' }`, which Telegram rejects; check for it.

How Markdown maps to Rich HTML:

| Markdown | Rich HTML |
|---|---|
| `# …` to `###### …` | `<h1>` to `<h6>` |
| `- [x] done`, `- [ ] todo` | `<input type="checkbox" checked/>` inside the `<li>` |
| tables | `<table>` |
| `$x$`, `$$x$$`, ```` ```math ```` | `<tg-math>`, `<tg-math-block>` |
| `text[^n]`, `[^n]: note` | `<a href="#n">`, `<tg-reference name="n">` |
| `![alt](url "Title")` | `<img>` block; a title becomes `<figure>` with `<figcaption>` |
| `.mp4`, `.m4v`, `.mov`, `.webm`, `.mkv`, `.avi`, `.gif` | `<video>` |
| `.mp3`, `.m4a`, `.ogg`, `.oga`, `.opus`, `.wav`, `.flac`, `.aac` | `<audio>` |
| an image extension, or none | `<img>` |
| any other extension | `<tg-document>` |
| `\|\|text\|\|` | `<tg-spoiler>` |
| `<u>`, `<ins>`, `<sub>`, `<sup>`, `<mark>`, `<b>`, `<i>`, `<s>`, `<code>`, `<tg-spoiler>` and similar inline tags, without attributes | passed through |

Media is never inside a paragraph: an image in the middle of a paragraph closes it, and the text after the image starts a new one. In a heading, a table cell or inside inline formatting, where a block can't go, the image becomes a link.

### `telegramifyRich`

```ts
function telegramifyRich(
  markdown: string,
  options?: RichifyOptions & RichLimits,
): InputRichMessage[]

interface RichLimits {
  byteLimit?: number;  // default RICH_BYTE_LIMIT  = 32768
  blockLimit?: number; // default RICH_BLOCK_LIMIT = 500
  mediaLimit?: number; // default RICH_MEDIA_LIMIT = 50
}
```

Renders Markdown and splits it into messages that each fit the limits. Whitespace-only input returns `[]`.

- `byteLimit` counts UTF-8 bytes of the HTML, markup included. Telegram's limit is 32,768 characters of text, so the default is a safe upper bound.
- `blockLimit` counts blocks the way Telegram does: nested blocks, list items and table rows each count.
- Each message carries only the `media` entries its HTML references.

The split happens between top-level blocks. A block too big for a message on its own is split further:

- paragraphs at a word boundary, with inline formatting closed and reopened around the cut;
- code blocks by lines;
- lists, quotes and tables by child. An ordered list continues with `<ol start="n">`.

In `'markdown'` mode the text is split at blank lines, by bytes only.

### `splitRich`

```ts
function splitRich(richMessage: InputRichMessage, options?: RichLimits): InputRichMessage[]
```

Splits an `InputRichMessage` you built yourself, for example HTML you wrapped around `richify()` output. HTML is split at the top-level block boundaries found in the markup, and a tag is never cut in half. Flags and referenced `media` are copied to each part.

### `InputRichMessage`

```ts
interface InputRichMessage {
  html?: string;      // exactly one of html and markdown is set
  markdown?: string;
  media?: InputRichMessageMedia[];
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
}

interface InputRichMessageMedia {
  id: string;                  // 1–64 of A-Z a-z 0-9 _ -, as used in tg://photo?id=…
  media: Record<string, any>;  // an InputMedia* object, e.g. { type: 'photo', media: fileId }
}
```

Telegram's `InputRichMessage`. Pass it as `rich_message` without conversion.

`RichBlock`, `RichMode`, `RICH_BYTE_LIMIT`, `RICH_BLOCK_LIMIT` and `RICH_MEDIA_LIMIT` are exported too.

## MarkdownV2

For APIs that only accept a `parse_mode` string. Prefer entities where you can: one wrong escape makes Telegram reject the whole message.

### `markdownify`

```ts
function markdownify(
  markdown: string,
  options?: { latexEscape?: boolean; config?: RenderConfig },
): string
```

Renders Markdown as a MarkdownV2 string, escaping every character Telegram reserves. The same as calling `convert()` and passing its result to `entitiesToMarkdownV2()`. Not split; don't `slice()` the result, use [`splitMarkdownV2`](#splitmarkdownv2).

### `entitiesToMarkdownV2`

```ts
function entitiesToMarkdownV2(text: string, entities?: MessageEntity[]): string
```

Converts plain text plus entities, such as the output of `convert()` or a received message, into MarkdownV2.

### `splitMarkdownV2`

```ts
function splitMarkdownV2(
  text: string,
  entities?: MessageEntity[],
  maxUtf16Len?: number, // default 4096
): string[]
```

Splits plain text plus entities into MarkdownV2 strings that are each at most `maxUtf16Len` long after escaping. Escaping lengthens the text, so a chunk that grows past the limit is split again.

## Streaming

The streaming classes don't call Telegram themselves: you pass functions that do. Payloads use Telegram's parameter names, so spread them into the call along with `chat_id`. All durations are milliseconds.

Both classes have the same lifecycle:

| Member | |
|---|---|
| `feed(token)` | Append text. Throttled sends follow. |
| `consume(tokens)` | Feed every string from an iterable or async iterable, then `finish()`. If the iterable throws, the stream is cancelled and the error rethrown. |
| `finish()` | Send the complete message. Idempotent. Rejects if the final send fails. |
| `cancel()` | Stop without a final message. Idempotent. |
| `buffer` | The text fed so far. |
| `state` | `'idle'`, `'active'` or `'done'`. |

An intermediate send that fails is logged with `console.warn` and skipped. After three failures in a row, intermediate sends stop for the rest of the stream; `finish()` still sends the final message.

### `DraftStream`

```ts
new DraftStream<M extends 'rich' | 'entity' = 'rich'>(options: DraftStreamOptions<M>)
```

Previews a reply with `sendMessageDraft` (entity mode) or `sendRichMessageDraft` (rich mode), then sends the final message. Drafts work in private chats.

| Option | Default | |
|---|---|---|
| `sendDraft(payload)` | required | Call the draft method. Payload: `{ draft_id, text, entities }` or `{ draft_id, rich_message }`, plus `can_stop` and `keep_on_stop` when set. |
| `sendFinal(payload)` | required | Send the final message. Payload: `{ text, entities }` or `{ rich_message }`. |
| `mode` | `'rich'` | `'rich'` or `'entity'`. |
| `draftId` | random | Non-zero integer. Telegram shows each draft id as its own bubble, so use one id per reply. |
| `interval` | `300` | Minimum time between drafts. |
| `thinkingDelay` | `500` | Show a `Thinking...` placeholder for this long before the first draft. `0` or `null` disables it. |
| `keepaliveTimeout` | `25000` | Resend the draft after this long without one. Telegram drops a draft after about 30 s. |
| `canStop` | | Sent as `can_stop`: show a stop button (Bot API 10.3). |
| `keepOnStop` | | Sent as `keep_on_stop`: keep the draft after the user stops it. |
| `cancelClearsDraft` | `!keepOnStop` | On `cancel()`, send a last draft that clears the text (`…` in rich mode). |
| `config` | global | Entity mode: see [`RenderConfig`](#renderconfig). |

When a draft would exceed one message, it shows the end of the text: the last 4096 characters in entity mode, without entities; the last `telegramifyRich()` chunk in rich mode. The final message is the whole text, unsplit; for long replies, send chunks yourself instead of using `sendFinal`.

`DRAFT_TEXT_LIMIT` (4096) is exported.

### `EditStream`

```ts
new EditStream<M extends 'rich' | 'entity' = 'rich'>(options: EditStreamOptions<M>)
```

Sends one message and edits it as text arrives. Use it where drafts aren't available, such as groups and channels.

| Option | Default | |
|---|---|---|
| `sendMessage(payload)` | required | Send the first snapshot; resolve to its `message_id`. |
| `editMessage(messageId, payload)` | required | Replace the message's content. |
| `mode` | `'rich'` | `'rich'` or `'entity'`. |
| `interval` | `1000` | Minimum time between edits. Smaller values throw, because Telegram allows about one edit per second. |
| `keepaliveTimeout` | `25000` | Re-edit after this long without an edit. |
| `config` | global | Entity mode: see [`RenderConfig`](#renderconfig). |

Payloads are `{ text, entities }` or `{ rich_message }`. `messageId` returns the sent message's id once it exists. `cancel()` leaves the message as it last was. Edits are not split, so a snapshot over Telegram's limit fails; keep replies short or stop editing past the limit.

`EDIT_MIN_INTERVAL` (1000) is exported.

### `StreamCore`

```ts
new StreamCore<T>({ render, emit, finalize, interval?, keepaliveTimeout?, onCancel? })
```

The transport-independent buffer both classes are built on: it calls `render(buffer)` on a throttled schedule, passes the result to `emit`, and passes the last one to `finalize`. Use it to stream into something other than Telegram messages.

## Telegraph

Content for [Telegraph](https://telegra.ph/api) pages, parsed the same way as the chat output.

### `toTelegraphNodes`

```ts
function toTelegraphNodes(markdown: string, options?: { latexEscape?: boolean }): TelegraphNode[]

type TelegraphNode = string | { tag: TelegraphTag; attrs?: { href?: string; src?: string }; children?: TelegraphNode[] };
```

Renders Markdown as Telegraph's `Node[]`, using only the tags in `TELEGRAPH_TAGS` and only `href` and `src`.

- `#` and `##` become `h3`; deeper headings become `h4`.
- Tables become preformatted text; math becomes code.
- Spoilers become plain text.
- Only `http(s)://`, `mailto:` and `tg://` links are kept.

### `splitTelegraphNodes`

```ts
function splitTelegraphNodes(nodes: readonly TelegraphNode[], budgetBytes: number): TelegraphNode[][]
```

Packs nodes into pages of at most `budgetBytes`, measured as [`telegraphByteLength`](#telegraphbytelength) does. A node too big for a page is split into copies holding part of its children. Order is kept, and no page is empty. Throws if `budgetBytes` is under 64.

Telegraph documents 64 KB per page, but has rejected pages from about 54 KB of Cyrillic text; a budget of about 45,000 is safe.

### `telegraphByteLength`

```ts
function telegraphByteLength(nodes: readonly TelegraphNode[]): number
```

UTF-8 bytes of `JSON.stringify(nodes)`, the size Telegraph's content limit applies to.

### `isTelegraphSafe`

```ts
function isTelegraphSafe(nodes: readonly TelegraphNode[]): boolean
```

`true` when every node uses an allowed tag and only `href` and `src`. Useful to check nodes you build or edit yourself.

## Configuration

Applies to entity output: `convert`, `telegramify`, `markdownify` and entity-mode streams. Rich and Telegraph output don't use it.

### `RenderConfig`

```ts
class RenderConfig {
  static isolated(): RenderConfig; // a new config with defaults
  copy(): RenderConfig;            // an independent copy
  readonly markdownSymbol: MarkdownSymbol;
  citeExpandable: boolean;         // default true
}
```

`citeExpandable` turns blockquotes longer than 200 characters into `expandable_blockquote`. `markdownSymbol` holds the symbols, all writable:

| Field | Default | |
|---|---|---|
| `headingLevel1` … `headingLevel4` | `📌` `✏️` `📚` `🔖` | before the heading text |
| `headingLevel5`, `headingLevel6` | empty | |
| `image` | `🖼` | before an image link |
| `taskCompleted` | `✅` | |
| `taskUncompleted` | `☐` | |
| `horizontalRule` | `————————` | |
| `unorderedListItem` | `⦁` | |
| `orderedListSuffix` | `.` | after the number |
| `link` | `🔗` | currently unused |

### `getRuntimeConfig`

```ts
function getRuntimeConfig(): RenderConfig
```

The global config, used by every call that doesn't pass `config`. Changes to it affect all later calls, including concurrent ones, so change it at startup only. For per-request settings, pass `RenderConfig.isolated()` or `getRuntimeConfig().copy()`.

## Low-level

For custom renderers. These are stable but not needed for sending messages.

| Export | |
|---|---|
| `convertWithSegments(markdown, options?)` | `convert()` plus `segments`: each code block and mermaid block, with its language, raw code and position in the output text (`textStart`/`textEnd`, `utf16Start`/`utf16End`). |
| `escapeLatex(text)` | Convert `\(…\)` and `\[…\]` LaTeX to Unicode. |
| `preprocessSpoilers(text, options?)` | Turn `\|\|text\|\|` outside code into `<tg-spoiler>` tags. |
| `STANDARD_OPTIONS`, `ParseOptions` | The parser extensions in use. |
| `Event`, `Tag`, `Range`, `Segment` | Types of the parser's event stream. `Range` values are UTF-8 byte offsets into the source. |
