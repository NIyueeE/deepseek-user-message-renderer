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

function rawSource(message: HTMLElement): HTMLElement | null {
    return item(message).querySelector(".md-raw-source");
}

function markdownColumn(message: HTMLElement): HTMLElement {
    return message.querySelector(".ds-assistant-message-main-content") as HTMLElement;
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
        expect(button?.getAttribute("data-md-raw-tip")).toBe("查看原始 Markdown");
        expect(button?.hasAttribute("title")).toBeFalse();
        // Same element shape as the native button it was cloned from
        expect(Array.from(button?.children ?? []).map((c) => c.className)).toEqual(
            Array.from(assistant.copyButton.children).map((c) => c.className),
        );
    });

    test("draws a real </> glyph as a single filled path", () => {
        const svg = rawToggle(assistant.message)?.querySelector("svg");
        const path = svg?.querySelector("path");
        const d = path?.getAttribute("d") ?? "";
        // Three closed subpaths: left chevron, slash, right chevron. Dropping the
        // slash (a regression that shipped once) turns "</>" into "<>" and the
        // button no longer says what it does.
        expect(d.split("M").filter(Boolean).length).toBe(3);
        expect(d.split("z").filter(Boolean).length).toBe(3);
        // DeepSeek's icons are solid fills with no stroke (verified against the
        // live action bar). Inheriting `fill` while also stroking the path painted
        // the mark twice, which is what made it look fat and blobby.
        expect(path?.getAttribute("fill")).toBe("currentColor");
        expect(path?.hasAttribute("stroke")).toBeFalse();
        // The native icon's geometry is adopted, not a hardcoded size
        expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
    });

    test("shows the raw Markdown source on click and hides the rendered column", () => {
        const button = rawToggle(assistant.message);
        if (!button) {
            throw new Error("fixture missing toggle");
        }
        clickOn(button);

        const column = markdownColumn(assistant.message);
        expect(column.getAttribute("data-md-raw-mode")).toBe("1");
        // The raw source is rendered verbatim, as text (never as HTML)
        const pre = rawSource(assistant.message);
        expect(pre?.textContent).toBe(raw);
        expect(pre?.tagName).toBe("PRE");
        // It carries the native markdown container class so the page's own
        // typography and theme colours apply to it
        expect(pre?.classList.contains("ds-markdown")).toBeTrue();
        expect(button.getAttribute("aria-pressed")).toBe("true");
        // The active state is exposed for the native-background tint
        expect(button.getAttribute("data-md-raw-active")).toBe("1");
    });

    test("returns to the rendered view on the second click", () => {
        const button = rawToggle(assistant.message);
        if (!button) {
            throw new Error("fixture missing toggle");
        }
        clickOn(button);

        expect(rawSource(assistant.message)).toBeNull();
        expect(markdownColumn(assistant.message).getAttribute("data-md-raw-mode")).toBeNull();
        expect(button.getAttribute("aria-pressed")).toBe("false");
    });

    test("never mutates the host's rendered nodes", () => {
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
        const button = rawToggle(assistant.message) as HTMLElement;
        clickOn(button);
        await settle();

        // Exactly one button and one raw-source block, even after re-scans
        expect(assistant.group.querySelectorAll("[data-md-raw-toggle]").length).toBe(1);
        expect(assistant.message.querySelectorAll(".md-raw-source").length).toBe(1);
        expect(rawSource(assistant.message)?.previousElementSibling).toBe(markdownColumn(assistant.message));
        expect(button.isConnected).toBeTrue();
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
        const button = rawToggle(assistant.message) as HTMLElement;
        expect(button.getAttribute("aria-pressed")).toBe("true");
        button.remove();
        await settle();

        expect(rawSource(assistant.message)?.textContent).toBe(raw);
        const fresh = rawToggle(assistant.message);
        expect(fresh?.getAttribute("aria-pressed")).toBe("true");
    });

    test("toggles each message independently", () => {
        const first = rawToggle(assistant.message) as HTMLElement;
        const other = rawToggle(second.message) as HTMLElement;
        // Leave the first message in rendered mode
        if (first.getAttribute("aria-pressed") === "true") {
            clickOn(first);
        }
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

        clickOn(rawToggle(withThinking.message) as HTMLElement);
        expect(rawSource(withThinking.message)?.textContent).toBe("最终答案内容");
        // The reasoning column stays visible and untouched
        expect(thinkingEl?.isConnected).toBeTrue();
        expect(thinkingEl?.textContent).toBe("已经思考过了");
        // Only the reply column is hidden
        expect(markdownColumn(withThinking.message).getAttribute("data-md-raw-mode")).toBe("1");
        clickOn(rawToggle(withThinking.message) as HTMLElement);
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
