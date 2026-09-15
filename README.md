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
  A blank line still ends a blockquote, list item, or table body instead of
  letting the next line be absorbed as a Markdown lazy continuation (so
  `> test` + blank line + `你好` no longer quotes both lines).
- **Assistant raw/rendered toggle**: every assistant reply gets a native-style
  button next to its copy button that switches between the rendered Markdown
  (default) and the exact raw Markdown source the assistant produced, read from
  the React tree (the reply's `markdown` prop — never the reasoning chain's
  `content`). It is a pure view switch: the message's own DOM is never mutated,
  toggling is lossless, and the button stays consistent across re-renders. The
  button is a clone of the neighbouring native action button, placed at the far
  right of the action row, so it inherits the host's own hover/active/focus
  styling; its `</>` icon adopts the native icon's geometry (same box, scale,
  stroke and colour) and its hint is a tooltip drawn from the page's own tooltip
  tokens rather than the browser's title box.
  The raw source is rendered the way DeepSeek renders any fenced block — a
  native `md-code-block` with the language banner (`markdown`), the monospace
  code face and the page's own Prism token colours — and rebuilt when the
  light/dark theme changes, so the two views are unmistakable at a glance while
  still looking native rather than bolted on. The source stays literal text:
  highlight.js escapes it into the markup, never live HTML.
  (The banner, frame and token colours come from the page's own `md-code-block`
  rules, so a build that ships them differently will restyle this view too; the
  code face and code background come from the page's code tokens, which the
  script applies itself because not every captured build consumes them.)
- **LaTeX math** via KaTeX: `$...$`, `$$...$$`, `\(...\)`, `\[...\]`.
- **Code blocks rebuilt into DeepSeek's official `md-code-block` structure**:
  banner with the language label, native light/dark theme, corner decorations,
  and Prism-style token colors from the page's own stylesheet. The structure is
  built for every block, not only the ones highlight.js can colour, so a `text`
  or `mermaid` fence still gets its native frame.
- **Hard line breaks preserved** in code blocks; unknown languages (e.g.
  `mermaid`) stay as clean code blocks without console warnings.
- **Scans that settle**: the observer only schedules a pass when a message
  actually needs work (never rendered, text edited in place, or theme moved) or
  when an assistant action bar / our own toggle appears. A raw view that is
  already correct is never rebuilt, so an open view cannot loop through the
  microtask queue and starve the page's timers.
- **Safe editing**: clicking "edit" restores the original message before
  DeepSeek reads it, so the editor never crashes; cancel re-renders the
  message; empty edit placeholders are cleaned up.
- **In-place rendering**: the original message text element (hashed class
  `fbb737a4`; `_8271fc3` only marks messages with an attachment) is transformed
  into DeepSeek's native `ds-markdown` structure (paragraphs carry
  `ds-markdown-paragraph`), so no extra bubble is created — attachment cards
  and the native bubble layout stay intact. Long messages wrapped in DeepSeek's
  collapsible container (`ds-collapsible-text`) render into a sibling container
  instead, so the host app's own child nodes stay in the DOM (hidden by a
  stylesheet rule that keeps them measurable) and its collapse/expand commits
  never break — the toggle keeps working, and the expanded view is resized to
  fit the rendered Markdown.
- **Live-build fidelity**: geometry, selectors and styling were re-derived from
  a captured live page (see `test/fixtures/`), and the dark-theme check follows
  the build's own `data-ds-dark-theme` marker instead of an obsolete `dark`
  class.
- **Native history highlight**: because the original bubble is never replaced,
  DeepSeek's history-item highlight works as-is without any mirroring.
- **Never removes DeepSeek's original nodes** — flat messages render in place,
  and collapsible messages keep the host's own child nodes in the DOM (only
  visually hidden, and still measurable), so the references held by the host
  app (React) stay valid and its commits never throw `NotFoundError`.

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
  block-boundary guards, and keeping original nodes intact.
- [`test/security.test.ts`](test/security.test.ts): dangerous HTML is escaped —
  blocked tags (`iframe` / `base` / `meta` / `form` / `style` / ...), event
  handlers, dangerous URL schemes (including character-reference smuggling),
  and unsafe Markdown links/images; safe tags and harmless attribute values are
  kept.
- [`test/edit-restore.test.ts`](test/edit-restore.test.ts): restoring the
  message box on edit click, re-rendering after submit, skipping rendering in
  edit state.
- [`test/collapsible.test.ts`](test/collapsible.test.ts): long messages wrapped
  in DeepSeek's collapsible container render into a sibling container while the
  host's own child nodes stay alive; toggle re-checks, edit restore, cancel
  re-render, theme rebuild, and stale-height handling on expand.
- [`test/assistant-raw.test.ts`](test/assistant-raw.test.ts): the assistant
  raw/rendered toggle — injection into the copy button's row, default rendered
  state, the native code-block frame of the raw view, lossless toggling,
  idempotency across scans (including a regression guard proving an open view is
  never rebuilt and page timers keep firing), re-injection after a host
  re-render, per-message independence, and user messages staying untouched.
- [`test/code-block.test.ts`](test/code-block.test.ts): code blocks on a page
  where highlight.js never loaded (the CDN `@require` failed) still get the
  native frame, unknown/plain languages keep their source verbatim, the
  light/dark variant follows the page's `data-ds-dark-theme` marker, and a theme
  switch rebuilds the raw view instead of leaving a stale variant behind.
- [`test/real-dom.test.ts`](test/real-dom.test.ts): integration tests against
  [`test/fixtures/deepseek-chat.html`](test/fixtures/deepseek-chat.html), a
  verbatim capture of a live chat page (real markup plus the page's own
  stylesheet). Hand-written fixtures cannot notice that DeepSeek renamed or
  restructured something — they always agree with the selectors the test author
  wrote — so these tests assert the script's selectors, the user-message shape,
  the collapsible wrapper and the assistant action bar against the page as it
  actually is. If DeepSeek ships a new UI they fail and point at what moved.
  The capture keeps the DOM but not React's internals, so the assistant reply's
  source is supplied by a synthetic fibre shaped like the live one.

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
