# tg-md-msg

## 0.2.1

### Patch Changes

- Entity output no longer contains links Telegram rejects. Telegram refuses the whole message when one `text_link` has an invalid URL, so `[docs](/guide)`, `#anchors`, `javascript:`, `tel:`, `ftp:`, `http://localhost` and malformed URLs now keep their text but lose the link in `convert()`, `telegramify()`, `markdownify()` and entity-mode streams. The check is a port of Telegram's own (tdlib `check_link`), verified against the live Bot API, and is exported as `isValidTextLinkUrl()`. Rich messages are unchanged: Telegram drops invalid links there itself.

## 0.2.0

### Minor Changes

- Catch up with telegramify-markdown 1.4.2 and Telegram Bot API 10.4.

  **Breaking**

  - `InputRichMessage` now has Telegram's wire shape (`is_rtl`, `skip_entity_detection`, `media`), so it can be passed as `rich_message` directly. Before, the camelCase `isRtl` / `skipEntityDetection` fields were silently dropped by Telegram. `richify()` options keep their camelCase names.
  - `telegramifyRich()` options gain `media` and `mediaLimit`; `RichBlock` gains `mediaCount`.
  - Default `taskUncompleted` symbol is `☐` (was `☑️`, which reads as checked).
  - GFM blockquote alerts are no longer parsed, so `> [!NOTE]` keeps its label text instead of losing it.

  **Rich messages**

  - Task lists render as native checkboxes.
  - Images are standalone media blocks, never inside `<p>`. Titles become `<figcaption>` captions, and the file extension selects `<video>`, `<audio>` or `<tg-document>`. `tg://photo|video|audio|document?id=` links work with the new `media` option.
  - Footnote definitions emit `<tg-reference name="…">`; before, the `name` was missing, so references linked nowhere.
  - Bare `<u>`, `<ins>`, `<sub>`, `<sup>`, `<mark>`… inline tags pass through (and map to entities in `convert()`).
  - Splitting counts blocks the way Telegram does (nested blocks, list items, table rows) and enforces the 50-media limit. Oversized lists, quotes and tables split by child, and ordered lists keep their numbering. Oversized paragraphs keep their inline formatting.
  - `telegramifyRich()` splits at exact source block boundaries. An HTML block no longer merges everything after it into one block.
  - Fixed: splitting an oversized code block produced invalid HTML (`</code>` swallowed), and `splitRich()` dropped bare text between blocks.

  **Entities / MarkdownV2**

  - Fixed blank lines between blocks being lost after non-ASCII text (byte vs. string offsets) and after lists.
  - `$10 … $20` reads as prices, not inline math, and a single `~` no longer starts a strikethrough.
  - Spoiler preprocessing skips fenced, `~~~` and indented code, and no longer drops spoilers that start with a newline.
  - Fixed an image inside a table cell leaking its symbol ahead of the table.
  - `config` is accepted by `telegramify()` and `markdownify()`. Added `RenderConfig.isolated()` / `copy()` and the `unorderedListItem` / `orderedListSuffix` symbols.
  - Faster MarkdownV2 blockquote lookup and string offsets.

  **New: streaming**

  - `DraftStream` / `EditStream` / `StreamCore`: throttled streaming through `sendMessageDraft`, `sendRichMessageDraft` or message edits, with `can_stop` / `keep_on_stop` (Bot API 10.3).

  **Maintenance**

  - napi 3.16, pulldown-cmark 0.13.6, @napi-rs/cli 3.10, vitest 4.1.12. Added `@types/node`, without which `tsc` reported errors on every build.
  - The live test reads `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` from the environment or `.env` instead of a hardcoded token.

## 0.1.1

### Patch Changes

- Dist

## 0.1.0

Initial implementation. Functionality from https://github.com/sudoskys/telegramify-markdown is ported (including rust Markdown parser) except mermaid rendering.
