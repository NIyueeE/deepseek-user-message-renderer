import { describe, expect, test } from "bun:test";
import { CSS_CONTRACT, extractCss } from "./fixture-contract";

/**
 * Unit tests for the contract PROBES.
 *
 * These probes decide whether a capture is considered to have a styling feature,
 * which in turn decides whether the styling tests are testing anything. Two
 * subtle mistakes were made while writing them, and both would have silently
 * declared a degraded capture "complete":
 *
 *   1. requiring `;`/whitespace before `color:` — minified CSS writes
 *      `…{color:#a626a4}`, so the real palette was reported missing;
 *   2. matching any `.token…{color:…}` — the whitespace-marker rules
 *      (`.token.lf:before{color:…}`) then counted as a syntax palette, so a
 *      capture with NO colours a reader can see was reported as having one.
 *
 * The cases are table-driven, so adding one is a line rather than a test name.
 */

function probe(key: keyof typeof CSS_CONTRACT): (css: string) => boolean {
    const spec = CSS_CONTRACT[key];
    if (!spec) {
        throw new Error(`no probe named ${key}`);
    }
    return spec.probe;
}

/** Assert every sample has the expected verdict, naming the offending one. */
function expectAll(fn: (css: string) => boolean, samples: string[], expected: boolean): void {
    for (const css of samples) {
        expect(fn(css), `${expected ? "expected to accept" : "expected to reject"}: ${css}`).toBe(expected);
    }
}

describe("probe: syntax-token-palette", () => {
    const palette = probe("syntax-token-palette");

    test("accepts a rule that colours a CONTENT token, however it is written", () => {
        expectAll(
            palette,
            [
                // Minified: the colour sits straight after `{`
                ".md-code-block.md-code-block-light .token.keyword{color:#a626a4}",
                ".token.string{color:#50a14f}",
                // ...and not necessarily as the first declaration
                ".token.function{font-weight:600;color:#4078f2}",
            ],
            true,
        );
    });

    test("rejects everything that only looks like a palette", () => {
        expectAll(
            palette,
            [
                // The 2026-08-29 capture had ONLY these: they colour `:before`
                // content on whitespace markers, i.e. nothing a reader sees
                ".md-code-block.md-code-block-dark .token.token.lf:before{color:#8da1b9}",
                ".token.token.space:before{color:rgba(56,58,66,.2)}",
                ".token.tab:not(:empty):before{color:#8da1b9}",
                // No token KIND, so nothing identifies what is being coloured
                ".token{color:red}",
                // Sets something other than colour
                ".token.keyword{font-weight:700}",
                // Selection styling, not syntax colouring
                ".md-code-block.md-code-block-light pre[class*=language-]::selection{background:#e5e5e6}",
                // An unrelated rule that happens to mention a colour
                ".something-else{color:red}",
            ],
            false,
        );
    });
});

describe("probe: code-typography-consumed", () => {
    const consumed = probe("code-typography-consumed");

    test("accepts a rule that APPLIES a code font token", () => {
        expectAll(
            consumed,
            [
                ".ds-markdown pre{font-family:var(--ds-font-family-code);overflow:auto}",
                "pre{font:var(--dsw-font-markdown-code)}",
            ],
            true,
        );
    });

    test("rejects definitions and unrelated font tokens", () => {
        expectAll(
            consumed,
            [
                // Defining the token is not consuming it — which is exactly why
                // the script cannot rely on the page to give the raw view its face
                "body{--ds-font-family-code:Menlo,monospace}",
                // A definition whose value is another token looks identical to a
                // consumer unless custom properties are excluded, and this exact
                // line is in both captures
                "body{--dsw-font-markdown-code-font-family:var(--ds-font-family-code)}",
                "body{font-family:var(--dsw-font-family)}",
            ],
            false,
        );
    });
});

describe("probe: structural features", () => {
    test("each needs its own specific marker", () => {
        const cases: Array<[keyof typeof CSS_CONTRACT, string, boolean]> = [
            ["md-code-block-frame", ".md-code-block{--x:1}", true],
            ["md-code-block-frame", ".md-markdown-only{}", false],
            // BOTH theme variants, not just one
            ["md-code-block-theme-variants", ".md-code-block-dark .token{}", false],
            ["md-code-block-theme-variants", ".md-code-block-dark .token{}\n.md-code-block-light .token{}", true],
            // The attribute selector, not the obsolete `dark` class
            ["dark-theme-marker", "[data-ds-dark-theme] .x{color:red}", true],
            ["dark-theme-marker", "body.dark .x{color:red}", false],
        ];
        for (const [key, css, expected] of cases) {
            expect(probe(key)(css), `${key}: ${css}`).toBe(expected);
        }
    });
});

describe("extractCss", () => {
    test("collects every style block in order, and nothing when there are none", () => {
        expect(extractCss("<style>a{color:red}</style><div></div><style>b{color:blue}</style>")).toBe(
            "a{color:red}\nb{color:blue}",
        );
        expect(extractCss("<div>hello</div>")).toBe("");
    });
});
