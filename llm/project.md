# Project Technical Overview: tg-md-msg

This project is a hybrid Node.js and Rust native module designed to provide high-performance Markdown parsing and rendering capabilities to JavaScript environments. It uses **napi-rs** to bind the Rust-based `pulldown-cmark` crate to Node.js.

## Project Structure and Main Files

### 1. Rust Native Module (Core Logic)
The core Markdown processing logic is implemented in Rust for memory safety and maximum performance.

*   **`src/lib.rs`**: The main entry point for the Rust native module. Uses `napi-derive` macros to expose the following to JS:
    *   `render_html`: Takes Markdown text and configuration options, returning rendered HTML string.
    *   `parse`: Takes Markdown text, parses it into an Event stream AST, and returns it as a serialized JSON string.
    *   `MarkdownOptions`: A struct seamlessly mapping JS config objects to `pulldown-cmark` bitflags.
*   **`Cargo.toml`**: The Rust manifest. Configures the crate as a `cdylib` (C dynamic library) to build the `.node` binary. Manages dependencies (`napi`, `pulldown-cmark`, `serde`).
*   **`build.rs`**: A build script executing `napi-build` setup required to link the native bindings correctly.

### 2. TypeScript/Node.js Layer (API Surface)
This layer provides the interface for Node.js apps to consume the native bindings natively.

*   **`src/index.ts`**: The main entry point for the Node.js package. It imports the generated native bindings and re-exports them cleanly under an `md` namespace.
*   **`package.json`**: The NPM manifest. Configures the package as an ES Module (`"type": "module"`) and handles the build orchestration:
    *   `build:rust`: Compiles the Rust module using `@napi-rs/cli` (`napi build`).
    *   `build`: Runs the Rust build followed by the TypeScript compiler (`tsc`).
    *   `test`: Runs the `vitest` test suite.
    *   `postinstall`: Executes `scripts/postinstall.js` to fetch pre-built native binaries from GitHub releases when installed via git.
*   **`test/index.test.ts`**: Uses `vitest` to verify that the native `renderHtml` and `parse` functions operate correctly.
*   **`scripts/postinstall.js`**: An OS-aware downloader that fetches the correct `.node` binary for the user's platform/architecture upon installation.
*   **`tsconfig.json`**: Configures the TypeScript compiler (`tsc`) to target `ES2022` and `NodeNext` resolution, ensuring modern JS environment compatibility.

### 3. Build Artifacts (Generated)
*   **`native/*.node` (e.g., `native/index.darwin-arm64.node`)**: The compiled native C++ dynamic library containing the Rust execution logic. These are *gitignored* and distributed via GitHub releases.
*   **`native/index.js` & `native/index.d.ts`**: The N-API generated JS wrapper and TS definitions interfacing directly with the `.node` binary. Unlike the `.node` binaries, these **are** checked into version control to allow consumers to compile TypeScript even before the `.node` binary is downloaded.
*   **`dist/`**: Contains the final TypeScript-compiled code (like `dist/index.js`) which correctly resolves the native bindings from the `native/` directory.

### 4. CI/CD and GitHub-Only Distribution
This project relies purely on GitHub for distribution, entirely avoiding the NPM public registry.

*   **`.changeset/`**: Configures Changesets. Running `npx changeset` logs changes, which automatically bumps versions and generates `CHANGELOG.md` upon merging.
*   **`.github/workflows/changesets.yml`**: A GitHub Action that runs on pushes to `prod`, automatically scaffolding Version PRs and managing Git tags.
*   **`.github/workflows/release.yml`**: A massive cross-platform build matrix that triggers on new Git tags (`v*`). It compiles the Rust module across Windows, macOS, and Linux (including cross-compiling for Alpine `musl` and Linux `arm64`) and uploads the `.node` binaries directly as GitHub Release assets.
