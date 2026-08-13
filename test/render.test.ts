import { describe, expect, test } from "bun:test";
import { appendWrappedUserMessage, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

const env = setupTampermonkeyEnv();
const { message, content } = appendWrappedUserMessage(
    env.document,
    ["# Title", "", "Paragraph with **bold** and `inline code`", "", "```python", "---", "```", ""].join("\n"),
);

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

    test("renders a single newline as a soft line break", async () => {
        const { message: softBreakMessage } = appendWrappedUserMessage(env.document, "line one\nline two");
        await settle();

        const paragraph = softBreakMessage.querySelector("p");
        expect(paragraph?.innerHTML).toContain("<br>");
    });

    test("collapses blank lines into soft breaks instead of paragraph gaps", async () => {
        const { message: collapsedMessage } = appendWrappedUserMessage(
            env.document,
            "line one\nline two\n\nline three",
        );
        await settle();

        // The whole message stays one paragraph: every line break is a <br>,
        // matching the raw bubble's line-by-line flow
        const paragraphs = collapsedMessage.querySelectorAll("p");
        expect(paragraphs.length).toBe(1);
        expect(paragraphs[0]?.querySelectorAll("br").length).toBe(2);
        expect(paragraphs[0]?.textContent).toBe("line oneline twoline three");
    });

    test("renders three or more blank lines as multiple blank lines", async () => {
        const { message: multiBlankMessage } = appendWrappedUserMessage(env.document, "line one\n\n\n\nline two");
        await settle();

        // 4 newlines (3 blank lines) render as 3 line breaks: 2 visible blank
        // lines, instead of collapsing into a single paragraph gap
        const paragraphs = multiBlankMessage.querySelectorAll("p");
        expect(paragraphs.length).toBe(1);
        expect(paragraphs[0]?.querySelectorAll("br").length).toBe(3);
    });

    test("keeps blank lines inside code fences untouched", async () => {
        const { message: fenceMessage } = appendWrappedUserMessage(
            env.document,
            ["```python", "x = 1", "", "", "", "print(x)", "```", ""].join("\n"),
        );
        await settle();

        const pre = fenceMessage.querySelector("pre");
        expect(pre?.textContent).toBe("x = 1\n\n\n\nprint(x)\n");
    });

    test("keeps explicit hard breaks (two trailing spaces or backslash)", async () => {
        const { message: hardBreakMessage } = appendWrappedUserMessage(
            env.document,
            "line one  \nline two\\\nline three",
        );
        await settle();

        const paragraph = hardBreakMessage.querySelector("p");
        expect(paragraph?.innerHTML).toContain("<br>");
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

    test("wraps text segments in spans like DeepSeek's native renderer", async () => {
        const { message: spanMessage } = appendWrappedUserMessage(env.document, "hello `code` **bold**");
        await settle();

        const paragraph = spanMessage.querySelector("p");
        // Bare text segments are wrapped in empty-class spans
        expect(paragraph?.querySelector("span")?.textContent).toBe("hello ");
        // Inline code stays bare inside <code>, matching native structure
        expect(paragraph?.querySelector("code")?.innerHTML).toBe("code");
        // Nested text (e.g. bold) is wrapped too
        expect(paragraph?.querySelector("strong span")?.textContent).toBe("bold");
    });

    test("renders in place inside the original text element", () => {
        // The text element itself becomes the Markdown container: no extra
        // bubble is mounted and no original node is hidden or removed
        expect(content.isConnected).toBeTrue();
        expect(content.classList.contains("ds-markdown")).toBeTrue();
        expect(message.children.length).toBe(1);
        expect(message.children[0]).toBe(content);
        expect(message.getAttribute("style")).toBeNull();
    });

    test("sets the mdRendered marker after rendering", () => {
        expect(content.dataset.mdRendered).toBe(
            ["# Title", "", "Paragraph with **bold** and `inline code`", "", "```python", "---", "```", ""].join("\n"),
        );
        // The dedup snapshot is the text of the render output, which is what
        // the next scan reads; without it the observer would re-render forever
        expect(content.dataset.mdRenderedText).toBe(content.textContent);
    });

    test("injects CSS resources and calls the math/highlight hooks", () => {
        expect(env.gmResourceTextCalls.sort()).toEqual(["HLJS_CSS", "KATEX_CSS"]);
        expect(env.gmAddStyleCalls).toEqual(["/* HLJS_CSS */", "/* KATEX_CSS */"]);
        // KaTeX and highlight.js run on every rendered message
        expect(env.mathCalls.length).toBeGreaterThan(0);
        expect(env.highlightCalls.length).toBeGreaterThan(0);
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

    test("renders the text of an attachment message and leaves the attachment card alone", async () => {
        const { message: attachmentMessage, content: attachmentText } = appendWrappedUserMessage(
            env.document,
            "`test`",
        );
        // Mirror DeepSeek's real structure: _8271fc3 marks the message as
        // carrying an attachment; the text element is still matched by
        // fbb737a4 alone
        attachmentText.classList.add("_8271fc3");
        const card = document.createElement("div");
        card.className = "cd314545";
        card.textContent = "README.md MD 291B";
        attachmentMessage.appendChild(card);
        await settle();

        // Only the text element is rendered; the card's labels never leak in
        expect(attachmentText.classList.contains("ds-markdown")).toBeTrue();
        expect(attachmentText.querySelector("code")?.textContent).toBe("test");
        expect(attachmentText.textContent).not.toContain("README.md");
        // The attachment card stays in the DOM, untouched
        expect(card.isConnected).toBeTrue();
        expect(attachmentMessage.querySelector(".cd314545")).toBe(card);
    });

    describe("trailing whitespace", () => {
        test("strips the trailing newline marked appends, so pre-wrap never renders an empty line", async () => {
            const { content } = appendWrappedUserMessage(env.document, "hello");
            await settle();

            // marked outputs "<p>hello</p>\n"; the trailing \n would render as
            // a 28px empty line under the bubble's white-space: pre-wrap
            expect(content.innerHTML.endsWith("</p>")).toBeTrue();
            expect(content.innerHTML.trimEnd()).toBe(content.innerHTML);
        });

        test("keeps a multiline paragraph intact while removing the tail", async () => {
            const { content } = appendWrappedUserMessage(env.document, "line one\nline two");
            await settle();

            const paragraph = content.querySelector("p");
            expect(paragraph?.querySelectorAll("br").length).toBe(1);
            expect(paragraph?.textContent).toBe("line oneline two");
            expect(content.innerHTML.endsWith("</p>")).toBeTrue();
            expect(content.innerHTML.trimEnd()).toBe(content.innerHTML);
        });

        test("preserves newlines inside code fences", async () => {
            const { content } = appendWrappedUserMessage(env.document, "```js\ncode()\n```");
            await settle();

            // The \n inside <code> is meaningful and must survive; only the
            // whitespace after the closing tag is stripped
            expect(content.querySelector(".md-code-block pre")?.textContent).toBe("code()\n");
            expect(content.innerHTML.trimEnd()).toBe(content.innerHTML);
        });
    });

    describe("inter-element newlines", () => {
        function whitespaceOnlyTextNodes(root: HTMLElement): Node[] {
            const nodes: Node[] = [];
            const walk = (node: Node) => {
                for (const child of Array.from(node.childNodes)) {
                    if (child.nodeType === 3) {
                        if (child.textContent?.trim() === "") {
                            nodes.push(child);
                        }
                    } else if (child.nodeType === 1) {
                        walk(child);
                    }
                }
            };
            walk(root);
            return nodes;
        }

        test("drops whitespace-only text nodes between block elements", async () => {
            const { content } = appendWrappedUserMessage(
                env.document,
                [
                    "# 标题",
                    "",
                    "正文段落",
                    "",
                    "- 项目 1",
                    "    - 嵌套 1.1",
                    "- 项目 2",
                    "",
                    "> 引用",
                    "",
                    "1. 第一步",
                    "2. 第二步",
                ].join("\n"),
            );
            await settle();

            // marked emits a \n after every block; under the bubble's
            // white-space: pre-wrap each would render as an empty line
            expect(whitespaceOnlyTextNodes(content).length).toBe(0);
        });

        test("keeps newlines inside code blocks", async () => {
            const { content } = appendWrappedUserMessage(env.document, "```js\nconst a = 1;\n\nconst b = 2;\n```");
            await settle();

            expect(content.querySelector(".md-code-block pre")?.textContent).toBe("const a = 1;\n\nconst b = 2;\n");
            expect(whitespaceOnlyTextNodes(content).length).toBe(0);
        });

        test("keeps spaces between inline elements", async () => {
            const { content } = appendWrappedUserMessage(env.document, "a <em>b</em> c");
            await settle();

            const paragraph = content.querySelector("p");
            expect(paragraph?.textContent).toBe("a b c");
            // the two spaces survive as their own wrapped spans
            expect(paragraph?.querySelectorAll("span").length).toBe(3);
        });
    });

    describe("block boundary guards", () => {
        test("keeps a blank line before --- so it renders as <hr>, not a setext heading", async () => {
            const { content } = appendWrappedUserMessage(
                env.document,
                "以下是三种分割线写法（效果相同）：\n\n---\n***\n___",
            );
            await settle();

            expect(content.querySelector("h2")).toBeNull();
            expect(content.querySelector("p")?.textContent).toBe("以下是三种分割线写法（效果相同）：");
            expect(content.querySelectorAll("hr").length).toBe(3);
        });

        test("keeps footnote definitions in their own paragraph", async () => {
            const { content } = appendWrappedUserMessage(
                env.document,
                "这里有一个脚注的示例[^1]，这是一个独立的脚注[^footnote]。\n\n[^1]: 这是脚注 1 的具体内容，可以写较长的文字说明。\n[^footnote]: 这是另一个脚注的内容。",
            );
            await settle();

            const paragraphs = content.querySelectorAll("p");
            expect(paragraphs.length).toBe(2);
            expect(paragraphs[0]?.textContent).toContain("这里有一个脚注的示例[^1]");
            expect(paragraphs[1]?.textContent).toContain("[^1]: 这是脚注 1 的具体内容");
        });

        test("an explicit <br> does not multiply into three line breaks", async () => {
            const { content } = appendWrappedUserMessage(env.document, "复制文本。\n<br>\n红色文字");
            await settle();

            const paragraph = content.querySelector("p");
            expect(paragraph?.querySelectorAll("br").length).toBe(1);
            expect(paragraph?.textContent).toBe("复制文本。红色文字");
        });
    });

    describe("fence and code-span protection", () => {
        test("keeps blank-line collapse working after a mismatched fence close", async () => {
            const { content } = appendWrappedUserMessage(
                env.document,
                ["```js", "a", "~~~", "b", "", "", "c", "```", "", "tail", "", "", "tail2"].join("\n"),
            );
            await settle();

            // ~~~ cannot close a backtick fence, so the fence still closes at
            // the real ```, and the blank lines after it collapse normally
            // ("tail\n\n\ntail2" is 3 newlines → 2 line breaks)
            const pre = content.querySelector("pre");
            expect(pre?.textContent).toBe("a\n~~~\nb\n\n\nc\n");
            const paragraphs = content.querySelectorAll("p");
            expect(paragraphs.length).toBe(1);
            expect(paragraphs[0]?.querySelectorAll("br").length).toBe(2);
        });

        test("closes a fence with a longer backtick run", async () => {
            const { content } = appendWrappedUserMessage(
                env.document,
                ["```js", "x = 1", "````", "", "after", "", "end"].join("\n"),
            );
            await settle();

            const pre = content.querySelector("pre");
            expect(pre?.textContent).toBe("x = 1\n");
            expect(content.querySelectorAll("p").length).toBe(1);
        });

        test("keeps blank lines inside inline code spans", async () => {
            const { content } = appendWrappedUserMessage(env.document, "before `code\n\nmore` after");
            await settle();

            // A code span cannot cross a blank line: markdown ends the
            // paragraph there, so the blank line must be preserved and the
            // span splits into two paragraphs with literal backticks. The old
            // regex collapsed the blank line away and swallowed the backticks
            // into a flattened code span ("before code more after").
            const paragraphs = content.querySelectorAll("p");
            expect(paragraphs.length).toBe(2);
            expect(paragraphs[0]?.textContent).toBe("before `code");
            expect(paragraphs[1]?.textContent).toBe("more` after");
        });
    });

    describe("observer-driven re-rendering", () => {
        test("re-renders when the message text changes in place (characterData)", async () => {
            const { content } = appendWrappedUserMessage(env.document, "**bold v1**");
            await settle();
            expect(content.querySelector("strong")?.textContent).toBe("bold v1");

            // React updates text nodes in place via nodeValue — a characterData
            // mutation — which the observer must pick up and re-render
            const textNode = content.querySelector("p span")?.firstChild;
            if (!textNode) {
                throw new Error("fixture missing text node");
            }
            textNode.nodeValue = "**bold v2**";
            await settle();

            expect(content.querySelector("strong")?.textContent).toBe("bold v2");
        });

        test("re-renders code blocks when the theme changes", async () => {
            env.document.body.classList.add("dark");
            const { content } = appendWrappedUserMessage(env.document, "```js\nconst x = 1;\n```");
            await settle();
            expect(content.querySelector(".md-code-block")?.classList.contains("md-code-block-dark")).toBeTrue();

            env.document.body.classList.remove("dark");
            await settle();
            const block = content.querySelector(".md-code-block");
            expect(block?.classList.contains("md-code-block-light")).toBeTrue();
            expect(block?.classList.contains("md-code-block-dark")).toBeFalse();
        });
    });
});
