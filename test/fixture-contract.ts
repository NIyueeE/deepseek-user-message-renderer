/**
 * The DOM/CSS contract a captured DeepSeek fixture must satisfy.
 *
 * The userscript is written against DeepSeek's build-specific DOM: hashed class
 * names, a specific nesting of user/assistant messages, and design tokens in the
 * page's own stylesheet. A fixture that silently lacks any of it makes every
 * test that uses it agree with a page that no longer exists — the tests pass
 * while the real page breaks.
 *
 * This module turns "is the capture still usable?" into a machine-checked list
 * instead of a judgement call. It is deliberately free of any browser: it parses
 * with happy-dom, so it runs in CI on every push.
 *
 * Two kinds of finding:
 *   - `failures` — something the contract requires and the capture does not have.
 *     These break the build.
 *   - `gaps` — something the capture knowingly lacks, declared in its sidecar
 *     provenance file under `intentionalGaps`. These are reported (and must
 *     match what is actually missing) but do not break the build.
 *
 * The point of `gaps` is honesty: a capture that quietly lost the syntax
 * palette used to look complete. Now it must say so out loud, the claim is
 * verified against reality, and the deficiency is burnable.
 */

export interface FixtureProvenance {
    /** Where the capture came from. */
    source: string;
    /** ISO timestamp of the capture. */
    capturedAt: string;
    /** Which theme the capture was taken in. */
    theme: "light" | "dark" | "unknown";
    /** Free-form note about how it was produced. */
    method?: string;
    /** Free-form notes worth surfacing in `fixture:check`. */
    notes?: string[];
    /** Free-form record of what this capture cannot answer. */
    knownDeficiencies?: string[];
    /**
     * Things this capture is known to lack, each a key from CONTRACT_GAPS.
     * Every entry is verified to actually be missing; an entry that is present
     * is a failure, so the list cannot rot in the optimistic direction.
     */
    intentionalGaps?: string[];
}

export interface ContractFinding {
    key: string;
    detail: string;
}

export interface FixtureAudit {
    provenance: FixtureProvenance | null;
    /** Required DOM anchors, by contract key. */
    domPresent: Record<string, boolean>;
    /** Required design tokens, by token name. */
    tokensPresent: Record<string, boolean>;
    /** CSS feature probes, by contract key. */
    cssPresent: Record<string, boolean>;
    /** Things the contract requires that are missing (break the build). */
    failures: ContractFinding[];
    /** Declared gaps that are genuinely absent (reported, allowed). */
    gaps: ContractFinding[];
    /** Declared gaps that are actually PRESENT — the declaration is stale. */
    staleGaps: ContractFinding[];
    /** Non-fatal observations. */
    warnings: string[];
    counts: Record<string, number>;
}

/**
 * DOM anchors the script's selectors depend on. Keep in sync with the constants
 * in src/ (USER_TEXT_SELECTOR, ANSWER_SELECTORS, THINKING_SELECTORS, ...).
 */
const DOM_CONTRACT: Record<string, { selector: string; min: number }> = {
    userGroup: { selector: "._9663006", min: 1 },
    userText: { selector: "._9663006 div.fbb737a4", min: 1 },
    collapsibleWrapper: { selector: ".ds-collapsible-text", min: 1 },
    assistantItem: { selector: "._4f9bf79", min: 1 },
    assistantReply: { selector: "._4f9bf79 .ds-assistant-message-main-content", min: 1 },
    // The action row is a SIBLING of the reply in the current build
    assistantActionBar: { selector: "._4f9bf79 .ds-flex [role=button]", min: 1 },
    thinkingChain: { selector: "._4f9bf79 [class*=_5255ff8], ._4f9bf79 .ds-think-content", min: 1 },
};

/** Design tokens the script reads. Missing ones silently change its output. */
const TOKEN_CONTRACT: string[] = [
    "--ds-font-family-code",
    "--dsw-font-family",
    "--dsw-font-markdown-code-font-size",
    "--dsw-font-markdown-code-line-height",
    "--dsw-alias-markdown-code-block",
    "--dsw-alias-markdown-code-block-banner",
    "--dsw-alias-label-primary",
    "--dsw-alias-label-primary-inverted",
    "--dsw-alias-tooltip-bg",
    "--dsw-font-xxs-12-font-size",
];

/**
 * Token kinds that only style `:before` whitespace markers. Rules for these are
 * NOT a syntax palette — see the `syntax-token-palette` probe.
 */
const WHITESPACE_MARKERS = new Set(["lf", "cr", "space", "tab"]);

/**
 * CSS features the script relies on. Each probe returns true when the page's own
 * stylesheet can render that feature, so a capture missing it cannot validate
 * the corresponding behaviour.
 */
export const CSS_CONTRACT: Record<string, { probe: (css: string) => boolean; describe: string }> = {
    "md-code-block-frame": {
        probe: (css) => /\.md-code-block\b/.test(css),
        describe: "md-code-block frame rules",
    },
    "md-code-block-theme-variants": {
        probe: (css) => /md-code-block-dark/.test(css) && /md-code-block-light/.test(css),
        describe: "both light and dark md-code-block variants",
    },
    "dark-theme-marker": {
        probe: (css) => /data-ds-dark-theme/.test(css),
        describe: "rules keyed off data-ds-dark-theme",
    },
    "markdown-container": {
        probe: (css) => /\.ds-markdown\b/.test(css),
        describe: ".ds-markdown container rules",
    },
    "button-interaction": {
        probe: (css) => /\.ds-button\b/.test(css),
        describe: ".ds-button rules (geometry and hover)",
    },
    "syntax-token-palette": {
        // A rule that colours a CONTENT token (keyword, string, function, …).
        //
        // Deliberately strict, in three ways that each matter:
        //   * `.token.<name>` — a bare `token` class is not a palette; the
        //     selector must name the token kind.
        //   * not a whitespace marker (`lf`/`cr`/`space`/`tab`) — those rules
        //     only colour `:before` content, so they look like a palette in a
        //     grep while colouring nothing a reader sees.
        //   * `[^{}:]*` up to the brace — excludes `:before`/`:after` variants
        //     and anything else with a pseudo-element.
        //
        // The 2026-08-29 capture had only the whitespace-marker rules, and a
        // laxer probe would have declared it a palette and quietly claimed the
        // syntax colours were verified.
        probe: (css) => {
            const re = /\.token\.([\w-]+)[^{}:]*\{([^{}]*)\}/g;
            let m = re.exec(css);
            while (m !== null) {
                const name = m[1] ?? "";
                const body = m[2] ?? "";
                if (!WHITESPACE_MARKERS.has(name) && /(^|;|\s)color\s*:/.test(body)) {
                    return true;
                }
                m = re.exec(css);
            }
            return false;
        },
        describe: "rules that colour .token elements",
    },
    "code-typography-consumed": {
        // A rule that actually APPLIES a code font token to something.
        //
        // Two traps, both of which produced a wrong answer here:
        //   * the token is `--ds-font-family-code` as well as the
        //     `--dsw-font-markdown-code*` family, so a probe keyed to the
        //     `--dsw-` prefix alone only passed by accident;
        //   * a token DEFINITION whose value is another token
        //     (`--dsw-font-markdown-code-font-family:var(--ds-font-family-code)`)
        //     looks exactly like a consumer. The `(?<!-)` keeps the match off
        //     custom-property declarations, which are always preceded by `-`.
        probe: (css) => /(?<!-)font[a-z-]*\s*:\s*[^;}]*var\(\s*--[a-z0-9-]*code[a-z0-9-]*\s*\)/.test(css),
        describe: "a rule consuming the code font token",
    },
};

/** Gap keys a capture may declare as intentional. */
export const CONTRACT_GAPS: Record<string, string> = {
    "syntax-token-palette": "no rule colours .token elements (syntax highlighting unverifiable)",
    "code-typography-consumed": "no rule consumes the code font token (monospace face unverifiable)",
    "dark-theme-capture": "captured in light theme only",
};

export function parseProvenance(raw: string | null): FixtureProvenance | null {
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as FixtureProvenance;
        if (typeof parsed?.source !== "string" || typeof parsed?.capturedAt !== "string") {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/** Extract the contents of every <style> element, without a DOM. */
export function extractCss(html: string): string {
    const out: string[] = [];
    const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let m = re.exec(html);
    while (m !== null) {
        out.push(m[1] ?? "");
        m = re.exec(html);
    }
    return out.join("\n");
}

/**
 * Audit a captured fixture. `query` runs a CSS selector and returns the number
 * of matches — pass the happy-dom document's querySelectorAll length so the real
 * parser decides, never a hand-written regex.
 */
export function auditFixture(options: {
    html: string;
    provenance: FixtureProvenance | null;
    count: (selector: string) => number;
}): FixtureAudit {
    const { html, provenance, count } = options;
    const css = extractCss(html);
    const failures: ContractFinding[] = [];
    const gaps: ContractFinding[] = [];
    const staleGaps: ContractFinding[] = [];
    const warnings: string[] = [];

    const domPresent: Record<string, boolean> = {};
    for (const [key, spec] of Object.entries(DOM_CONTRACT)) {
        const n = count(spec.selector);
        domPresent[key] = n >= spec.min;
        if (n < spec.min) {
            failures.push({ key, detail: `missing DOM anchor ${spec.selector} (found ${n}, need ${spec.min})` });
        }
    }

    const tokensPresent: Record<string, boolean> = {};
    for (const token of TOKEN_CONTRACT) {
        const ok = css.includes(token);
        tokensPresent[token] = ok;
        if (!ok) {
            failures.push({ key: token, detail: `missing design token ${token}` });
        }
    }

    // Declared gaps are read first: a missing CSS feature is only tolerated when
    // the capture says so out loud. Anything missing and undeclared is a failure.
    const declared = new Set(provenance?.intentionalGaps ?? []);

    const cssPresent: Record<string, boolean> = {};
    for (const [key, spec] of Object.entries(CSS_CONTRACT)) {
        const ok = spec.probe(css);
        cssPresent[key] = ok;
        if (ok) {
            if (declared.has(key)) {
                staleGaps.push({
                    key,
                    detail: `declared as a gap, but the capture actually has it — remove "${key}" from intentionalGaps`,
                });
            }
            continue;
        }
        if (declared.has(key)) {
            gaps.push({ key, detail: CONTRACT_GAPS[key] ?? spec.describe });
        } else {
            failures.push({
                key,
                detail: `missing ${spec.describe} (declare "${key}" in the provenance if this capture cannot have it)`,
            });
        }
    }

    // A declaration naming a key that is not a known gap is a mistake.
    for (const key of declared) {
        if (!(key in CONTRACT_GAPS)) {
            failures.push({ key, detail: `provenance declares unknown gap "${key}"` });
        }
    }

    if (!provenance) {
        failures.push({ key: "provenance", detail: "missing or unreadable provenance sidecar" });
    } else {
        if (provenance.theme === "dark" && !/data-ds-dark-theme/.test(html)) {
            warnings.push("provenance claims a dark capture but the markup has no data-ds-dark-theme");
        }
        if (provenance.theme === "light" && !declared.has("dark-theme-capture")) {
            warnings.push('light-only capture: declare "dark-theme-capture" in intentionalGaps, or capture dark too');
        }
    }

    const counts: Record<string, number> = {
        styleBytes: css.length,
        cssRules: (css.match(/\{/g) ?? []).length,
        domAnchors: Object.values(domPresent).filter(Boolean).length,
        tokens: Object.values(tokensPresent).filter(Boolean).length,
    };

    if (counts.domAnchors === 0) {
        failures.push({ key: "empty-capture", detail: "no message anchors found at all — is this the right file?" });
    }

    return { provenance, domPresent, tokensPresent, cssPresent, failures, gaps, staleGaps, warnings, counts };
}
