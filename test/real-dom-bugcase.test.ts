import { describe, expect, test } from "bun:test";
import { describeCaptureBattery, loadCapture } from "./capture";

/**
 * The blockquote regression, pinned against a REAL capture.
 *
 * `deepseek-bugcase.html` is the older (2026-08-29) capture, kept for one
 * reason: its conversation contains the exact input that once shipped broken —
 *
 *     > test
 *
 *     你好
 *
 * The blank line must END the blockquote, so "你好" renders as its own paragraph
 * instead of being swallowed as a Markdown lazy continuation. The parser cases
 * are covered directly in `render.test.ts`; this asserts them on the page's own
 * markup, where wrapper whitespace nodes and DeepSeek's collapsible container are
 * in play — the part a hand-written fixture cannot reproduce.
 *
 * Its external stylesheets were dropped by the save (see its provenance), so it
 * is a SELECTOR and CONTENT fixture, not a styling one; the shared battery covers
 * the parts that overlap with the other captures, and everything styling-related
 * belongs to `real-dom.test.ts` / `real-dom-dark.test.ts`.
 */
const capture = await loadCapture({ fixture: "deepseek-bugcase", replyMarkdown: "Hi! How can I help you today?" });
const { env } = capture;

describeCaptureBattery(capture, { toggles: 2 });

describe("blockquote regression capture", () => {
    test("the capture still contains the elements the script targets", () => {
        expect(env.document.querySelectorAll("._9663006").length).toBe(2);
        expect(env.document.querySelectorAll("div.fbb737a4").length).toBe(2);
        expect(env.document.querySelectorAll(".ds-collapsible-text").length).toBe(2);
        expect(env.document.querySelectorAll("._4f9bf79").length).toBe(2);
        expect(env.document.querySelectorAll("._0a3d93b").length).toBe(2);
    });

    test("a blank line ends the blockquote instead of quoting the next line", () => {
        // This is the only thing this capture is kept for: the reported bug case,
        // asserted on the real DOM where the host's own whitespace nodes are.
        const boxes = [...env.document.querySelectorAll(".ds-collapsible-text")];
        const second = boxes[1]?.querySelector(".md-user-markdown");
        expect(second?.querySelector("blockquote")?.textContent).toBe("test");
        expect(second?.querySelectorAll("p")[1]?.textContent).toBe("nihao");
    });
});
