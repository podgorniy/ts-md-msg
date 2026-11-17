# AI Agent Reference: tg-md-msg

## Table of Purpose
`tg-md-msg` is a Node.js/TypeScript library that converts Markdown into Telegram-compatible formats. It is a direct port of the Python project `telegramify-markdown`. It leverages a Rust native module (`pulldown-cmark` via N-API) to rapidly parse Markdown into an AST (event stream) whose source ranges are UTF-8 byte offsets. The TypeScript layer consumes this AST to enforce Telegram's strict formatting syntax and message length limits.

## Table of Contents & Meaning

### Native Layer (Rust)
- **`src/lib.rs`**: The Rust N-API entry point. Exposes `parse(markdown)` returning a serialized JSON array of `[Event, Range]` tuples. Ranges are pulldown-cmark's UTF-8 byte offsets; TS code that indexes the source with them must use a `Buffer`, never the JS string.
- **`native/`**: The target directory where `napi build` outputs the `.node` binaries and their `index.js`/`index.d.ts` wrappers.
- **`build.rs` / `Cargo.toml`**: N-API configuration. Builds a `cdylib` `.node` binary.

### Core Logic (TypeScript)
- **`src/types.ts`**: TypeScript interface definitions matching the Rust AST (Events, Tags, Ranges). **Crucial for understanding the input shape.**
- **`src/converter.ts`**: `parseMarkdown()` is the single parse entry point shared by every backend (LaTeX escape, parser-aware spoiler preprocessing, and re-parsing with `$`-price / single-`~` delimiters escaped). Contains `EventWalker`, a state machine that iterates over the Rust AST. It manages tag depth, tracks text boundaries, and outputs intermediate `Segment` arrays and Telegram `MessageEntity` objects.
- **`src/pipeline.ts`**: The chunking and routing logic. `processMarkdown()` is the core implementation; `telegramify()` is an alias that delegates to it. Also implements `markdownify()`. Responsible for slicing content into safe chunks (`Text` or `File`) that respect Telegram's message size limits.
- **`src/rich.ts`**: Implements `RichHtmlWalker`. Formats the output into Telegram's specialized Rich HTML format, handling strict tag rules (`<tg-spoiler>`, `<b>`, `<i>`, `<tg-math>`). Exports `richify()`, `splitRich()`, and `telegramifyRich()` (exact block-boundary splitting). `InputRichMessage` is Telegram's snake_case wire shape. Splitting budgets bytes, Telegram-counted blocks (nested blocks, `<li>`, `<tr>`) and media; media are standalone blocks, never inside `<p>`.
- **`src/telegraph.ts`**: `TelegraphWalker` renders the same parse into Telegraph `Node[]` (whitelisted tags, `href`/`src` only). Exports `toTelegraphNodes()`, `splitTelegraphNodes()` (byte-budget page packing), `telegraphByteLength()`, `isTelegraphSafe()`.
- **`src/mdv2.ts`**: The fallback MarkdownV2 stringifier. Safely escapes the ~20 mandatory Telegram special characters utilizing entity boundaries.
- **`src/entity.ts`**: Utilities for Telegram `MessageEntity` manipulation, slicing, and length calculation. 
- **`src/latex/`**: Mathematical mapping logic. `const.ts` contains massive symbol dicts; `helper.ts` manages translating LaTeX syntax into Unicode.
- **`src/stream/`**: `StreamCore` (buffer, throttle, keepalive) composed by `DraftStream` (sendMessageDraft / sendRichMessageDraft) and `EditStream` (sendMessage + editMessageText). Transport is injected; durations are milliseconds.
- **`src/content.ts`**: Abstract Data classes representing chunked output (`Text`, `File`, `Photo`).

### Infrastructure & Commands
- **`.changeset/`**: Changesets are used to manage versioning, changelogs, and publishing workflows.
- **`.github/workflows/ci.yml`**: GitHub Actions automated testing and builds.
- **`scripts/postinstall.js`**: Retrieves the correct pre-compiled `.node` binary from GitHub Releases on user installation.
- **`test/` & `tests/`**: `vitest` specifications validating native binding integrity, TypeScript logic, and integration against the live Telegram API (`tests/server.spec.ts`).
  - `tests/server.spec.ts` runs only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set (env or `.env`).
  - Commands: `npm run build` (builds Rust + TS), `npm run test` (runs tests), `npx changeset` (to document changes).

## Technical Constraints & Design Decisions
1. **UTF-16 Offsets**: Telegram's API strictly requires entity offsets in UTF-16 code units. Because JavaScript strings are natively UTF-16, `ts-md-msg` handles offset slicing organically using standard `string.length` properties, completely avoiding the overhead of python's complex `utf16_len` conversions.
2. **Mermaid Rendering**: Porting of Mermaid rendering is intentionally deferred. With `renderMermaid` on (default), `telegramify()` emits Mermaid blocks as `mermaid.txt` files; with it off they are ordinary code blocks.
3. **Dead Code (`render_html`)**: The Rust module exports `render_html`, but it is currently dead code. The TS layer (`rich.ts`) is strictly used to generate Telegram-safe HTML, rendering the native HTML export obsolete.

## Documentation
- **`README.md`**: integrator guide (choosing a format, recipes, limits, pitfalls).
- **`docs/api.md`**: full public API reference. Update it with any exported signature or default change.
- **`CONTRIBUTING.md`**: build, live tests, release procedure.
