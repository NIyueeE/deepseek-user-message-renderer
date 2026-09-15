import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadUserscript, settle, setupTampermonkeyEnv } from "./env";

/**
 * Integration tests against the REAL DeepSeek DOM.
 *
 * `test/fixtures/deepseek-chat.html` is a verbatim capture of a live chat page
 * (see the header comment in that file). The unit tests elsewhere build small
 * hand-written fixtures, which is right for pinning behaviour but cannot notice
 * that DeepSeek renamed or restructured something: a fixture the test author
 * invented always agrees with the selectors the test author wrote.
 *
 * Loading the real markup instead means the script's selectors, the shape of the
 * user message, the collapsible wrapper and the assistant action bar are all
 * checked against the page as it actually is. If DeepSeek ships a new UI, these
 * tests fail and point at what moved.
 *
 * The capture keeps the DOM but not React's internals, so the assistant reply's
 * source is supplied by a synthetic fibre shaped like the live one.
 */
const FIXTURE = join(import.meta.dir, "fixtures", "deepseek-chat.html");
const REPLY_TEXT = "Hi! How can I help you today?";

const env = setupTampermonkeyEnv();
env.window.document.write(readFileSync(FIXTURE, "utf-8"));

// Install the synthetic React fibres BEFORE the userscript runs, so its very
// first scan sees them (matching the live page, where React is already mounted).
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

describe("real DeepSeek DOM", () => {
    test("the capture still contains the elements the script targets", () => {
        // These are the page's own class names. A failure here means DeepSeek's
        // build changed and the script's selectors need re-deriving — which is
        // exactly the signal these tests exist to give.
        expect(env.document.querySelectorAll("._9663006").length).toBe(2); // user message groups
        expect(env.document.querySelectorAll("div.fbb737a4").length).toBe(2); // user text elements
        expect(env.document.querySelectorAll(".ds-collapsible-text").length).toBe(2);
        expect(env.document.querySelectorAll("._4f9bf79").length).toBe(2); // assistant items
        expect(env.document.querySelectorAll(".ds-assistant-message-main-content").length).toBe(2);
        expect(env.document.querySelectorAll("._0a3d93b").length).toBe(2); // assistant action bars
    });

    test("renders the real user messages as native Markdown", () => {
        // Both captured messages are long enough to be wrapped in DeepSeek's
        // collapsible container, so each renders into the sibling Markdown
        // container inside it.
        const boxes = [...env.document.querySelectorAll(".ds-collapsible-text")];
        expect(boxes.length).toBe(2);
        for (const box of boxes) {
            const md = box.querySelector(".md-user-markdown");
            expect(md).not.toBeNull();
            expect(md?.classList.contains("ds-markdown")).toBeTrue();
            const p = md?.querySelector("p");
            expect(p?.classList.contains("ds-markdown-paragraph")).toBeTrue();
        }
        // The captured second message is exactly the reported bug case; on the
        // real DOM the quote must hold only its own line.
        const second = boxes[1]?.querySelector(".md-user-markdown");
        expect(second?.querySelector("blockquote")?.textContent).toBe("test");
        expect(second?.querySelectorAll("p")[1]?.textContent).toBe("nihao");
    });

    test("the real collapsible wrapper keeps the host's own children", () => {
        for (const box of env.document.querySelectorAll(".ds-collapsible-text")) {
            // Our Markdown lives in a sibling inside the collapsible container…
            expect(box.querySelector(".md-user-markdown")).not.toBeNull();
            // …and the host's own node is still there, holding the ORIGINAL raw
            // Markdown (not our rendered output), so React's recorded node stays
            // valid and the host can still measure it
            const hostChild = box.firstElementChild;
            expect(hostChild).not.toBeNull();
            expect(hostChild?.classList.contains("md-user-markdown")).toBeFalse();
            expect(hostChild?.textContent).toContain("test");
            expect(box.getAttribute("data-md-collapsible")).toBe("1");
            // The host sets an inline max-height it measures against; it must
            // survive untouched
            expect(box.getAttribute("style")).toContain("max-height");
        }
    });

    test("injects a raw toggle into each real assistant action bar", () => {
        const toggles = env.document.querySelectorAll("[data-md-raw-toggle]");
        expect(toggles.length).toBe(2);
        for (const item of env.document.querySelectorAll("._4f9bf79")) {
            const toggle = item.querySelector("[data-md-raw-toggle]");
            expect(toggle).not.toBeNull();
            // Reuses the native button's classes and structure, so the page's
            // own stylesheet renders it like its neighbours
            expect(toggle?.classList.contains("ds-button")).toBeTrue();
            expect(toggle?.classList.contains("ds-button--xs")).toBeTrue();
            expect(toggle?.querySelector(".ds-button__background")).not.toBeNull();
            // Appended last: the action bar keeps its native button order
            const buttons = item.querySelectorAll("._0a3d93b [role=button]");
            expect(buttons[buttons.length - 1]).toBe(toggle as Element);
            // The glyph mirrors the native icons: a single filled path, no stroke
            const path = toggle?.querySelector("svg path");
            expect(path?.getAttribute("fill")).toBe("currentColor");
            expect(path?.hasAttribute("stroke")).toBeFalse();
            // Its hint rides on our own attribute, never on `title`
            expect(toggle?.hasAttribute("title")).toBeFalse();
            expect(toggle?.getAttribute("data-md-raw-tip")).toBeTruthy();
        }
    });

    test("the toggle shows the reply source from the real action context", async () => {
        const toggle = env.document.querySelector("[data-md-raw-toggle]") as HTMLElement;
        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));

        const pre = env.document.querySelector(".md-raw-source");
        expect(pre?.textContent).toBe(REPLY_TEXT);
        // The rendered column is hidden, and the raw source carries the native
        // markdown class so the page's own typography applies
        const column = env.document.querySelector("._4f9bf79 .ds-assistant-message-main-content");
        expect(column?.getAttribute("data-md-raw-mode")).toBe("1");
        expect(pre?.classList.contains("ds-markdown")).toBeTrue();

        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));
        await settle();
        expect(env.document.querySelector(".md-raw-source")).toBeNull();
        expect(column?.getAttribute("data-md-raw-mode")).toBeNull();
    });

    test("finds the edit button by the real pencil icon", () => {
        // The edit button is identified by its SVG path prefix; this asserts the
        // prefix still matches the icon the page actually ships.
        const EDIT_PREFIX = "M9.94076 1.34942";
        const paths = [...env.document.querySelectorAll("._9663006 .ds-flex [role=button] svg path")];
        expect(paths.some((p) => (p.getAttribute("d") ?? "").startsWith(EDIT_PREFIX))).toBeTrue();
    });

    test("leaves the assistant messages' native nodes intact", () => {
        for (const item of env.document.querySelectorAll("._4f9bf79")) {
            // The reasoning header, its icons and the markdown column are the
            // host's; the toggle only ever appends to the action bar
            expect(item.querySelector("._74c0879")).not.toBeNull();
            expect(item.querySelector("._5255ff8")?.textContent).toContain("已思考");
            expect(item.querySelector(".ds-markdown.ds-assistant-message-main-content")).not.toBeNull();
        }
    });
});
