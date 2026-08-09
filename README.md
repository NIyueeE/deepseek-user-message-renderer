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
  and blockquotes rendered like DeepSeek's own markdown.
- **LaTeX math** via KaTeX: `$...$`, `$$...$$`, `\(...\)`, `\[...\]`.
- **Code blocks rebuilt into DeepSeek's official `md-code-block` structure**:
  banner with the language label, native light/dark theme, corner decorations,
  and Prism-style token colors from the page's own stylesheet.
- **Hard line breaks preserved** in code blocks; unknown languages (e.g.
  `mermaid`) stay as clean code blocks without console warnings.
- **Safe editing**: clicking "edit" restores the original message before
  DeepSeek reads it, so the editor never crashes; cancel re-renders the
  message; empty edit placeholders are cleaned up.
- **History highlight mirrored**: clicking a message in the history panel
  flashes the bubble and fades it back out, matching the native behavior.
- **Never removes DeepSeek's original nodes** — they are hidden with CSS only,
  so the references held by the host app (React) stay valid and re-rendering
  never throws `NotFoundError`.

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
  edit state, and mirroring the history-item highlight.
- [`test/marked-quirk.test.ts`](test/marked-quirk.test.ts): documents a marked
  12 parsing quirk (a code fence directly after a paragraph whose content is
  `---` is treated as a setext heading) and the correct behavior with a blank
  line.

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
