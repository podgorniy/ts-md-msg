# Contributing

## Setup

Requires Node.js 22 (as in CI) and a stable [Rust toolchain](https://rustup.rs).

```bash
git clone https://github.com/podgorniy/ts-md-msg.git
cd ts-md-msg
SKIP_POSTINSTALL=1 npm install   # don't download a release binary; you build your own
npm run build                     # Rust module into native/, then TypeScript into dist/
npm test
```

| Script | |
|---|---|
| `npm run build:rust` | Build the native module for this machine into `native/` |
| `npm run build:ts` | Compile `src/` into `dist/` |
| `npm run build` | Both |
| `npm test` | Run all tests with vitest |

`dist/` and `native/index.{js,d.ts}` are committed, because the package is installed from GitHub without a build step. Rebuild and commit them with every source change. The `.node` binaries are not committed; they come from releases.

## Layout

| Path | |
|---|---|
| `src/lib.rs` | Rust parser binding. `parse()` returns pulldown-cmark's events as JSON. |
| `src/converter.ts` | Shared parse step (LaTeX, spoilers, price `$` handling) and the entity renderer |
| `src/pipeline.ts` | `telegramify()`, `markdownify()` |
| `src/rich.ts` | Rich HTML renderer and splitter |
| `src/mdv2.ts` | MarkdownV2 output and splitting |
| `src/telegraph.ts` | Telegraph renderer and splitter |
| `src/stream/` | `DraftStream`, `EditStream`, `StreamCore` |
| `src/latex/` | LaTeX to Unicode tables |
| `tests/` | vitest specs; `server.spec.ts` runs against the live Bot API |
| `scripts/postinstall.js` | Downloads the release binary on install |

Two rules the code relies on:

- Parser ranges are **UTF-8 byte offsets**. Index the source with a `Buffer`, never the JS string.
- Telegram entity offsets are **UTF-16 code units**, which is what JS string indices are.

## Live tests

`tests/server.spec.ts` sends real messages, checks that Telegram accepts them and deletes them again. It is skipped unless both variables are set, in the environment or in `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC…
TELEGRAM_CHAT_ID=123456789   # a chat the bot can post in; message the bot once first
```

Never commit a token. In CI they come from the repository secrets of the same names.

## Changes

Behaviour changes need a test and a changeset:

```bash
npx changeset   # pick the bump, describe the change for users
```

Breaking changes are a minor bump while the version is 0.x.

## Releasing

Installs download the binary from the GitHub Release that matches the `package.json` version, so a version is usable only once its release exists.

1. `npx changeset version`: bumps `package.json`, writes `CHANGELOG.md` and removes the consumed changesets. Bump `package-lock.json` to match.
2. Update the expected version in `native/index.js` (search for the old version), or rebuild with `npm run build:rust`.
3. `npm run build && npm test`, then commit as `vX.Y.Z`.
4. Tag and push: `git tag -a vX.Y.Z -m vX.Y.Z && git push origin dev vX.Y.Z`.

Pushing the tag starts `.github/workflows/release.yml`, which builds the binary for all seven targets and creates the GitHub Release with them attached. Check it with `gh release view vX.Y.Z`: it should list seven `.node` files.

## Upstream

This is a port of [telegramify-markdown](https://github.com/sudoskys/telegramify-markdown). When porting from it, note the upstream version in the changeset, and keep durations in milliseconds and options in camelCase, while Telegram payloads stay snake_case.
