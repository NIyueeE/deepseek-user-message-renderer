import { describe, expect, test } from "bun:test";
import { appendMessageWithActions, appendUserMessage, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

const env = setupTampermonkeyEnv();

// Normal messages with edit/copy buttons
const edit = appendMessageWithActions(env.document, "**original text**");
const keyboard = appendMessageWithActions(env.document, "**keyboard text**");
const pointer = appendMessageWithActions(env.document, "**pointer text**");
const copy = appendMessageWithActions(env.document, "**copy button message**");
const placeholder = appendUserMessage(env.document, "**placeholder text**");

// Message already in edit state: it contains an input control
const editingGroup = env.document.createElement("div");
editingGroup.className = "_9663006";
const editingMessage = env.document.createElement("div");
editingMessage.className = "ds-message";
editingMessage.innerHTML = "<textarea>editing in progress</textarea>";
editingGroup.appendChild(editingMessage);
const editingSibling = env.document.createElement("div");
editingSibling.className = "ds-message";
editingSibling.appendChild(env.document.createTextNode("**sibling of editor**"));
editingGroup.appendChild(editingSibling);
env.document.body.appendChild(editingGroup);

await loadUserscript();

function clickOn(el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("click", { bubbles: true }));
}

describe("edit button restore", () => {
    test("renders the message after load", () => {
        expect(edit.message.querySelector(".ds-markdown")).not.toBeNull();
        expect(edit.message.querySelector("strong")?.textContent).toBe("original text");
    });

    test("pointerdown does not restore the message (avoids suppressing the click)", async () => {
        pointer.editButton.dispatchEvent(new env.window.Event("pointerdown", { bubbles: true }));
        await settle();

        expect(pointer.message.querySelector(".ds-markdown")).not.toBeNull();
        expect(pointer.message.classList.contains("ds-md-rendered")).toBeTrue();
    });

    test("restores the original content on edit click without immediate re-render", async () => {
        clickOn(edit.editButton);

        expect(edit.message.querySelector(".ds-markdown")).toBeNull();
        expect(edit.message.classList.contains("ds-md-rendered")).toBeFalse();
        expect(edit.content.isConnected).toBeTrue();
        expect(edit.message.textContent).toBe("**original text**");
        expect(edit.message.dataset.mdRendered).toBe("**original text**");
        expect(edit.message.dataset.mdRestoredAt).toBeTruthy();
        expect(edit.message.style.background).toBe("");

        // Let MutationObserver callbacks run, then confirm there is no re-render
        await settle();
        expect(edit.message.querySelector(".ds-markdown")).toBeNull();
    });

    test("waits out the cooldown, then re-renders once the edited text changes", async () => {
        // During the cooldown the observer must not re-render the restored message
        edit.content.textContent = "**new text**";
        await settle();
        expect(edit.message.querySelector(".ds-markdown")).toBeNull();

        // After the cooldown expires (simulated here), a text change re-renders
        delete edit.message.dataset.mdRestoredAt;
        edit.content.textContent = "**new text v2**";
        await settle();

        expect(edit.message.querySelector(".ds-markdown")).not.toBeNull();
        expect(edit.message.querySelector("strong")?.textContent).toBe("new text v2");
        expect(edit.content.isConnected).toBeTrue();
    });

    test("re-renders the message after clicking cancel in edit mode", async () => {
        // `edit` is currently rendered with "**new text v2**"; enter edit mode
        clickOn(edit.editButton);
        expect(edit.message.querySelector(".ds-markdown")).toBeNull();

        clickOn(edit.cancelButton);
        await settle(80);

        expect(edit.message.querySelector(".ds-markdown")).not.toBeNull();
        expect(edit.message.classList.contains("ds-md-rendered")).toBeTrue();
        expect(edit.message.querySelector("strong")?.textContent).toBe("new text v2");
    });

    test("keyboard activation (Enter) also restores the message", () => {
        keyboard.editButton.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        expect(keyboard.message.querySelector(".ds-markdown")).toBeNull();
        expect(keyboard.message.textContent).toBe("**keyboard text**");
    });

    test("does not restore when clicking a non-edit (copy) button", async () => {
        clickOn(copy.copyButton);
        await settle();

        expect(copy.message.querySelector(".ds-markdown")).not.toBeNull();
    });

    test("skips rendering when the message box already contains an input control", () => {
        expect(editingMessage.querySelector(".ds-markdown")).toBeNull();
        expect(editingMessage.textContent).toBe("editing in progress");
    });

    test("skips messages in a group that already hosts an editor", () => {
        expect(editingSibling.querySelector(".ds-markdown")).toBeNull();
        expect(editingSibling.classList.contains("ds-md-rendered")).toBeFalse();
        expect(editingSibling.textContent).toBe("**sibling of editor**");
    });

    test("cleans up the empty edit placeholder left by the editor", async () => {
        // The placeholder was rendered at load
        expect(placeholder.querySelector("strong")?.textContent).toBe("placeholder text");

        // Simulate DeepSeek moving the content into the editor and emptying the node
        placeholder.textContent = "";
        await settle();

        expect(placeholder.getAttribute("style")).toBeNull();
        expect(placeholder.dataset.mdRendered).toBeUndefined();
        expect(placeholder.classList.contains("ds-md-rendered")).toBeFalse();

        // When the edited text comes back, it renders again
        placeholder.textContent = "**restored text**";
        await settle();
        expect(placeholder.querySelector(".ds-markdown")).not.toBeNull();
        expect(placeholder.querySelector("strong")?.textContent).toBe("restored text");
    });

    test("mirrors DeepSeek's history-item highlight onto the rendered bubble", async () => {
        // `edit` is currently rendered (ds-md-rendered). DeepSeek paints the
        // native (hidden) bubble inline when a history item is clicked...
        edit.content.style.background = "var(--dsw-specific-bubble-highlight)";
        await settle();
        expect(edit.message.style.background).toBe("var(--dsw-specific-bubble-highlight)");
        // No leftover transition: it must not break the inline var() background
        expect(edit.message.style.transition).toBe("");

        // ...and clears it after ~1.5s; the mirror must follow
        edit.content.style.background = "";
        await settle();
        expect(edit.message.style.background).toBe("");
        // The native UI fades the bubble back over .3s, then removes the transition
        expect(edit.message.style.transition).toBe("background .3s");
        await settle(400);
        expect(edit.message.style.transition).toBe("");

        // The rendered bubble itself is not mirrored back into itself
        edit.message.style.background = "var(--dsw-specific-bubble-highlight)";
        await settle();
        expect(edit.content.style.background).toBe("");
    });
});
