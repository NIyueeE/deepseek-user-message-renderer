import { describe, expect, test } from "bun:test";
import {
    appendAssistantMessage,
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

await loadUserscript();

function clickOn(el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("click", { bubbles: true }));
}

function rawToggle(message: HTMLElement): HTMLElement | null {
    return message.querySelector("[data-md-raw-toggle]");
}

function rawSource(message: HTMLElement): HTMLElement | null {
    return message.querySelector(".md-raw-source");
}

function markdownColumn(message: HTMLElement): HTMLElement {
    return message.querySelector(".ds-assistant-message-main-content") as HTMLElement;
}

describe("assistant raw/rendered toggle", () => {
    test("injects the toggle at load without altering the assistant message", () => {
        const button = rawToggle(assistant.message);
        expect(button).not.toBeNull();
        // Injected directly after the copy button, in the same row
        expect(button?.parentElement).toBe(assistant.copyButton.parentElement);
        expect(button?.previousElementSibling).toBe(assistant.copyButton);
        // Default state is rendered
        expect(rawSource(assistant.message)).toBeNull();
        expect(markdownColumn(assistant.message).getAttribute("data-md-raw-mode")).toBeNull();
        expect(button?.getAttribute("aria-pressed")).toBe("false");
    });

    test("styles the toggle like the neighbouring copy button", () => {
        const button = rawToggle(assistant.message);
        for (const cls of ["ds-button", "ds-button--iconLabelTertiary", "ds-button--icon", "ds-button--xs"]) {
            expect(button?.classList.contains(cls), cls).toBeTrue();
        }
        // The copy button's structure is mirrored
        expect(button?.querySelector(".ds-button__icon")).not.toBeNull();
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
        expect(rawSource(assistant.message)?.textContent).toBe(raw);
        expect(rawSource(assistant.message)?.tagName).toBe("PRE");
        expect(button.getAttribute("aria-pressed")).toBe("true");
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
        expect(assistant.message.querySelectorAll("[data-md-raw-toggle]").length).toBe(1);
        expect(assistant.message.querySelectorAll(".md-raw-source").length).toBe(1);
        expect(rawSource(assistant.message)?.previousElementSibling).toBe(markdownColumn(assistant.message));
        expect(button.isConnected).toBeTrue();
    });

    test("re-injects the toggle when the host re-renders the action row", async () => {
        const button = rawToggle(assistant.message) as HTMLElement;
        // Simulate the host replacing the row's children (React commit)
        button.remove();
        await settle();

        expect(assistant.message.querySelectorAll("[data-md-raw-toggle]").length).toBe(1);
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
        expect(userMessage.querySelector("[data-md-raw-toggle]")).toBeNull();
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
