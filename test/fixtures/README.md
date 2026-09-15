# Fixtures

## `deepseek-chat.html` — the real capture

A verbatim capture of a live DeepSeek chat page. It is the **ground truth** for
the userscript: hand-written fixtures (in `test/env.ts`) always agree with the
selectors their author wrote, so they can never notice that DeepSeek renamed or
restructured something. This one can.

`DO NOT hand-edit` the capture. If it is stale, re-capture it.

Every capture is paired with a `*.provenance.json` sidecar recording where it came
from, when, in which theme, and — importantly — **what it is known to lack**:

```json
{
    "source": "https://chat.deepseek.com/ ...",
    "capturedAt": "2026-08-29",
    "theme": "light",
    "intentionalGaps": ["syntax-token-palette", "code-typography-consumed", "dark-theme-capture"],
    "knownDeficiencies": ["..."]
}
```

The sidecar exists because a capture can look complete while quietly missing a
whole category of styling. The 2026-08-29 capture had no `<link>` and no
`@import`, so every external stylesheet — including, most likely, the
syntax-highlighting theme — was silently absent. Nothing failed; the styling
tests simply stopped verifying anything real. Now those absences must be declared,
and `test/fixture-contract.test.ts` verifies each declaration against the file
(a declared gap that is actually *present* is also an error, so the list cannot
rot).

## The contract

`test/fixture-contract.ts` defines what a capture must satisfy:

| Kind | Examples |
| --- | --- |
| DOM anchors | `._9663006`, `div.fbb737a4`, `.ds-collapsible-text`, `._4f9bf79`, `.ds-assistant-message-main-content`, the action bar's `[role=button]`, the thinking-chain marker |
| Design tokens | `--ds-font-family-code`, `--dsw-font-markdown-code-*`, `--dsw-alias-markdown-code-block`, `--dsw-alias-label-primary`, tooltip tokens |
| CSS features | `md-code-block` frame + both theme variants, `data-ds-dark-theme` rules, `.ds-markdown`, `.ds-button`, and two that may be declared as gaps: a `.token` colour palette, and a rule that consumes the code font token |

Check it offline (no browser, no network):

```bash
bun run fixture:check
```

This also runs as part of `bun test`, so CI fails on every push when a capture no
longer matches the contract.

## Re-capturing

```bash
bun run fixture:capture            # light theme
bun run fixture:capture -- --dark  # light + dark
```

Requires Playwright, which is deliberately kept out of the repo to keep CI light:

```bash
mkdir -p /tmp/dsr-capture && cd /tmp/dsr-capture
echo '{"private":true}' > package.json
bun add playwright && bunx playwright install chromium
cd /tmp/dsr-capture && bun /path/to/repo/scripts/fixture-capture.ts
```

The script opens a real (headed) Chromium so you can log in, then waits for Enter.
Before saving it **inlines every stylesheet via CSSOM** — this is the fix for the
old capture's missing vendor CSS — and reports how many rules it got and whether
any cross-origin sheet was skipped.

### What the conversation you capture must contain

The capture is only as good as the conversation in it:

- **An assistant reply** with: a `js` and a `python` fence, a `text` fence, an
  unlabelled fence, inline code, a formula, a table, a blockquote, a nested list,
  and a reasoning chain (`已思考`).
- **A user message** long enough to trigger the collapsible wrapper, and one with
  a fenced code block and CJK text.
- Capture **both themes** (`--dark`).

Then diff what the script does against the *real* elements in the capture — a
real rendered code block is the only way to confirm the rebuilt `md-code-block`
matches DeepSeek's own output.
