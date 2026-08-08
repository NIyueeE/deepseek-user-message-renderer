import { describe, expect, test } from "bun:test";
import { marked } from "marked";

describe("marked 12 parsing quirk (documented)", () => {
    test("--- is treated as a setext heading underline when a fence follows a paragraph directly", () => {
        const html = marked.parse("para\n```text\n---\n```");
        expect(html).toContain("<h2>");
        expect(html).not.toContain("language-text");
    });

    test("--- renders as a code block when the fence is preceded by a blank line", () => {
        const html = marked.parse("para\n\n```text\n---\n```");
        expect(html).toContain("language-text");
        expect(html).toContain('<pre><code class="language-text">---');
    });
});
