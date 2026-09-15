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
 * Synthetic CSS pins both directions without depending on any real capture.
 */

const probe = (key: keyof typeof CSS_CONTRACT) => {
    const spec = CSS_CONTRACT[key];
    if (!spec) throw new Error(`no probe named ${key}`);
    return spec.probe;
};

describe("contract probe: syntax-token-palette", () => {
    const palette = probe("syntax-token-palette");

    test("accepts a minified rule that colours a content token", () => {
        expect(palette(".md-code-block.md-code-block-light .token.keyword{color:#a626a4}")).toBeTrue();
        expect(palette(".token.string{color:#50a14f}")).toBeTrue();
    });

    test("accepts a colour that is not the first declaration", () => {
        expect(palette(".token.function{font-weight:600;color:#4078f2}")).toBeTrue();
    });

    test("rejects whitespace-marker rules, which colour nothing visible", () => {
        // This is the 2026-08-29 capture: it had ONLY these, plus selection rules
        expect(palette(".md-code-block.md-code-block-dark .token.token.lf:before{color:#8da1b9}")).toBeFalse();
        expect(palette(".token.token.space:before{color:rgba(56,58,66,.2)}")).toBeFalse();
        expect(palette(".token.tab:not(:empty):before{color:#8da1b9}")).toBeFalse();
    });

    test("rejects a bare token class with no kind name", () => {
        expect(palette(".token{color:red}")).toBeFalse();
    });

    test("rejects rules that set something other than colour", () => {
        expect(palette(".token.keyword{font-weight:700}")).toBeFalse();
    });

    test("rejects selection-only rules", () => {
        expect(
            palette(".md-code-block.md-code-block-light pre[class*=language-]::selection{background:#e5e5e6}"),
        ).toBeFalse();
    });

    test("ignores a colour declared on an unrelated sibling selector", () => {
        expect(palette(".something-else{color:red}")).toBeFalse();
    });
});

describe("contract probe: code-typography-consumed", () => {
    const consumed = probe("code-typography-consumed");

    test("accepts the page applying the code face", () => {
        expect(consumed(".ds-markdown pre{font-family:var(--ds-font-family-code);overflow:auto}")).toBeTrue();
    });

    test("accepts the markdown-code token", () => {
        expect(consumed("pre{font:var(--dsw-font-markdown-code)}")).toBeTrue();
    });

    test("rejects a stylesheet that only DEFINES the token", () => {
        // A token definition is not a consumer. This distinction is why the
        // script cannot rely on the page to give the raw view its code face.
        expect(consumed("body{--ds-font-family-code:Menlo,monospace}")).toBeFalse();
    });

    test("rejects a token definition whose value is another token", () => {
        // This exact line is in both captures, and looks identical to a consumer
        // unless custom-property declarations are excluded.
        expect(consumed("body{--dsw-font-markdown-code-font-family:var(--ds-font-family-code)}")).toBeFalse();
    });

    test("rejects an unrelated font token", () => {
        expect(consumed("body{font-family:var(--dsw-font-family)}")).toBeFalse();
    });
});

describe("contract probe: structural features", () => {
    test("md-code-block-frame needs the wrapper itself", () => {
        expect(probe("md-code-block-frame")(".md-code-block{--x:1}")).toBeTrue();
        expect(probe("md-code-block-frame")(".md-markdown-only{}")).toBeFalse();
    });

    test("md-code-block-theme-variants needs BOTH variants", () => {
        expect(probe("md-code-block-theme-variants")(".md-code-block-dark .token{}")).toBeFalse();
        expect(
            probe("md-code-block-theme-variants")(".md-code-block-dark .token{}\n.md-code-block-light .token{}"),
        ).toBeTrue();
    });

    test("dark-theme-marker needs the attribute selector", () => {
        expect(probe("dark-theme-marker")("[data-ds-dark-theme] .x{color:red}")).toBeTrue();
        expect(probe("dark-theme-marker")("body.dark .x{color:red}")).toBeFalse();
    });
});

describe("extractCss", () => {
    test("collects every style block, in order", () => {
        const html = "<style>a{color:red}</style><div></div><style>b{color:blue}</style>";
        expect(extractCss(html)).toBe("a{color:red}\nb{color:blue}");
    });

    test("returns empty for a page with no styles", () => {
        expect(extractCss("<div>hello</div>")).toBe("");
    });
});
