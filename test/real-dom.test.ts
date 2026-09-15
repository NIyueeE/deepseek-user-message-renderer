import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendUserMessage, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

/**
 * Integration tests against the REAL DeepSeek DOM.
 *
 * `test/fixtures/deepseek-chat.html` is a verbatim capture of a live chat page
 * (see the header of `test/fixtures/README.md`). The unit tests elsewhere build
 * small hand-written fixtures, which is right for pinning behaviour but cannot
 * notice that DeepSeek renamed or restructured something: a fixture the test
 * author invented always agrees with the selectors the test author wrote.
 *
 * This capture is the rich one: it kept the page's external stylesheets, so it
 * contains the real syntax-highlight palette AND real rendered code blocks
 * (javascript, python) with 34 live token spans. That makes it the reference we
 * diff our own rebuilt `md-code-block` against — see
 * "matches DeepSeek's own code block" below.
 *
 * The capture keeps the DOM but not React's internals, so the assistant reply's
 * source is supplied by a synthetic fibre shaped like the live one.
 */
const FIXTURE = join(import.meta.dir, "fixtures", "deepseek-chat.html");
// The reply source we hand to the synthetic fibre for the first reply
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

const env = setupTampermonkeyEnv();
env.window.document.write(readFileSync(FIXTURE, "utf-8"));

// Install the synthetic React fibres BEFORE the userscript runs, so its very
// first scan sees them (matching the live page, where React is already mounted).
for (const md of env.document.querySelectorAll("._4f9bf79 .ds-assistant-message-main-content")) {
    const component = { memoizedProps: { markdown: REPLY_MARKDOWN }, return: null };
    const domFiber = { memoizedProps: { className: md.className }, return: component };
    Object.defineProperty(md, "__reactFiber$fixture", {
        value: domFiber,
        enumerable: true,
        configurable: true,
    });
}

await loadUserscript();
await settle();

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
            if (cls === "token") continue;
            kinds.add(cls);
        }
    }
    return [...kinds].sort();
}

describe("real DeepSeek DOM", () => {
    test("the capture still contains the elements the script targets", () => {
        // These are the page's own class names. A failure here means DeepSeek's
        // build changed and the script's selectors need re-deriving — which is
        // exactly the signal these tests exist to give.
        expect(env.document.querySelectorAll("._9663006").length).toBe(2); // user groups
        expect(env.document.querySelectorAll("div.fbb737a4").length).toBe(2); // user text elements
        expect(env.document.querySelectorAll(".ds-collapsible-text").length).toBe(2);
        expect(env.document.querySelectorAll("._4f9bf79").length).toBe(2); // assistant items
        expect(env.document.querySelectorAll(".ds-assistant-message-main-content").length).toBe(2);
        // Both replies are complete, but DeepSeek mounts the action bar lazily and
        // the LAST reply had none at capture time. The script must therefore
        // inject only where a row exists (and rely on its observer for the rest).
        expect(env.document.querySelectorAll("._0a3d93b").length).toBe(1);
    });

    test("the capture carries real rendered code blocks with live token spans", () => {
        // This is what makes the capture a styling reference rather than just a
        // selector fixture. If it ever drops to zero, the styling assertions in
        // this file silently stop testing anything.
        expect(env.document.querySelectorAll(".md-code-block").length).toBeGreaterThanOrEqual(2);
        const blocks = [...env.document.querySelectorAll(".md-code-block")].filter((b) => b.querySelector("pre"));
        expect(blocks.length).toBe(2);
        const totalTokens = env.document.querySelectorAll(".md-code-block pre .token").length;
        expect(totalTokens).toBeGreaterThan(20);
        // The real blocks are pre-highlighted by the page itself
        expect(tokenKinds(blocks[0] as Element).length).toBeGreaterThan(0);
    });

    test("renders the real collapsible user messages and keeps the host's own children", () => {
        const boxes = [...env.document.querySelectorAll(".ds-collapsible-text")];
        expect(boxes.length).toBe(2);
        for (const box of boxes) {
            // Our Markdown lives in a sibling inside the collapsible container…
            const md = box.querySelector(".md-user-markdown");
            expect(md).not.toBeNull();
            expect(md?.classList.contains("ds-markdown")).toBeTrue();
            // …and the host's own node is still there, holding the ORIGINAL raw
            // text (not our rendered output), so React's recorded node stays
            // valid and the host can still measure it
            const hostChild = box.firstElementChild;
            expect(hostChild).not.toBeNull();
            expect(hostChild?.classList.contains("md-user-markdown")).toBeFalse();
            expect(box.getAttribute("data-md-collapsible")).toBe("1");
            // The inline max-height DeepSeek measures against must survive
            expect(box.getAttribute("style")).toContain("max-height");
        }
        // The captured prompts are the real ones
        const raw = boxes.map((b) => b.firstElementChild?.textContent ?? "");
        expect(raw[0]?.startsWith("给我一个完整markdown语法例子")).toBeTrue();
        expect(raw[1]?.startsWith("给我一个完整mermaid语法例子")).toBeTrue();
    });

    test("injects a raw toggle into every assistant action bar there is", () => {
        // The capture has two replies but only one action row (the last reply had
        // none when saved), so exactly one toggle is injected. This is the
        // faithful behaviour: no row, no toggle — the observer adds one if the
        // row is mounted later.
        const toggles = env.document.querySelectorAll("[data-md-raw-toggle]");
        expect(toggles.length).toBe(1);
        for (const item of env.document.querySelectorAll("._4f9bf79")) {
            const toggle = item.querySelector("[data-md-raw-toggle]");
            if (!item.querySelector("._0a3d93b")) {
                expect(toggle).toBeNull();
                continue;
            }
            expect(toggle).not.toBeNull();
            // Reuses the native button's classes and structure, so the page's
            // own stylesheet renders it like its neighbours
            expect(toggle?.classList.contains("ds-button")).toBeTrue();
            expect(toggle?.classList.contains("ds-button--xs")).toBeTrue();
            expect(toggle?.querySelector(".ds-button__background")).not.toBeNull();
            // Appended last: the action bar keeps its native button order
            const row = item.querySelector("._0a3d93b") as Element;
            const buttons = row.querySelectorAll("[role=button]");
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

        // The raw view is a native code block: the source text is the <pre>'s
        // text (the wrapper also carries the language banner, so its own
        // textContent starts with "markdown")
        const container = env.document.querySelector(".md-raw-source") as HTMLElement;
        const pre = container?.querySelector("pre") as HTMLElement;
        expect(pre?.textContent).toBe(REPLY_MARKDOWN);
        expect(container?.querySelector(".md-code-block")).not.toBeNull();
        expect(container?.querySelector(".d813de27")?.textContent).toBe("markdown");
        // The rendered column is hidden, and the raw source carries the native
        // markdown class so the page's own typography applies
        const column = env.document.querySelector("._4f9bf79 .ds-assistant-message-main-content");
        expect(column?.getAttribute("data-md-raw-mode")).toBe("1");
        expect(container?.classList.contains("ds-markdown")).toBeTrue();

        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));
        await settle();
        expect(env.document.querySelector(".md-raw-source")).toBeNull();
        expect(column?.getAttribute("data-md-raw-mode")).toBeNull();
    });

    test("a fence the script renders matches DeepSeek's own code block structure", async () => {
        // The payoff of capturing the page's own stylesheets: this is a diff of
        // OUR rebuilt block against a block DEEPSEEK rendered, on the same page.
        const native = [...env.document.querySelectorAll(".md-code-block")].find(
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

    test("finds the edit button by the real pencil icon", () => {
        // The edit button is identified by its SVG path prefix; this asserts the
        // prefix still matches the icon the page actually ships.
        const EDIT_PREFIX = "M9.94076 1.34942";
        const paths = [...env.document.querySelectorAll("._9663006 svg path")];
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

    test("does not touch DeepSeek's own code blocks in the assistant reply", () => {
        // The script renders USER messages; the assistant's blocks are the
        // page's own output and must be left exactly as captured.
        const nativeBlocks = [...env.document.querySelectorAll("._4f9bf79 .md-code-block")];
        expect(nativeBlocks.length).toBeGreaterThanOrEqual(2);
        for (const block of nativeBlocks) {
            expect(block.closest(".md-user-markdown")).toBeNull();
            expect(block.classList.contains("md-raw-source")).toBeFalse();
        }
    });
});
