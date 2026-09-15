import { describe, expect, test } from "bun:test";
import { describeCaptureBattery, loadCapture } from "./capture";
import { appendUserMessage, settle } from "./env";

/**
 * Integration tests against the REAL DeepSeek DOM.
 *
 * `test/fixtures/deepseek-chat.html` is a verbatim capture of a live chat page
 * (see `test/fixtures/README.md`). The unit tests elsewhere build small
 * hand-written fixtures, which is right for pinning behaviour but cannot notice
 * that DeepSeek renamed or restructured something: a fixture the test author
 * invented always agrees with the selectors the test author wrote.
 *
 * This capture is the rich one: it kept the page's external stylesheets, so it
 * contains the real syntax palette AND real rendered code blocks (javascript,
 * python) with 34 live token spans. That makes it the reference the script's own
 * rebuilt `md-code-block` is diffed against below.
 *
 * The battery shared with the other captures lives in `./capture`.
 */
const REPLY_MARKDOWN = [
    "# Markdown 语法完整示例",
    "",
    "段落与 **粗体** 与 `行内代码`。",
    "",
    "```javascript",
    "function greet(name) {",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the JS source under test, not a template we interpolate
    "  console.log(`Hello, ${name}!`);",
    "}",
    "```",
].join("\n");

const capture = await loadCapture({ fixture: "deepseek-chat", replyMarkdown: REPLY_MARKDOWN });
const { env } = capture;

describeCaptureBattery(capture, { toggles: 1 });

/** The structural skeleton of a code block, for diffing ours against DeepSeek's. */
function blockSkeleton(block: Element) {
    return {
        wrapper: [...block.classList].sort(),
        children: [...block.children].map((c) => c.tagName.toLowerCase()),
        banner: block.querySelector(".md-code-block-banner")?.className ?? null,
        label: block.querySelector(".d813de27")?.textContent ?? null,
        corners: [...block.querySelectorAll(":scope > svg")].map((s) => s.getAttribute("class")),
    };
}

/** Every token class CONVENTION used inside a block (e.g. "keyword", "string"). */
function tokenKinds(block: Element): string[] {
    const kinds = new Set<string>();
    for (const tok of block.querySelectorAll("pre .token")) {
        for (const cls of tok.classList) {
            if (cls !== "token") {
                kinds.add(cls);
            }
        }
    }
    return [...kinds].sort();
}

describe("the light capture's own shape", () => {
    test("still contains the elements the script targets", () => {
        // These are the page's own class names. A failure here means DeepSeek's
        // build changed and the script's selectors need re-deriving — which is
        // exactly the signal these tests exist to give.
        expect(env.document.querySelectorAll("._9663006").length).toBe(2); // user groups
        expect(env.document.querySelectorAll("div.fbb737a4").length).toBe(2); // user text elements
        expect(env.document.querySelectorAll(".ds-collapsible-text").length).toBe(2);
        expect(env.document.querySelectorAll("._4f9bf79").length).toBe(2); // assistant items
        expect(env.document.querySelectorAll(".ds-assistant-message-main-content").length).toBe(2);
        // Both replies are complete, but DeepSeek mounts the action bar lazily and
        // the LAST reply had none at capture time — which is why only one toggle
        // is injected (asserted in the battery).
        expect(env.document.querySelectorAll("._0a3d93b").length).toBe(1);
    });

    test("carries real rendered code blocks with live token spans", () => {
        // This is what makes the capture a styling reference rather than just a
        // selector fixture. If it ever drops to zero, the structural diff below
        // silently stops testing anything.
        const blocks = [...env.document.querySelectorAll("._4f9bf79 .md-code-block")].filter((b) =>
            b.querySelector("pre"),
        );
        expect(blocks.length).toBe(2);
        expect(env.document.querySelectorAll(".md-code-block pre .token").length).toBeGreaterThan(20);
        expect(tokenKinds(blocks[0] as Element).length).toBeGreaterThan(0);
    });

    test("renders the real collapsible user messages' content", () => {
        // The capture's prompts are Chinese prose, so this pins that the real text
        // round-trips (wrapper whitespace, CJK, no mangling) — the shared battery
        // covers the host-node invariants.
        const boxes = [...env.document.querySelectorAll(".ds-collapsible-text")];
        const raw = boxes.map((b) => b.firstElementChild?.textContent ?? "");
        expect(raw[0]?.startsWith("给我一个完整markdown语法例子")).toBeTrue();
        expect(raw[1]?.startsWith("给我一个完整mermaid语法例子")).toBeTrue();
        for (const box of boxes) {
            expect(box.querySelector(".md-user-markdown p")?.classList.contains("ds-markdown-paragraph")).toBeTrue();
        }
    });

    test("a fence the script renders matches DeepSeek's own code block structure", async () => {
        // The payoff of capturing the page's own stylesheets: a diff of OUR
        // rebuilt block against a block DEEPSEEK rendered, on the same page.
        const native = [...env.document.querySelectorAll("._4f9bf79 .md-code-block")].find(
            (b) => b.querySelector("pre") && b.querySelector(".d813de27")?.textContent === "javascript",
        ) as Element;
        expect(native).toBeDefined();

        // Render the same language through the script's own pipeline
        appendUserMessage(env.document, "```javascript\nfunction greet(name) {\n  return name;\n}\n```");
        await settle();
        const ours = [...env.document.querySelectorAll("._9663006 .md-code-block")].find(
            (b) => b.querySelector(".d813de27")?.textContent === "javascript",
        ) as Element;
        expect(ours).toBeDefined();

        // Structure must be identical: same wrapper classes, same child order
        // (banner, pre, corner, corner), same banner markup, same corners.
        expect(blockSkeleton(ours)).toEqual(blockSkeleton(native));

        // The ONE deliberate difference: we put the language class on the <pre>
        // so the page's own `pre[class*=language-]` rules (selection colours)
        // apply to our block. DeepSeek's own <pre> is bare.
        expect(ours.querySelector("pre")?.className).toBe("language-javascript");
        expect(native.querySelector("pre")?.className).toBe("");

        // Both use the page's token-class convention, which is what the script's
        // hljs -> Prism mapping targets
        expect(tokenKinds(ours).length).toBeGreaterThan(0);
        for (const kind of tokenKinds(ours)) {
            expect(kind).toMatch(/^[a-z-]+$/);
        }
    });

    test("does not touch DeepSeek's own code blocks in the assistant reply", () => {
        // The script renders USER messages; the assistant's blocks are the page's
        // own output and must be left exactly as captured.
        const nativeBlocks = [...env.document.querySelectorAll("._4f9bf79 .md-code-block")];
        expect(nativeBlocks.length).toBeGreaterThanOrEqual(2);
        for (const block of nativeBlocks) {
            expect(block.closest(".md-user-markdown")).toBeNull();
            expect(block.classList.contains("md-raw-source")).toBeFalse();
        }
    });
});
