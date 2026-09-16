import { describe, expect, test } from "bun:test";
import {
    appendAssistantMessage,
    appendAssistantMessageWithThinking,
    appendMessageWithActions,
    appendUserMessage,
    loadUserscript,
    settle,
    setupTampermonkeyEnv,
} from "./env";

const env = setupTampermonkeyEnv();

const raw = ["# 标题", "", "正文 **加粗** 与 `代码`", "", "```python", "print(1)", "```"].join("\n");

// The assistant message the toggle is injected into
const assistant = appendAssistantMessage(env.document, raw, {
    rendered: "<h1>标题</h1><p>正文 <strong>加粗</strong> 与 <code>代码</code></p>",
});
// A second message to prove the toggles are independent
const second = appendAssistantMessage(env.document, "第二段 **内容**", {
    rendered: "<p>第二段 <strong>内容</strong></p>",
});
// A message without a readable React fiber must not get a button
const sourceless = appendAssistantMessage(env.document, "cannot read me", {
    withFiber: false,
    rendered: "<p>cannot read me</p>",
});
// A normal user message must stay untouched by the assistant logic
const userMessage = appendUserMessage(env.document, "**user text**");
// A reply that also renders a reasoning chain: the toggle must use the reply
// column and the `markdown` prop, never the thinking chain
const withThinking = appendAssistantMessageWithThinking(env.document, "推理过程秘密", "最终答案内容", {
    rendered: "<p>最终答案内容</p>",
});

await loadUserscript();

function clickOn(el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("click", { bubbles: true }));
}

// The action row is a SIBLING of the reply message in the current build, so the
// injected toggle and the raw <pre> live in the shared list item (parent), not
// inside the reply .ds-message itself
function item(message: HTMLElement): HTMLElement {
    return message.parentElement as HTMLElement;
}

function rawToggle(message: HTMLElement): HTMLElement | null {
    return item(message).querySelector("[data-md-raw-toggle]");
}

// The raw view is a native code block, so the SOURCE TEXT lives inside the
// <pre>; the wrapper (which also carries the language banner) is the container
function rawSource(message: HTMLElement): HTMLElement | null {
    return rawContainer(message)?.querySelector("pre") ?? null;
}

function rawContainer(message: HTMLElement): HTMLElement | null {
    return item(message).querySelector(".md-raw-source");
}

function markdownColumn(message: HTMLElement): HTMLElement {
    return message.querySelector(".ds-assistant-message-main-content") as HTMLElement;
}

/**
 * Pin one message's view before a test that cares about a direction.
 *
 * The toggle is a view switch, so these tests used to inherit whatever the
 * previous test left behind — which meant one failure cascaded into every later
 * test, and a test could pass only because of the order it ran in. Each test now
 * states the state it needs.
 */
function setRawMode(message: HTMLElement, open: boolean): void {
    const button = rawToggle(message);
    if (!button) {
        throw new Error("fixture missing toggle");
    }
    if ((button.getAttribute("aria-pressed") === "true") !== open) {
        clickOn(button);
    }
}

describe("assistant raw/rendered toggle", () => {
    test("injects the toggle at load without altering the assistant message", () => {
        const button = rawToggle(assistant.message);
        expect(button).not.toBeNull();
        // Appended at the FAR RIGHT of the button row, so it reads as an extra
        // utility rather than interrupting the native button order
        expect(button?.parentElement).toBe(assistant.copyButton.parentElement);
        expect(button?.nextElementSibling).toBeNull();
        // After the LAST native button (copy, reply, ...), not sandwiched between
        // them
        expect(button?.previousElementSibling).toBe(assistant.actionRow.querySelectorAll('[role="button"]')[1]);
        // Default state is rendered
        expect(rawSource(assistant.message)).toBeNull();
        expect(markdownColumn(assistant.message).getAttribute("data-md-raw-mode")).toBeNull();
        expect(button?.getAttribute("aria-pressed")).toBe("false");
    });

    test("mirrors the neighbouring copy button so native CSS (hover) applies", () => {
        const button = rawToggle(assistant.message);
        for (const cls of ["ds-button", "ds-button--iconLabelTertiary", "ds-button--icon", "ds-button--xs"]) {
            expect(button?.classList.contains(cls), cls).toBeTrue();
        }
        // The whole native structure is cloned, including the background element
        // that paints hover/active/focus
        expect(button?.querySelector(".ds-button__background")).not.toBeNull();
        expect(button?.querySelector(".ds-button__icon")).not.toBeNull();
        expect(button?.querySelector("svg")).not.toBeNull();
        // ...but the copy button's identity must not be duplicated onto ours
        expect(button?.id).toBe("");
        expect(assistant.copyButton.id).toBe("native-copy-button");
        // The hint rides on our own attribute (drawn by the token-styled tooltip),
        // never on `title`, so the browser's unstyled box cannot appear
        expect(button?.getAttribute("data-md-raw-tip")).toBe("显示源码");
        expect(button?.getAttribute("aria-label")).toBe("显示源码");
        expect(button?.hasAttribute("title")).toBeFalse();
        // Same element shape as the native button it was cloned from
        expect(Array.from(button?.children ?? []).map((c) => c.className)).toEqual(
            Array.from(assistant.copyButton.children).map((c) => c.className),
        );
    });

    test("draws the inline file-code-corner glyph as a stroked outline", () => {
        const svg = rawToggle(assistant.message)?.querySelector("svg");
        const paths = Array.from(svg?.querySelectorAll("path") ?? []);
        // The mark is lucide's "file-code-corner": the file outline, its folded
        // corner, and the two `</>` chevrons — all hard-coded here, so the button
        // never reaches out to a CDN or an icon service
        expect(paths.length).toBe(4);
        expect(paths[0]?.getAttribute("d")).toContain("M4 12.15V4");
        expect(svg?.querySelector("use, image")).toBeNull();
        expect(svg?.outerHTML ?? "").not.toContain("href");
        // A stroke-only outline: filling these open subpaths would flood them, and
        // an inherited native `fill` is exactly how the previous glyph went wrong
        expect(svg?.getAttribute("fill")).toBe("none");
        expect(svg?.getAttribute("stroke")).toBe("currentColor");
        expect(svg?.getAttribute("stroke-width")).toBe("2");
        expect(svg?.getAttribute("stroke-linecap")).toBe("round");
        expect(svg?.getAttribute("stroke-linejoin")).toBe("round");
        for (const path of paths) {
            expect(path.getAttribute("fill")).toBe("none");
        }
        // Authored on lucide's 24x24 grid and scaled into the native icon's box,
        // which is adopted rather than hardcoded
        expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg?.getAttribute("width")).toBe("16");
    });

    test("shows the raw Markdown source on click and hides the rendered column", () => {
        setRawMode(assistant.message, false);
        const button = rawToggle(assistant.message) as HTMLElement;
        clickOn(button);

        const column = markdownColumn(assistant.message);
        expect(column.getAttribute("data-md-raw-mode")).toBe("1");
        // The source is shown verbatim, as text (never as live HTML)
        const pre = rawSource(assistant.message);
        expect(pre?.textContent).toBe(raw);
        // …inside a native md-code-block, with the language banner and the
        // page's own syntax token classes, exactly like a fenced block. This is
        // what makes the two views unmistakably different at a glance.
        const container = rawContainer(assistant.message);
        expect(container?.classList.contains("ds-markdown")).toBeTrue();
        expect(container?.querySelector(".md-code-block")).not.toBeNull();
        expect(container?.querySelector(".d813de27")?.textContent).toBe("markdown");
        expect(container?.querySelector("span.token")).not.toBeNull();
        // The wrapper itself must NOT be a pre: a <pre> here would render the
        // language banner and the source as one preformatted line of text.
        expect(container?.tagName).toBe("DIV");
        expect(button.getAttribute("aria-pressed")).toBe("true");
        // The active state is exposed for the native-background tint
        expect(button.getAttribute("data-md-raw-active")).toBe("1");
        // …and the hint now offers the way back, on both the tooltip and the
        // accessible name
        expect(button.getAttribute("data-md-raw-tip")).toBe("显示预览");
        expect(button.getAttribute("aria-label")).toBe("显示预览");
    });

    test("returns to the rendered view on the second click", () => {
        setRawMode(assistant.message, true);
        const button = rawToggle(assistant.message) as HTMLElement;
        clickOn(button);

        expect(rawSource(assistant.message)).toBeNull();
        expect(markdownColumn(assistant.message).getAttribute("data-md-raw-mode")).toBeNull();
        expect(button.getAttribute("aria-pressed")).toBe("false");
        // The hint switches back to offering the source
        expect(button.getAttribute("data-md-raw-tip")).toBe("显示源码");
    });

    test("never mutates the host's rendered nodes", () => {
        setRawMode(assistant.message, false);
        const column = markdownColumn(assistant.message);
        const before = column.innerHTML;
        const childrenBefore = Array.from(column.children);
        clickOn(rawToggle(assistant.message) as HTMLElement);
        clickOn(rawToggle(assistant.message) as HTMLElement);

        expect(column.innerHTML).toBe(before);
        expect(Array.from(column.children)).toEqual(childrenBefore);
        // The copy button the host recorded stays valid and in place
        expect(assistant.copyButton.isConnected).toBeTrue();
        expect(assistant.copyButton.parentElement).toBe(assistant.actionRow.firstElementChild);
    });

    test("is idempotent across observer scans", async () => {
        setRawMode(assistant.message, false);
        const button = rawToggle(assistant.message) as HTMLElement;
        clickOn(button);
        await settle();

        // Exactly one button and one raw-source block, even after re-scans
        expect(assistant.group.querySelectorAll("[data-md-raw-toggle]").length).toBe(1);
        expect(assistant.message.querySelectorAll(".md-raw-source").length).toBe(1);
        // The raw view sits immediately after the rendered column, and the
        // source <pre> is nested inside the wrapper (not a sibling of it)
        expect(rawContainer(assistant.message)?.previousElementSibling).toBe(markdownColumn(assistant.message));
        expect(rawContainer(assistant.message)?.contains(rawSource(assistant.message))).toBeTrue();
        expect(button.isConnected).toBeTrue();
    });

    test("rebuilds the raw view at most once, and never starves the timer queue", async () => {
        // Regression: an open raw view used to rebuild itself on EVERY observer
        // scan. Each rebuild is another DOM mutation, which schedules another
        // scan (queueMicrotask), and that unbounded chain starves every timer
        // and freezes the page. The view must survive repeated scans unchanged,
        // and timers must keep firing while it is open.
        setRawMode(assistant.message, true);
        await settle();
        const first = rawContainer(assistant.message);

        // Direct children of the list item: a rebuild REPLACES the raw container,
        // which shows up here even if the identity check were to miss it. The
        // action row is a descendant, so the host churn below does not count.
        let childMutations = 0;
        const observer = new env.window.MutationObserver((records) => {
            childMutations += records.length;
        });
        observer.observe(item(assistant.message), { childList: true });

        let timerTicks = 0;
        const timer = setInterval(() => {
            timerTicks += 1;
        }, 5);
        // Each removal is a mutation that triggers a scan (the button's own
        // observer filter), so this drives many scans with the raw view open
        for (let i = 0; i < 8; i++) {
            rawToggle(assistant.message)?.remove();
            await settle(15);
        }
        clearInterval(timer);
        observer.disconnect();

        expect(rawContainer(assistant.message)).toBe(first);
        expect(assistant.message.querySelectorAll(".md-raw-source").length).toBe(1);
        // A stable view is not replaced while scans run
        expect(childMutations).toBe(0);
        expect(rawToggle(assistant.message)).not.toBeNull();
        expect(timerTicks).toBeGreaterThan(0);
    });

    test("re-injects the toggle when the host re-renders the action row", async () => {
        const button = rawToggle(assistant.message) as HTMLElement;
        // Simulate the host replacing the row's children (React commit)
        button.remove();
        await settle();

        expect(assistant.group.querySelectorAll("[data-md-raw-toggle]").length).toBe(1);
        expect(assistant.copyButton.isConnected).toBeTrue();
    });

    test("keeps the raw view when the host re-renders the action row", async () => {
        setRawMode(assistant.message, true);
        const button = rawToggle(assistant.message) as HTMLElement;
        expect(button.getAttribute("aria-pressed")).toBe("true");
        button.remove();
        await settle();

        expect(rawSource(assistant.message)?.textContent).toBe(raw);
        const fresh = rawToggle(assistant.message);
        expect(fresh?.getAttribute("aria-pressed")).toBe("true");
    });

    test("toggles each message independently", () => {
        // Pin both messages: the first in rendered mode, the second in raw
        setRawMode(assistant.message, false);
        setRawMode(second.message, false);
        const other = rawToggle(second.message) as HTMLElement;
        clickOn(other);

        expect(rawSource(second.message)?.textContent).toBe("第二段 **内容**");
        expect(second.message.querySelectorAll(".md-raw-source").length).toBe(1);
        // The first message is unaffected
        expect(rawSource(assistant.message)).toBeNull();
        clickOn(other);
    });

    test("does not inject a toggle when the raw source cannot be read", () => {
        expect(rawToggle(sourceless.message)).toBeNull();
        // The rendered message stays exactly as the host rendered it
        expect(sourceless.markdown.textContent).toBe("cannot read me");
    });

    test("leaves user messages untouched", () => {
        expect(userMessage.parentElement?.querySelector("[data-md-raw-toggle]")).toBeNull();
        expect(userMessage.querySelector(".ds-markdown")).not.toBeNull();
    });

    test("does not inject a toggle into user messages that expose a React fiber", async () => {
        // User messages are rendered by this script and carry a ds-markdown
        // column; in the real page they also have a React fiber whose props hold
        // the user's text. The toggle must still stay assistant-only, or the
        // exclusion is only passing because the fixtures lack a fiber.
        const { message } = appendMessageWithActions(env.document, "**user with fiber**");
        const textEl = message.querySelector(".fbb737a4") as HTMLElement;
        Object.defineProperty(textEl, "__reactFiber$user", {
            value: { memoizedProps: { content: "**user with fiber**" }, return: null },
            enumerable: true,
            configurable: true,
        });
        await settle();

        expect(textEl.classList.contains("ds-markdown")).toBeTrue();
        expect(message.querySelector("[data-md-raw-toggle]")).toBeNull();
    });

    test("uses the reply source, not the reasoning chain, when both are rendered", () => {
        // The thinking block renders its own div.ds-markdown and exposes
        // `content`; the reply exposes `markdown`. Picking the wrong one would
        // show the private reasoning as the "raw" source.
        const thinkingEl = withThinking.message.querySelector(".ds-think-content .ds-markdown");
        expect(thinkingEl?.textContent).toBe("已经思考过了");

        setRawMode(withThinking.message, true);
        expect(rawSource(withThinking.message)?.textContent).toBe("最终答案内容");
        // The reasoning column stays visible and untouched
        expect(thinkingEl?.isConnected).toBeTrue();
        expect(thinkingEl?.textContent).toBe("已经思考过了");
        // Only the reply column is hidden
        expect(markdownColumn(withThinking.message).getAttribute("data-md-raw-mode")).toBe("1");
        setRawMode(withThinking.message, false);
    });

    test("renders the source as literal text, never as live HTML", async () => {
        const dangerous = appendAssistantMessage(env.document, "<img src=x onerror=alert(1)>", {
            rendered: "<p>img</p>",
        });
        // Appended after load: the observer injects the toggle on its own
        await settle();
        clickOn(rawToggle(dangerous.message) as HTMLElement);

        const pre = rawSource(dangerous.message);
        expect(pre?.textContent).toBe("<img src=x onerror=alert(1)>");
        // textContent assignment means no element is ever created
        expect(pre?.querySelector("img")).toBeNull();
    });
});
