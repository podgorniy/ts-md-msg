# AI Agent Reference: tg-md-msg

## Table of Purpose
`tg-md-msg` is a Node.js/TypeScript library that converts Markdown into Telegram-compatible formats. It is a direct port of the Python project `telegramify-markdown`. It leverages a Rust native module (`pulldown-cmark` via N-API) to rapidly parse Markdown into an AST (event stream) with accurate UTF-16 code unit offsets. The TypeScript layer consumes this AST to enforce Telegram's strict formatting syntax and message length limits.

## Table of Contents & Meaning

### Native Layer (Rust)
- **`src/lib.rs`**: The Rust N-API entry point. Exposes `parse(markdown)` returning a serialized JSON array of `[Event, Range]` tuples. The ranges are mapped explicitly to UTF-16 code unit offsets.
- **`native/`**: The target directory where `napi build` outputs the `.node` binaries and their `index.js`/`index.d.ts` wrappers.
- **`build.rs` / `Cargo.toml`**: N-API configuration. Builds a `cdylib` `.node` binary.

### Core Logic (TypeScript)
- **`src/types.ts`**: TypeScript interface definitions matching the Rust AST (Events, Tags, Ranges). **Crucial for understanding the input shape.**
- **`src/converter.ts`**: Contains `EventWalker`, a state machine that iterates over the Rust AST. It manages tag depth, tracks text boundaries, and outputs intermediate `Segment` arrays and Telegram `MessageEntity` objects.
- **`src/pipeline.ts`**: The chunking and routing logic. Implements `telegramify()` and `markdownify()`. Responsible for slicing content into safe chunks (`Text` or `File`) that respect Telegram's message size limits.
- **`src/rich.ts`**: Implements `RichHtmlWalker`. Formats the output into Telegram's specialized Rich HTML format, handling strict tag rules (`<tg-spoiler>`, `<b>`, `<i>`, `<tg-math>`).
- **`src/mdv2.ts`**: The fallback MarkdownV2 stringifier. Safely escapes the ~20 mandatory Telegram special characters utilizing entity boundaries.
- **`src/entity.ts`**: Utilities for Telegram `MessageEntity` manipulation, slicing, and length calculation. 
- **`src/latex/`**: Mathematical mapping logic. `const.ts` contains massive symbol dicts; `helper.ts` manages translating LaTeX syntax into Unicode.
- **`src/content.ts`**: Abstract Data classes representing chunked output (`Text`, `File`, `Photo`).

### Infrastructure & Commands
- **`scripts/postinstall.js`**: Retrieves the correct pre-compiled `.node` binary from GitHub Releases on user installation.
- **`test/` & `tests/`**: `vitest` specifications validating both native binding integrity and TypeScript logic.
  - Commands: `npm run build` (builds Rust + TS), `npx vitest run` (runs tests).

## Technical Constraints & Design Decisions
1. **UTF-16 Offsets**: Telegram's API strictly requires entity offsets in UTF-16 code units. Because JavaScript strings are natively UTF-16, `ts-md-msg` handles offset slicing organically using standard `string.length` properties, completely avoiding the overhead of python's complex `utf16_len` conversions.
2. **Mermaid Rendering**: Porting of Mermaid rendering is intentionally deferred. Mermaid blocks currently fall back to standard code block handling.
3. **Dead Code (`render_html`)**: The Rust module exports `render_html`, but it is currently dead code. The TS layer (`rich.ts`) is strictly used to generate Telegram-safe HTML, rendering the native HTML export obsolete.
