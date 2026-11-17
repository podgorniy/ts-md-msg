# tg-md-msg

Send Markdown, typically LLM output, to Telegram without broken formatting, rejected messages or manual escaping.

```ts
import { convert } from 'tg-md-msg';

const { text, entities } = convert('**Hello** from `tg-md-msg`');
await bot.api.sendMessage(chatId, text, { entities });
```

`tg-md-msg` parses Markdown with [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark) (Rust, via N-API) and renders it into every format Telegram accepts:

- **Entities**: plain text plus a `MessageEntity[]` for `sendMessage`. No `parse_mode`, so there is nothing to escape.
- **Rich messages**: `InputRichMessage` for `sendRichMessage` (Bot API 10.1+), with headings, tables, checkboxes, math, footnotes and media.
- **MarkdownV2**: an escaped string, for code paths that only take `parse_mode: 'MarkdownV2'`.
- **Telegraph**: `Node[]` for [telegra.ph](https://telegra.ph/api) pages, for content too long for a chat.

Every format comes with a splitter that respects Telegram's limits, and there are streaming helpers for showing a reply while it is generated.

It is a TypeScript port of [telegramify-markdown](https://github.com/sudoskys/telegramify-markdown) (Python) and tracks its 1.4.2 release and Telegram Bot API 10.4.

## Contents

- [Installation](#installation)
- [Choosing an output format](#choosing-an-output-format)
- [Guides](#guides)
  - [Send a reply of any length](#send-a-reply-of-any-length)
  - [Send rich messages](#send-rich-messages)
  - [Stream a reply while it is generated](#stream-a-reply-while-it-is-generated)
  - [Edit a message or inline result](#edit-a-message-or-inline-result)
  - [Publish to Telegraph](#publish-to-telegraph)
  - [Configure rendering](#configure-rendering)
- [Telegram limits](#telegram-limits)
- [Pitfalls](#pitfalls)
- [API reference](docs/api.md)
- [Upgrading from 0.1](#upgrading-from-01)
- [Contributing](CONTRIBUTING.md)

## Installation

The package is installed from GitHub; it is not on the npm registry. Pin a release tag:

```bash
npm install github:podgorniy/ts-md-msg#v0.2.1
```

Requirements:

- Node.js 18 or later; CI tests on 22. The package is **ESM only**: use `import`, not `require()`.
- One of the platforms with a prebuilt native binary: macOS (x64, arm64), Windows x64, Linux glibc or musl (x64, arm64).

On install, a `postinstall` script downloads the native binary for the package version from [GitHub Releases](https://github.com/podgorniy/ts-md-msg/releases) into `node_modules/tg-md-msg/native/`. If the download fails, the install fails. Two consequences:

- **Pin a tag, not a commit.** The binary is looked up by the `version` in `package.json`, so a commit between releases may point at a binary that doesn't exist yet.
- **Don't skip install scripts.** `npm ci --ignore-scripts`, or `SKIP_POSTINSTALL=1`, leaves the package without its binary, and the first `import` throws. In Docker, run `npm ci` in the same stage, for the same OS, CPU architecture and libc (glibc or musl) as the runtime image.

On any other platform, build the binary from source; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Choosing an output format

| You want to… | Use | Telegram method |
|---|---|---|
| Send a short formatted message | [`convert()`](docs/api.md#convert) | `sendMessage` with `entities` |
| Send a reply of any length, with code blocks as files | [`telegramify()`](docs/api.md#telegramify) | `sendMessage`, `sendDocument` |
| Send a reply of any length, all as text | [`convert()`](docs/api.md#convert) + [`splitEntities()`](docs/api.md#splitentities) | `sendMessage` with `entities` |
| Send a document-like reply: tables, checkboxes, math, images | [`telegramifyRich()`](docs/api.md#telegramifyrich) | `sendRichMessage` |
| Show a reply while an LLM is still writing it | [`DraftStream`](docs/api.md#draftstream), [`EditStream`](docs/api.md#editstream) | `sendMessageDraft`, `sendRichMessageDraft`, `editMessageText` |
| Pass formatted text where only a `parse_mode` string is accepted | [`markdownify()`](docs/api.md#markdownify) | any method, with `parse_mode: 'MarkdownV2'` |
| Publish a long text as a web page | [`toTelegraphNodes()`](docs/api.md#totelegraphnodes) | Telegraph `createPage` |

**Entities or rich messages?** Entities work in every chat and every client. They cover inline formatting, links, code and quotes; headings become bold, underlined text with an emoji, and tables become monospace text blocks. Rich messages render real headings, tables, checkboxes, math and images, and allow 32 KB per message instead of 4096 characters. They need Bot API 10.1+ and a recent client. A bot that does both, like the one this library was written for, makes it a per-user setting and falls back to entities.

## Guides

The examples use [grammY](https://grammy.dev). The library itself has no dependency on a bot framework: every function returns plain objects in Telegram's own field names, which you can pass to any client or to `fetch`.

### Send a reply of any length

A Telegram message holds at most 4096 characters. `convert()` renders the whole reply, and `splitEntities()` cuts it at line breaks into chunks that fit, adjusting entity offsets for each chunk:

```ts
import { convert, splitEntities } from 'tg-md-msg';
import type { MessageEntity } from 'grammy/types';

const { text, entities } = convert(reply, { latexEscape: true });
for (const chunk of splitEntities(text, entities, 4000)) {
  await bot.api.sendMessage(chatId, chunk.text, {
    entities: chunk.entities as MessageEntity[],
  });
}
```

`MessageEntity.type` is typed as `string`, so grammY's stricter union needs a cast. To guard against an entity type your client doesn't know, filter instead of casting: Telegram rejects the whole message for one invalid entity.

`telegramify()` does the same, and also turns code blocks into files:

```ts
import { telegramify, ContentType } from 'tg-md-msg';
import { InputFile } from 'grammy';

for (const item of await telegramify(reply, { maxMessageLength: 4000 })) {
  if (item.contentType === ContentType.TEXT) {
    await bot.api.sendMessage(chatId, item.text, { entities: item.entities as MessageEntity[] });
  } else if (item.contentType === ContentType.FILE) {
    await bot.api.sendDocument(chatId, new InputFile(item.fileData, item.fileName));
  }
}
```

By default **every** code block becomes a document, named from its language (`readable.py`). Pass `minFileLines: 10` to extract only longer blocks, or `minFileLines: 0` to keep all code inline. Mermaid blocks are not rendered; they are sent as `mermaid.txt`.

### Send rich messages

`telegramifyRich()` renders Markdown as Rich HTML and splits it into `InputRichMessage` chunks that each fit one message. The objects are already in Telegram's wire format:

```ts
import { telegramifyRich } from 'tg-md-msg';

for (const richMessage of telegramifyRich(reply, { latexEscape: true })) {
  await bot.api.raw.sendRichMessage({ chat_id: chatId, rich_message: richMessage });
}
```

Use `richify()` instead when you know the text fits in one message, such as a generated report:

```ts
import { richify } from 'tg-md-msg';

await bot.api.raw.sendRichMessage({ chat_id: chatId, rich_message: richify(reportMarkdown) });
```

Splitting happens at block boundaries: between paragraphs, list items, table rows and so on. A single oversized block is split further, and an ordered list continues its numbering in the next message.

What the Markdown becomes:

| Markdown | Rich message |
|---|---|
| `# Heading` … `######` | real headings |
| `- [x] done` / `- [ ] todo` | native checkboxes |
| tables | real tables, up to 20 columns |
| `$x^2$`, `$$…$$`, ```` ```math ```` | rendered math |
| `text[^1]` with `[^1]: note` | a footnote reference that links to its note |
| `![alt](https://…/cat.png "Caption")` | a photo block with the caption |
| links ending in `.mp4` / `.gif`, `.mp3` / `.ogg`, other files | video, audio, document blocks |
| `\|\|spoiler\|\|` | spoiler |
| `<u>`, `<sub>`, `<sup>`, `<mark>` and other inline tags in the text | passed through |

Media is always a block of its own; an image in the middle of a sentence splits the paragraph around it. To send files you uploaded instead of URLs, reference them as `![](tg://photo?id=cover)` and pass the files in `media`:

```ts
telegramifyRich('Here it is:\n\n![](tg://photo?id=cover)', {
  media: [{ id: 'cover', media: { type: 'photo', media: fileId } }],
});
```

For right-to-left text, pass `isRtl: true`. The library doesn't detect the script direction for you; a simple check is whether more than 30% of the letters are Hebrew or Arabic.

### Stream a reply while it is generated

Telegram can show a live preview while a reply is being written: `sendMessageDraft` and `sendRichMessageDraft` update a temporary bubble in the chat, and a final `sendMessage` or `sendRichMessage` replaces it. `DraftStream` handles the throttling, the "Thinking…" placeholder, the keepalive that stops the bubble from expiring after 30 seconds, and the final send. You supply the two calls:

```ts
import { DraftStream } from 'tg-md-msg';

const stream = new DraftStream({
  mode: 'rich', // or 'entity'
  sendDraft: (payload) => bot.api.raw.sendRichMessageDraft({ chat_id: chatId, ...payload }),
  sendFinal: (payload) => bot.api.raw.sendRichMessage({ chat_id: chatId, ...payload }),
  canStop: true, // show a stop button (Bot API 10.3)
});

await stream.consume(llm.streamText(prompt)); // feeds every token, then finish()
```

`consume()` takes any iterable or async iterable of strings. You can also call `stream.feed(token)` yourself and `await stream.finish()` at the end.

- **Stop button.** With `canStop: true`, Telegram sends a `stopped_message_generation` update when the user presses stop. Stop your LLM call and `await stream.cancel()`.
- **Errors.** A failed draft is logged and skipped; after three failures in a row, the stream stops sending drafts. The final message is not retried: if `sendFinal` throws, `finish()` rejects, so catch it and fall back.
- **Long replies.** Drafts show the tail of the text, but the final message is not split. If the reply can exceed one message, skip `sendFinal` and send `telegramifyRich()` (or `splitEntities()`) chunks yourself.
- **Groups and channels.** Drafts work in private chats only. Use `EditStream` there: it sends a message and edits it, at most once per second.

```ts
import { EditStream } from 'tg-md-msg';

const stream = new EditStream({
  mode: 'entity',
  sendMessage: async (p) => (await bot.api.sendMessage(chatId, p.text, { entities: p.entities as MessageEntity[] })).message_id,
  editMessage: (id, p) => bot.api.editMessageText(chatId, id, p.text, { entities: p.entities as MessageEntity[] }),
});
```

### Edit a message or inline result

Rendering doesn't depend on how the message is sent. Edits take the same output:

```ts
import { convert } from 'tg-md-msg';

const { text, entities } = convert(newMarkdown);
await bot.api.editMessageText(chatId, messageId, text, { entities: entities as MessageEntity[] });
```

An inline result is a single message, so a long reply has to be cut to its first chunk. Where only a `parse_mode` string is accepted, use MarkdownV2. Don't `slice()` a MarkdownV2 string: that can cut an escape sequence or an entity in half and Telegram rejects the result. `splitMarkdownV2()` cuts at safe points:

```ts
import { convert, splitMarkdownV2 } from 'tg-md-msg';

const { text, entities } = convert(reply);
const [first = ''] = splitMarkdownV2(text, entities, 4000);
await bot.api.editMessageTextInline(inlineMessageId, first, { parse_mode: 'MarkdownV2' });
```

For a short text, `markdownify(markdown)` returns the whole MarkdownV2 string in one call.

### Publish to Telegraph

For content too long for a chat, such as a whole conversation, render [Telegraph](https://telegra.ph/api) page content. `splitTelegraphNodes()` packs the nodes into pages under a byte budget:

```ts
import { toTelegraphNodes, splitTelegraphNodes } from 'tg-md-msg';

const pages = splitTelegraphNodes(toTelegraphNodes(markdown), 45_000);
for (const [i, content] of pages.entries()) {
  await fetch('https://api.telegra.ph/createPage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token, title: `Part ${i + 1}`, content }),
  });
}
```

Telegraph documents a 64 KB content limit but has been seen rejecting pages from about 54 KB of non-Latin text, so leave a margin. The output contains only tags and attributes Telegraph accepts: `#` and `##` become `h3`, deeper headings `h4`, tables become preformatted text, math becomes code, and spoilers become plain text.

### Configure rendering

Entity output, and so `convert()`, `telegramify()`, `markdownify()` and entity-mode streams, decorates some elements with symbols, such as an emoji before each heading. Change them globally once at startup:

```ts
import { getRuntimeConfig } from 'tg-md-msg';

const { markdownSymbol } = getRuntimeConfig();
markdownSymbol.headingLevel1 = '';
markdownSymbol.headingLevel2 = '';
markdownSymbol.image = '';
```

The global config is shared by every later call, including concurrent ones. For per-chat or per-request settings, pass your own instead:

```ts
import { RenderConfig, convert } from 'tg-md-msg';

const config = RenderConfig.isolated();
config.citeExpandable = false;
convert(markdown, { config });
```

The options, with defaults, are in the [API reference](docs/api.md#renderconfig). Rich and Telegraph output don't use them.

## Telegram limits

| Output | Limit | Library default |
|---|---|---|
| Text message | 4096 UTF-16 code units | `maxMessageLength: 4096` |
| Media caption | 1024 UTF-16 code units | none; split captions yourself |
| Rich message | 32,768 characters, 500 blocks, 50 media, 16 nesting levels, 20 table columns | `byteLimit: 32768`, `blockLimit: 500`, `mediaLimit: 50` |
| Draft | same as the message it previews | drafts show the tail |
| Telegraph page | 64 KB of content JSON | none; pass a budget |

Splitting with a small margin below the text limit, such as 3800–4000 instead of 4096, leaves room for anything you prepend later. The rich byte limit counts UTF-8 bytes of the HTML, which is always more than Telegram's character count, so it is a safe upper bound without a margin.

## Pitfalls

- **Send either `entities` or `parse_mode`, never both.** The output of `convert()` is plain text; parsed as MarkdownV2 it fails on characters like `.` and `!`.
- **Skip empty output.** `telegramify()` and `telegramifyRich()` return an empty array for whitespace-only input, but `richify('')` returns `{ html: '' }`, which Telegram rejects.
- **LaTeX.** `latexEscape: true` turns `\(\alpha\)` and `\[…\]` into Unicode (`α`). It is on by default for entities and MarkdownV2, and off for rich output, which renders `$…$` math natively. Turn it on for rich output when the model writes `\(…\)`.
- **Dollar amounts.** `$10 and $20` is read as prices, not as inline math, and a single `~` is not strikethrough.
- **Spoilers.** `||text||` becomes a spoiler in entity, MarkdownV2 and rich output, except inside code. Telegraph has no spoilers and shows the text.
- **Links Telegram can't open are dropped.** In entity output, a link whose URL Telegram would reject, such as `/guide`, `#top`, `javascript:…`, `tel:…` or `http://localhost`, keeps its text but loses the link; one invalid `text_link` would make Telegram reject the whole message. Rich messages and MarkdownV2 keep such links, and Telegram drops them on its side. To check entities you build yourself, use `isValidTextLinkUrl(url)`.

## Upgrading from 0.1

0.2.0 has breaking changes; see the [changelog](CHANGELOG.md#020) for all of them. The ones most likely to affect you:

- `InputRichMessage` now uses Telegram's field names: `is_rtl` and `skip_entity_detection` instead of `isRtl` and `skipEntityDetection`. Before, Telegram silently ignored the camelCase fields. If you converted the object yourself, pass it as-is now. `richify()` and `telegramifyRich()` options keep their camelCase names.
- An unchecked task item renders as `☐` instead of `☑️` in entity output.
- `> [!NOTE]` is no longer treated as a GitHub alert, so the label stays in the text.

## Credits

A port of [telegramify-markdown](https://github.com/sudoskys/telegramify-markdown) by sudoskys, with the parser replaced by [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark).

## License

[MIT](LICENSE)
