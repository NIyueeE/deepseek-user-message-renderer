import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadUserscript, settle, setupTampermonkeyEnv } from "./env";

/**
 * The blockquote regression, pinned against a REAL capture.
 *
 * `deepseek-bugcase.html` is the older (2026-08-29) capture, kept because its
 * conversation happens to contain the exact input that once shipped broken:
 *
 *     > test
 *
 *     你好
 *
 * The blank line must END the blockquote, so "你好" renders as its own
 * paragraph instead of being swallowed as a Markdown lazy continuation. The
 * unit tests cover the parser directly, but this asserts it on the page's own
 * markup, where wrapper whitespace nodes and DeepSeek's collapsible container
 * are in play — the part a hand-written fixture cannot reproduce.
 *
 * Its external stylesheets were dropped by the save (see its provenance), so it
 * is a SELECTOR and content fixture, not a styling one. Use deepseek-chat.html
 * for styling questions.
 */
const FIXTURE = join(import.meta.dir, "fixtures", "deepseek-bugcase.html");
const REPLY_TEXT = "Hi! How can I help you today?";

const env = setupTampermonkeyEnv();
env.window.document.write(readFileSync(FIXTURE, "utf-8"));

for (const md of env.document.querySelectorAll("._4f9bf79 .ds-assistant-message-main-content")) {
    const component = { memoizedProps: { markdown: REPLY_TEXT }, return: null };
    const domFiber = { memoizedProps: { className: md.className }, return: component };
    Object.defineProperty(md, "__reactFiber$fixture", {
        value: domFiber,
        enumerable: true,
        configurable: true,
    });
}

await loadUserscript();
await settle();

describe("real DeepSeek DOM: blockquote regression capture", () => {
    test("the capture still contains the elements the script targets", () => {
        expect(env.document.querySelectorAll("._9663006").length).toBe(2);
        expect(env.document.querySelectorAll("div.fbb737a4").length).toBe(2);
        expect(env.document.querySelectorAll(".ds-collapsible-text").length).toBe(2);
        expect(env.document.querySelectorAll("._4f9bf79").length).toBe(2);
        expect(env.document.querySelectorAll(".ds-assistant-message-main-content").length).toBe(2);
        expect(env.document.querySelectorAll("._0a3d93b").length).toBe(2);
    });

    test("renders both real user messages as native Markdown", () => {
        const boxes = [...env.document.querySelectorAll(".ds-collapsible-text")];
        expect(boxes.length).toBe(2);
        for (const box of boxes) {
            const md = box.querySelector(".md-user-markdown");
            expect(md).not.toBeNull();
            expect(md?.classList.contains("ds-markdown")).toBeTrue();
            expect(md?.querySelector("p")?.classList.contains("ds-markdown-paragraph")).toBeTrue();
        }
        // The reported bug case, on the real DOM: the quote holds only its own
        // line, and the next line is its own paragraph
        const second = boxes[1]?.querySelector(".md-user-markdown");
        expect(second?.querySelector("blockquote")?.textContent).toBe("test");
        expect(second?.querySelectorAll("p")[1]?.textContent).toBe("nihao");
    });

    test("the real collapsible wrapper keeps the host's own children", () => {
        for (const box of env.document.querySelectorAll(".ds-collapsible-text")) {
            expect(box.querySelector(".md-user-markdown")).not.toBeNull();
            const hostChild = box.firstElementChild;
            expect(hostChild).not.toBeNull();
            expect(hostChild?.classList.contains("md-user-markdown")).toBeFalse();
            expect(hostChild?.textContent).toContain("test");
            expect(box.getAttribute("data-md-collapsible")).toBe("1");
            expect(box.getAttribute("style")).toContain("max-height");
        }
    });

    test("injects a raw toggle into each real assistant action bar", () => {
        const toggles = env.document.querySelectorAll("[data-md-raw-toggle]");
        expect(toggles.length).toBe(2);
        for (const item of env.document.querySelectorAll("._4f9bf79")) {
            const toggle = item.querySelector("[data-md-raw-toggle]");
            expect(toggle).not.toBeNull();
            expect(toggle?.classList.contains("ds-button")).toBeTrue();
            expect(toggle?.classList.contains("ds-button--xs")).toBeTrue();
            expect(toggle?.querySelector(".ds-button__background")).not.toBeNull();
            const buttons = item.querySelectorAll("._0a3d93b [role=button]");
            expect(buttons[buttons.length - 1]).toBe(toggle as Element);
            const path = toggle?.querySelector("svg path");
            expect(path?.getAttribute("fill")).toBe("currentColor");
            expect(path?.hasAttribute("stroke")).toBeFalse();
            expect(toggle?.hasAttribute("title")).toBeFalse();
            expect(toggle?.getAttribute("data-md-raw-tip")).toBeTruthy();
        }
    });

    test("the toggle shows the reply source from the real action context", async () => {
        const toggle = env.document.querySelector("[data-md-raw-toggle]") as HTMLElement;
        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));

        const container = env.document.querySelector(".md-raw-source") as HTMLElement;
        const pre = container?.querySelector("pre") as HTMLElement;
        expect(pre?.textContent).toBe(REPLY_TEXT);
        expect(container?.querySelector(".md-code-block")).not.toBeNull();
        expect(container?.querySelector(".d813de27")?.textContent).toBe("markdown");
        const column = env.document.querySelector("._4f9bf79 .ds-assistant-message-main-content");
        expect(column?.getAttribute("data-md-raw-mode")).toBe("1");
        expect(container?.classList.contains("ds-markdown")).toBeTrue();

        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));
        await settle();
        expect(env.document.querySelector(".md-raw-source")).toBeNull();
        expect(column?.getAttribute("data-md-raw-mode")).toBeNull();
    });

    test("finds the edit button by the real pencil icon", () => {
        const EDIT_PREFIX = "M9.94076 1.34942";
        const paths = [...env.document.querySelectorAll("._9663006 .ds-flex [role=button] svg path")];
        expect(paths.some((p) => (p.getAttribute("d") ?? "").startsWith(EDIT_PREFIX))).toBeTrue();
    });

    test("leaves the assistant messages' native nodes intact", () => {
        for (const item of env.document.querySelectorAll("._4f9bf79")) {
            expect(item.querySelector("._74c0879")).not.toBeNull();
            expect(item.querySelector("._5255ff8")?.textContent).toContain("已思考");
            expect(item.querySelector(".ds-markdown.ds-assistant-message-main-content")).not.toBeNull();
        }
    });
});
