# Repository Guidelines

## Project Structure & Module Organization

- `src/deepseek-user-message-renderer.user.js` — the entire userscript, shipped as-is with no build step. The Tampermonkey metadata block and all rendering logic live in this one file; keep it self-contained.
- `test/` — Bun tests plus `env.ts`, a harness that simulates the browser (happy-dom) and stubs the Tampermonkey APIs `GM_addStyle` and `GM_getResourceText`.
- `.github/workflows/` — CI and release pipelines.
- `README.md` / `README.zh.md` — usage and development docs; keep both in sync when changing behavior.

## Build, Test, and Development Commands

```bash
bun install        # install dependencies
bun test           # run all tests in parallel (simulated Tampermonkey + browser)
bun run lint       # Biome static checks
bun run lint:fix   # auto-fix lint and formatting issues
bun run format     # format all files with Biome
```

There is no build step: the script in `src/` is the artifact users install directly.

## Coding Style & Naming Conventions

- Formatting is enforced by Biome: 4-space indentation, 120-character line width, double quotes.
- TypeScript strict mode is enabled in `tsconfig.json`; keep new code strict-compatible (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- Name test files after the behavior they cover: `render.test.ts`, `security.test.ts`, `edit-restore.test.ts`.
- Bump `@version` in the userscript metadata header for any user-visible change, and mirror significant updates in the Chinese README.

## Testing Guidelines

- Use `bun:test` with `describe`/`test` blocks; tests run in parallel via `bun test`.
- Write tests against `test/env.ts`, which stubs Tampermonkey APIs and loads the real userscript from `src/`.
- Every fix or feature must add or update tests in `test/`. There is no explicit coverage threshold, but CI fails on any lint or test error.

## Working Loop (DOM adaptation & bug fixes)

The script depends on DeepSeek's build-specific DOM: hashed class names (`_9663006`, `fbb737a4`), inline styles, and SVG path prefixes. When the site changes, work in this exact order:

1. **Ground truth first.** Run `bun run fixture:check` and follow "Mandatory first step for any DOM/UI change" below: the checked-in capture (`test/fixtures/`) is the primary ground truth, and when it is stale or silent on the question you are asking, ask the user to re-capture. A pasted message subtree and a screenshot of the misbehavior are the fallback when a full capture is not warranted — either way, reproduce the real structure exactly, including no whitespace between tags (real React output carries none; fixture indentation must never leak into text content).
2. **Root-cause before coding.** Classify the failure: host-app (React) reconciliation against nodes we changed, host measurement logic reading our modifications, selector drift, or Markdown parsing. Respect the host-app invariants below.
3. **Unit tests** in `test/` with fixtures replicating the reported DOM. Every fix or feature ships with tests.
4. **Headless browser verification** (see below) — happy-dom cannot catch CSS application, layout measurement, or reconciliation-timing bugs. All checks must pass.
5. **Only after everything is green**: bump `@version` (userscript) and `version` (`package.json`) together, and sync `README.md` + `README.zh.md`. Never bump earlier.
6. **Commit** (Conventional Commits), push, then follow "Release & CI/CD coordination".
7. **Ask the user to verify on the live site.** Their screenshots are the ground truth for the next iteration; repeat the loop until confirmed.

### Host-app invariants (DeepSeek page)

These were learned the hard way; do not regress them:

- **Never remove or replace the host's recorded child nodes.** React commits `removeChild`/`insertBefore` against them; a missing node throws `NotFoundError` and swallows the message. Render into a sibling container instead.
- **Hidden must stay measurable.** Hide host nodes with `position: absolute` + `visibility: hidden` (container gets `position: relative`). `display: none` zeroes `offsetHeight`/`scrollHeight`; the host derives toggle visibility and box heights from those measurements and drops its toggle button when they read 0.
- **Mark our state with data attributes, not classes.** React rewrites `className` when its own class state changes; it never touches unknown `data-*` attributes.
- **Dedup fingerprints must be stable on both sides.** Store the trimmed render-output text and compare against the trimmed re-read input; a code fence keeps a trailing `\n` in `textContent`, and an unstable comparison re-renders in a loop.
- **Intercept host-interactive elements in the capture phase** (edit button, collapse toggle): let the host's own handler commit first, then re-check on a short timer. Never fight its handler synchronously.
- **Read the message text from the host's own content holder** (excluding our containers) and trim it — wrapper whitespace nodes break fence detection.

### Test environments and what each one may claim

There are three layers. **A result from one layer must never be reported as if it came from another** — that mistake has already shipped an overclaim once (a stand-in-fixture harness was described as verifying "the page's own stylesheet").

| Layer | What it is | Proves | Cannot prove |
| --- | --- | --- | --- |
| **L1 — unit** (`bun test`, `test/env.ts`) | hand-written minimal DOM in happy-dom | selectors, parsing, dedup, edit/collapse state machines, HTML safety | real markup shape, any CSS |
| **L2 — stand-in browser** (scratch `verify.mjs`) | a page the harness author wrote, with its own tokens and button CSS | structure, events, DOM invariants, measurement, timing (freezes/starvation) | **real-page styling** — its CSS is invented |
| **L3 — real capture** (`test/fixtures/`) | verbatim captures of the live page; the 2026-09-15 pair kept the page's own stylesheets, in **both themes** | real selector drift, real computed styles, real `md-code-block` / button / markdown CSS, the light AND dark token palettes | anything the captures lack (see each `provenance.json`) |

Rule of thumb: **styling and selector questions are answered at L3 only.** If L3 cannot answer one because the capture lacks that CSS, say so explicitly instead of substituting an L2 result.

### The fixture contract (L3)

Each capture is paired with `test/fixtures/<name>.provenance.json`, and
`test/fixture-contract.ts` machine-checks it against a declared contract (DOM
anchors, design tokens, CSS features). `test/fixture-contract.test.ts` runs in CI,
so a capture that no longer matches the script's selectors fails the build.
`bun run fixture:check` prints the full report offline.
`test/fixture-contract-probes.test.ts` unit-tests the probes themselves — they
decide whether a capture "has" a feature, and two bugs in them once declared a
degraded capture complete.

**`intentionalGaps` must be honest.** A capture may lack a CSS feature (the
2026-08-29 one has no syntax-colour palette and no rule consuming the code font
token, because SingleFile dropped every external stylesheet). Declaring such a gap
is allowed; *not* declaring it is a build failure, and declaring one that is
actually present is also a failure. This is what stops a quietly-degraded capture
from making the styling tests vacuously pass.

### Styling parity (L3, needs a browser)

`bun run fixture:parity` renders a fence through the script on the captured page
and diffs the block it builds against one **DeepSeek itself rendered** in that
capture: structure, frame (radius/margin/background), typography, and computed
token colours for every kind both share. It needs Playwright, so it is not part
of `bun test`; run it whenever rendering, CSS or code-block structure changes.
Run it for **both** captures — `DSR_FIXTURE=deepseek-chat-dark bun run fixture:parity`
is the only thing that verifies the dark palette and the dark frame background.
It is the only check that can answer a styling question — quote its output, not
an L2 result.

### Mandatory first step for any DOM/UI change

Before writing code for a selector, styling, or "the page looks wrong" issue:

1. `bun run fixture:check` — is the capture still valid, and what does it lack?
2. If it is stale, or if the issue touches something the captures cannot answer
   (anything in their declared gaps, or content their conversations do not
   contain — LaTeX, tables, a streaming reply): **stop and ask the user to
   re-capture** with `bun run fixture:capture` (see `test/fixtures/README.md`
   for the conversation it must contain).
3. Only then reproduce, root-cause, and fix.

Do not "work around" a missing capture by trusting L1/L2 for a styling claim, and
do not relax the contract to make a stale capture pass.

### Headless browser verification (L2)

Run whenever rendering, host interaction, or CSS is touched. The harness is intentionally kept out of the repo (CI stays light); recreate it in a scratch dir:

```bash
mkdir -p /home/dsh/tmp/dsr-headless && cd /home/dsh/tmp/dsr-headless
echo '{"name":"dsr-headless","private":true}' > package.json
bun add playwright
bunx playwright install chromium
sudo bunx playwright install-deps chromium   # once, for missing OS libraries
```

The `verify.mjs` script must:

- start with a header comment stating its scope: that it uses a stand-in fixture and therefore proves structure/events/DOM invariants, **not** real-page styling;
- start a local HTTP server serving a fixture page that replicates the reported DeepSeek DOM (collapsible + flat + edit/cancel variants), loading marked / highlight.js / KaTeX from the same CDNs as `@require`;
- stub `GM_addStyle` so it really injects a `<style>` element (a recording stub silently skips stylesheet-rule assertions) and `GM_getResourceText`;
- inject the real userscript from `src/` and capture host node references BEFORE it runs;
- assert: host nodes stay alive with original text, rendered output is correct (code block structure, KaTeX, highlighting), the host's measurement of its content is unchanged by our hiding, dedup does not double-render, simulated host commits (inserting children) do not crash, edit/cancel/theme/toggle flows work, and there are zero console errors / page errors;
- exit non-zero on any failed check.

Keep harness scripts that load the real capture (and their per-check assertions)
working too, and **fix them when the DOM shape changes** — a harness still
measuring the old element silently reports misleading numbers. Prefer running the
styling checks against `test/fixtures/deepseek-chat.html` rather than a stand-in.

## Release & CI/CD coordination

Workflows:

- `ci.yml` — `bun run lint` + `bun test` on every push to `master` and every PR. Must be green before tagging.
- `release.yml` — triggered by `v*` tags: lint + test, creates a GitHub Release with the userscript asset, and publishes to GreasyFork when the `GFU` / `GFP` / `GREASYFORK_TOTP_SECRET` secrets are set. OpenUserJS has no API — publish manually.

Coordination flow (in order, never skipped):

```bash
git add -A && git commit -m "fix: ..."        # Conventional Commits, detailed body
git push origin master
gh run list --repo NIyueeE/deepseek-user-message-renderer --limit 1   # wait for CI = success
git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z                  # tag only after CI is green
gh run list --repo NIyueeE/deepseek-user-message-renderer --limit 1   # Release workflow = success
gh release view vX.Y.Z --repo NIyueeE/deepseek-user-message-renderer --json name,url,assets
gh release edit vX.Y.Z --repo NIyueeE/deepseek-user-message-renderer --notes-file notes.md
```

- `gh` is authenticated in the dev environment; git identity is configured repo-locally (`niyue <n1yu3@proton.me>`, matching history).
- The tag is `v` + the userscript `@version`; both `@version` and `package.json` `version` move together.
- Release notes are user-facing, bilingual (中文 first, English after), organized as 新增 / 修复 / 兼容性 / 验证, and cover the whole series of patch releases when they address one site change.

## Commit & Pull Request Guidelines

- Follow Conventional Commits as seen in the project history: `feat:`, `fix:`, `chore:` (e.g. `feat: native-style rendering with robust edit, code-block, and highlight handling`).
- Open pull requests against `master`; CI (`.github/workflows/ci.yml`) runs `bun run lint` and `bun test` on every push and PR.
- Describe what changed and why. If a change adapts to DeepSeek's DOM (e.g. hashed class names like `_9663006`), call that out explicitly so the change is easy to re-verify after DeepSeek UI releases.
