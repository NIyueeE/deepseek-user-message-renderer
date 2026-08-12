# DeepSeek User Message Markdown Renderer

[![CI](https://github.com/NIyueeE/deepseek-user-message-renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/NIyueeE/deepseek-user-message-renderer/actions/workflows/ci.yml)

A userscript that renders **your own messages** on
[DeepSeek web](https://chat.deepseek.com) with the same native-style Markdown,
LaTeX math, and code blocks as the assistant's replies — without breaking
editing, re-rendering, or the history-item highlight.

> Tested against the current DeepSeek web build. The script relies on some
> hashed CSS class names (e.g. `_9663006`) that DeepSeek occasionally changes;
> a small header/class update may be needed after their big UI releases.

## Features

- **Native-style Markdown**: headings, paragraphs, lists, inline code, links,
  and blockquotes rendered like DeepSeek's own markdown; a single newline is a
  soft line break (GFM style), so multi-line input keeps its line breaks.
- **LaTeX math** via KaTeX: `$...$`, `$$...$$`, `\(...\)`, `\[...\]`.
- **Code blocks rebuilt into DeepSeek's official `md-code-block` structure**:
  banner with the language label, native light/dark theme, corner decorations,
  and Prism-style token colors from the page's own stylesheet.
- **Hard line breaks preserved** in code blocks; unknown languages (e.g.
  `mermaid`) stay as clean code blocks without console warnings.
- **Safe editing**: clicking "edit" restores the original message before
  DeepSeek reads it, so the editor never crashes; cancel re-renders the
  message; empty edit placeholders are cleaned up.
- **In-place rendering**: the original message text element (hashed class
  `fbb737a4`; `_8271fc3` only marks messages with an attachment) is transformed
  into DeepSeek's native `ds-markdown` structure (paragraphs carry
  `ds-markdown-paragraph`), so no extra bubble is created and nothing is
  hidden — attachment cards and the native bubble layout stay intact.
- **Native history highlight**: because the original bubble is never replaced,
  DeepSeek's history-item highlight works as-is without any mirroring.
- **Never removes or hides DeepSeek's original nodes** — the text element is
  rendered in place, so the references held by the host app (React) stay valid
  and re-rendering never throws `NotFoundError`.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the raw script below — Tampermonkey will offer to install it:

   <https://raw.githubusercontent.com/NIyueeE/deepseek-user-message-renderer/master/src/deepseek-user-message-renderer.user.js>

   Or copy the contents of
   [`src/deepseek-user-message-renderer.user.js`](src/deepseek-user-message-renderer.user.js)
   into a new Tampermonkey script manually.
3. Open <https://chat.deepseek.com>. The script loads marked / highlight.js /
   KaTeX from CDNs via `@require`.

> The script auto-updates from GitHub when `@updateURL` / `@downloadURL` are
> enabled in Tampermonkey.

## Development

```bash
bun install       # install dependencies
bun test          # run tests in a simulated Tampermonkey + browser environment
bun run lint      # Biome static checks
bun run lint:fix  # auto-fix formatting and lint issues
```

## Test structure

- [`test/env.ts`](test/env.ts): simulates the browser DOM / MutationObserver /
  events with happy-dom, stubs the Tampermonkey APIs `GM_addStyle` and
  `GM_getResourceText`, and exposes the same `marked` version as the production
  script. Each test file runs in an isolated process.
- [`test/render.test.ts`](test/render.test.ts): Markdown, native `md-code-block`
  structure, hard line breaks, style classes, resource injection, dark mode,
  and keeping original nodes intact.
- [`test/security.test.ts`](test/security.test.ts): dangerous HTML (event
  handlers, `javascript:` protocol, unknown tags) is escaped; legal tags are
  kept.
- [`test/edit-restore.test.ts`](test/edit-restore.test.ts): restoring the
  message box on edit click, re-rendering after submit, skipping rendering in
  edit state.
- [`test/marked-quirk.test.ts`](test/marked-quirk.test.ts): regression guard
  for marked 18 (a code fence directly after a paragraph whose content is
  `---` parses as a code block; marked <=12 misparsed it as a setext heading).

## CI / Release

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint + tests on
  every push and pull request.
- [`.github/workflows/release.yml`](.github/workflows/release.yml) builds the
  script and creates a GitHub Release for every `v*` tag. It also publishes to
  GreasyFork when the `GFU` / `GFP` / `GREASYFORK_TOTP_SECRET` secrets are
  configured (GreasyFork has no official API, so the workflow signs in with
  these credentials and imports the script from the raw GitHub URL).
- **OpenUserJS** has no publishing API for regular users (its `/api` endpoints
  are admin-only), so publishing there is manual: upload the script at
  <https://openuserjs.org/user/add/scripts>, or log in with GitHub and import
  it from this repository. The script metadata includes `@license MIT`, which
  OpenUserJS requires.

## License

Released under the [MIT License](LICENSE).
