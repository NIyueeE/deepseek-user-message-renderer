# DeepSeek User Message Markdown Renderer (Userscript)

Render user messages on [DeepSeek web](https://chat.deepseek.com) with
native-style Markdown, LaTeX math, and code highlighting. When the "edit"
button is clicked, the message box is restored to its original content so the
host app does not crash.

The renderer **never removes** DeepSeek's original message nodes; it hides them
with styles and mounts an additional render container. This keeps the references
held by the host app (React) valid, so editing or re-rendering does not throw
`NotFoundError` and crash the page.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Create a new script and paste the contents of
   [`src/deepseek-user-message-renderer.user.js`](src/deepseek-user-message-renderer.user.js),
   or use Tampermonkey's "Import from file" to load it directly.
3. Open DeepSeek web. The script loads marked / highlight.js / KaTeX from CDNs
   via `@require`.

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
- [`test/render.test.ts`](test/render.test.ts): Markdown, code blocks, style
  classes, resource injection, and keeping original nodes intact.
- [`test/security.test.ts`](test/security.test.ts): dangerous HTML (event
  handlers, `javascript:` protocol, unknown tags) is escaped; legal tags are kept.
- [`test/edit-restore.test.ts`](test/edit-restore.test.ts): restoring the
  message box on edit click, re-rendering after submit, and skipping rendering
  in edit state.
- [`test/marked-quirk.test.ts`](test/marked-quirk.test.ts): documents a marked 12
  parsing quirk (a code fence directly after a paragraph whose content is `---`
  is treated as a setext heading) and the correct behavior with a blank line.
