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
editingMessage.innerHTML = '<div class="fbb737a4">editing in progress</div><textarea>editing in progress</textarea>';
editingGroup.appendChild(editingMessage);
const editingSibling = env.document.createElement("div");
editingSibling.className = "ds-message";
editingSibling.innerHTML = '<div class="fbb737a4">**sibling of editor**</div>';
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
        expect(pointer.content.classList.contains("ds-markdown")).toBeTrue();
    });

    test("restores the original content on edit click without immediate re-render", async () => {
        clickOn(edit.editButton);

        expect(edit.message.querySelector(".ds-markdown")).toBeNull();
        expect(edit.content.classList.contains("ds-markdown")).toBeFalse();
        expect(edit.content.isConnected).toBeTrue();
        expect(edit.message.textContent).toBe("**original text**");
        expect(edit.content.dataset.mdRendered).toBe("**original text**");
        expect(edit.content.dataset.mdRestoredAt).toBeTruthy();

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
        delete edit.content.dataset.mdRestoredAt;
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
        expect(edit.content.classList.contains("ds-markdown")).toBeTrue();
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
        expect(editingMessage.querySelector(".fbb737a4")?.classList.contains("ds-markdown")).toBeFalse();
        expect(editingMessage.textContent).toContain("editing in progress");
    });

    test("skips messages in a group that already hosts an editor", () => {
        expect(editingSibling.querySelector(".ds-markdown")).toBeNull();
        expect(editingSibling.querySelector(".fbb737a4")?.classList.contains("ds-markdown")).toBeFalse();
        expect(editingSibling.textContent).toBe("**sibling of editor**");
    });

    test("cleans up the empty edit placeholder left by the editor", async () => {
        const placeholderText = placeholder.querySelector(".fbb737a4");
        if (!placeholderText) {
            throw new Error("fixture missing text element");
        }
        // The placeholder was rendered at load
        expect(placeholderText.querySelector("strong")?.textContent).toBe("placeholder text");

        // Simulate DeepSeek moving the content into the editor and emptying the node
        placeholderText.textContent = "";
        await settle();

        expect(placeholderText.classList.contains("ds-markdown")).toBeFalse();
        expect(placeholderText.dataset.mdRendered).toBeUndefined();

        // When the edited text comes back, it renders again
        placeholderText.textContent = "**restored text**";
        await settle();
        expect(placeholderText.classList.contains("ds-markdown")).toBeTrue();
        expect(placeholderText.querySelector("strong")?.textContent).toBe("restored text");
    });
});
