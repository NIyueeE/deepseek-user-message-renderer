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

## Commit & Pull Request Guidelines

- Follow Conventional Commits as seen in the project history: `feat:`, `fix:`, `chore:` (e.g. `feat: native-style rendering with robust edit, code-block, and highlight handling`).
- Open pull requests against `master`; CI (`.github/workflows/ci.yml`) runs `bun run lint` and `bun test` on every push and PR.
- Describe what changed and why. If a change adapts to DeepSeek's DOM (e.g. hashed class names like `_9663006`), call that out explicitly so the change is easy to re-verify after DeepSeek UI releases.
