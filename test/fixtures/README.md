# Fixtures

Real captures of DeepSeek's chat page. They are the **ground truth** for this
userscript: hand-written fixtures (in `test/env.ts`) always agree with the
selectors their author wrote, so they can never notice that DeepSeek renamed or
restructured something. These can.

`DO NOT hand-edit` a capture. If one is stale, re-capture it.

## What is here

| Fixture | What it is | Use it for |
| --- | --- | --- |
| `deepseek-chat.html` | 2026-09-15 capture of a live conversation. **Kept the external stylesheets** (36 `<style>` blocks, ~512 KB): real syntax palette, code-block frame rules, real rendered code blocks (javascript, python) with 34 live token spans. | Everything: selectors, structure, and **styling** |
| `deepseek-bugcase.html` | 2026-08-29 capture whose conversation contains the blockquote regression (`> test` + blank line + `你好`). Its external stylesheets were dropped by the save. | Selector + content regressions only — **not** styling |

Each is paired with a `*.provenance.json` sidecar recording where it came from,
when, in which theme, and — importantly — **what it is known to lack**:

```json
{
    "source": "https://chat.deepseek.com/...",
    "capturedAt": "2026-09-15",
    "theme": "light",
    "intentionalGaps": ["dark-theme-capture"],
    "notes": ["..."]
}
```

The sidecar exists because a capture can look complete while quietly missing a
whole category of styling. The 2026-08-29 capture had no `<link>` and no
`@import`, so every external stylesheet — including the syntax palette — was
silently absent. Nothing failed; the styling tests simply stopped verifying
anything real. Now those absences must be declared, and
`test/fixture-contract.test.ts` verifies each declaration against the file (a
declared gap that is actually *present* is also an error, so the list cannot
rot).

## The contract

`test/fixture-contract.ts` defines what a capture must satisfy:

| Kind | Examples |
| --- | --- |
| DOM anchors | `._9663006`, `div.fbb737a4`, `.ds-collapsible-text`, `._4f9bf79`, `.ds-assistant-message-main-content`, the action bar's `[role=button]`, the thinking-chain marker |
| Design tokens | `--ds-font-family-code`, `--dsw-font-markdown-code-*`, `--dsw-alias-markdown-code-block*`, `--dsw-alias-label-primary`, tooltip tokens |
| CSS features | `md-code-block` frame + both theme variants, `data-ds-dark-theme` rules, `.ds-markdown`, `.ds-button`, and two that may be declared as gaps: a **content** `.token` colour palette, and a rule that actually applies the code font token |

Every `*.html` with a sidecar is audited. Check offline (no browser, no network):

```bash
bun run fixture:check              # all fixtures
bun run fixture:check deepseek-chat  # one fixture
```

This also runs as part of `bun test`, so CI fails on every push when a capture no
longer matches the contract.

`test/fixture-contract-probes.test.ts` unit-tests the probes themselves: they
decide whether a capture "has" a feature, and two subtle bugs in them once
declared a degraded capture complete.

## Parity: diffing our output against DeepSeek's own

Because `deepseek-chat.html` kept the stylesheets, it contains blocks **DeepSeek
rendered**. `scripts/fixture-parity.mjs` renders a javascript fence through the
userscript on that same page and diffs the two blocks:

```bash
bun run fixture:parity
```

It compares structure (wrapper classes, child order, banner, corners), the frame
(radius, margin, background), typography (family, size, line height, background
placement) and **computed token colours for every kind both blocks contain**.

This is the only check that can answer a styling question, and it needs a real
browser, so it is not part of `bun test`. Requires Playwright in a scratch dir
(see the script header). It found two real bugs the first time it ran: the raw
view was 14px instead of the code block's 13px (it used the *inline-code* token),
and it painted its own background over the frame's.

## Re-capturing

```bash
bun run fixture:capture            # light theme
bun run fixture:capture -- --dark  # light + dark
```

Requires Playwright, deliberately kept out of the repo so CI stays light:

```bash
mkdir -p /tmp/dsr-capture && cd /tmp/dsr-capture
echo '{"private":true}' > package.json
bun add playwright && bunx playwright install chromium
cd /tmp/dsr-capture && bun /path/to/repo/scripts/fixture-capture.ts
```

The script opens a real (headed) Chromium so you can log in, then waits for Enter.
Before saving it **inlines every stylesheet via CSSOM** — the fix for the
2026-08-29 capture's missing vendor CSS — and reports how many rules it got and
whether any cross-origin sheet was skipped.

To evaluate a capture before adopting it, `scripts/inspect-capture.ts <file>`
prints its counts, message contents and code-block skeletons.

### What the conversation you capture must contain

The capture is only as good as the conversation in it:

- **An assistant reply** with: a `js` and a `python` fence, a `text` fence, an
  unlabelled fence, inline code, a formula, a table, a blockquote, a nested list,
  and a reasoning chain (`已思考`).
- **A user message** long enough to trigger the collapsible wrapper, and one with
  a fenced code block and CJK text.
- Capture **both themes** (`--dark`).

### Known limitation of the 2026-09-15 capture

It is **light theme only**. The dark syntax palette is therefore unverified: the
light palette covers only `keyword`, `string`, `function` and `punctuation`, and
a dark capture may cover more. Add it with `--dark` when convenient.
