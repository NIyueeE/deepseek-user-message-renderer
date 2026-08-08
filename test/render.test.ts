import { describe, expect, test } from "bun:test";
import { appendUserMessage, appendWrappedUserMessage, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

const env = setupTampermonkeyEnv();
const { message, content } = appendWrappedUserMessage(
    env.document,
    ["# Title", "", "Paragraph with **bold** and `inline code`", "", "```python", "---", "```", ""].join("\n"),
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
        const block = message.querySelector("pre.language-python");
        expect(block).not.toBeNull();
        expect(block?.textContent?.trim()).toBe("---");
    });

    test("wraps code blocks in DeepSeek's native md-code-block structure", () => {
        const codeBlock = message.querySelector(".md-code-block");
        expect(codeBlock).not.toBeNull();
        expect(codeBlock?.classList.contains("md-code-block-light")).toBeTrue();

        // Banner with the language label
        const banner = codeBlock?.querySelector(".md-code-block-banner");
        expect(banner).not.toBeNull();
        expect(codeBlock?.querySelector(".d813de27")?.textContent).toBe("python");

        // Official CSS targets pre[class*=language-]; marked only sets the class on <code>
        const pre = codeBlock?.querySelector("pre.language-python");
        expect(pre).not.toBeNull();
        expect(pre?.textContent).toContain("---");

        // Corner decorations
        expect(codeBlock?.querySelectorAll("svg._9bc997d").length).toBe(2);

        // No copy/download buttons: these are the user's own messages
        expect(codeBlock?.querySelector(".efa13877")).toBeNull();
        expect(codeBlock?.querySelector(".code-info-button-text")).toBeNull();
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
        // Bubble background is a stylesheet rule (not inline) so DeepSeek's
        // history-item highlight cleanup (style.background = "") cannot wipe it
        expect(env.gmAddStyleCalls.join("")).toContain(
            "._9663006 div.ds-message.ds-md-rendered { background: var(--dsw-specific-bubble, #edf3fe); }",
        );
        expect(env.mathCalls.length).toBe(2);
        expect(env.highlightCalls.length).toBe(1);
    });

    test("uses the dark md-code-block variant in dark mode", async () => {
        env.document.body.classList.add("dark");
        const { message: darkMessage } = appendWrappedUserMessage(env.document, "```js\nconst x = 1;\n```");
        await settle();

        const codeBlock = darkMessage.querySelector(".md-code-block");
        expect(codeBlock).not.toBeNull();
        expect(codeBlock?.classList.contains("md-code-block-dark")).toBeTrue();
        expect(codeBlock?.classList.contains("md-code-block-light")).toBeFalse();
        expect(codeBlock?.querySelector(".d813de27")?.textContent).toBe("js");
        expect(codeBlock?.querySelector("pre.language-js")).not.toBeNull();
    });

    test("keeps hard line breaks inside code blocks", async () => {
        // Short message: innerText-based sources would collapse the fence
        // newlines; the script must read the source with textContent
        const { message: codeMessage } = appendWrappedUserMessage(
            env.document,
            ["```python", "def hello():", '    print("hi")', "```", ""].join("\n"),
        );
        await settle();
        expect(codeMessage.querySelector(".d813de27")?.textContent).toBe("python");
        const pre = codeMessage.querySelector("pre");
        expect(pre?.textContent).toBe('def hello():\n    print("hi")\n');
        expect(pre?.style.whiteSpace).toBe("pre-wrap");
    });

    test("renders mermaid fences as plain code blocks without hljs warnings", async () => {
        const callsBefore = env.highlightCalls.length;
        const { message: mermaidMessage } = appendWrappedUserMessage(
            env.document,
            ["```mermaid", "graph TD", "    A --> B", "```", ""].join("\n"),
        );
        await settle();

        // Still a native-styled code block with the mermaid banner
        const codeBlock = mermaidMessage.querySelector(".md-code-block");
        expect(codeBlock).not.toBeNull();
        expect(codeBlock?.querySelector(".d813de27")?.textContent).toBe("mermaid");
        expect(codeBlock?.querySelector("pre")?.textContent).toContain("A --> B");

        // highlight.js does not know "mermaid": it must be skipped, not warned about
        expect(env.highlightCalls.length).toBe(callsBefore);
    });
});
