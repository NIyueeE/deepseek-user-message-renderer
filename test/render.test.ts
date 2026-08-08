import { describe, expect, test } from "bun:test";
import { appendUserMessage, appendWrappedUserMessage, loadUserscript, setupTampermonkeyEnv } from "./env";

const env = setupTampermonkeyEnv();
const { message, content } = appendWrappedUserMessage(
    env.document,
    ["# Title", "", "Paragraph with **bold** and `inline code`", "", "```text", "---", "```", ""].join("\n"),
);
const bare = appendUserMessage(env.document, "**bare text message**");

await loadUserscript();

describe("user message Markdown rendering", () => {
    test("renders a ds-markdown container", () => {
        expect(message.querySelector(".ds-markdown")).not.toBeNull();
    });

    test("renders headings, bold text, and inline code", () => {
        expect(message.querySelector("h1")?.textContent).toBe("Title");
        expect(message.querySelector("strong")?.textContent).toBe("bold");
        expect(message.querySelector("code")?.textContent).toBe("inline code");
    });

    test("renders --- as a code block when the fence is preceded by a blank line", () => {
        const block = message.querySelector("pre code.language-text");
        expect(block).not.toBeNull();
        expect(block?.textContent?.trim()).toBe("---");
    });

    test("adds the official style class to paragraphs", () => {
        const paragraphs = message.querySelectorAll("p");
        expect(paragraphs.length).toBeGreaterThan(0);
        for (const paragraph of paragraphs) {
            expect(paragraph.classList.contains("ds-markdown-paragraph")).toBeTrue();
        }
    });

    test("applies right-aligned bubble styles", () => {
        // happy-dom does not support CSS var(), so background is not asserted directly
        expect(message.style.borderRadius).toBe("22px");
        expect(message.style.padding).toBe("10px 16px");
        expect(message.style.marginLeft).toBe("auto");
    });

    test("keeps DeepSeek's original child nodes and only hides them via styles", () => {
        expect(message.classList.contains("ds-md-rendered")).toBeTrue();
        expect(content.isConnected).toBeTrue();
        expect(message.querySelector(".ds-message-content")).toBe(content);
    });

    test("hides bare-text messages by shrinking font-size", () => {
        expect(bare.querySelector(".ds-markdown")).not.toBeNull();
        expect(bare.style.fontSize).toBe("0px");
        expect(bare.querySelector(".ds-markdown")?.style.fontSize).toBe("1rem");
    });

    test("sets the mdRendered marker after rendering", () => {
        expect(message.dataset.mdRendered).toBeTruthy();
    });

    test("injects CSS resources and calls the math/highlight hooks", () => {
        expect(env.gmResourceTextCalls.sort()).toEqual(["HLJS_CSS", "KATEX_CSS"]);
        expect(env.gmAddStyleCalls.length).toBe(3);
        expect(env.mathCalls.length).toBe(2);
        expect(env.highlightCalls.length).toBe(1);
    });
});
