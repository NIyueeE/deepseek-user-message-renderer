import { describe, expect, test } from "bun:test";
import { marked } from "marked";

describe("marked 18 parsing (regression guard)", () => {
    test("parses a fence directly after a paragraph as a code block, not a setext heading", () => {
        // marked <=12 misparsed "para\n```text\n---\n```" as an h2 (the ---
        // line was treated as a setext underline) plus an empty text fence.
        // marked 18 handles it correctly; keep this guard against regressions.
        const html = marked.parse("para\n```text\n---\n```");
        expect(html).not.toContain("<h2>");
        expect(html).toContain('pre><code class="language-text">---');
    });

    test("--- renders as a code block when the fence is preceded by a blank line", () => {
        const html = marked.parse("para\n\n```text\n---\n```");
        expect(html).toContain("language-text");
        expect(html).toContain('<pre><code class="language-text">---');
    });
});
