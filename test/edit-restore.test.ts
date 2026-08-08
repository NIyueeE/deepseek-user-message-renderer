import { describe, expect, test } from "bun:test";
import { appendMessageWithActions, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

const env = setupTampermonkeyEnv();

// Normal messages with edit/copy buttons
const edit = appendMessageWithActions(env.document, "**original text**");
const copy = appendMessageWithActions(env.document, "**copy button message**");

// Message already in edit state: it contains an input control
const editingGroup = env.document.createElement("div");
editingGroup.className = "_9663006";
const editingMessage = env.document.createElement("div");
editingMessage.className = "ds-message";
editingMessage.innerHTML = "<textarea>editing in progress</textarea>";
editingGroup.appendChild(editingMessage);
env.document.body.appendChild(editingGroup);

await loadUserscript();

function clickOn(el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("pointerdown", { bubbles: true }));
}

describe("edit button restore", () => {
    test("renders the message after load", () => {
        expect(edit.message.querySelector(".ds-markdown")).not.toBeNull();
        expect(edit.message.querySelector("strong")?.textContent).toBe("original text");
    });

    test("restores the original content on edit click without immediate re-render", async () => {
        clickOn(edit.editButton);

        expect(edit.message.querySelector(".ds-markdown")).toBeNull();
        expect(edit.message.classList.contains("ds-md-rendered")).toBeFalse();
        expect(edit.content.isConnected).toBeTrue();
        expect(edit.message.textContent).toBe("**original text**");
        expect(edit.message.dataset.mdRendered).toBe("**original text**");
        expect(edit.message.style.background).toBe("");

        // Let MutationObserver callbacks run, then confirm there is no re-render
        await settle();
        expect(edit.message.querySelector(".ds-markdown")).toBeNull();
    });

    test("re-renders automatically after the edited text changes", async () => {
        edit.content.textContent = "**new text**";
        await settle();

        expect(edit.message.querySelector(".ds-markdown")).not.toBeNull();
        expect(edit.message.querySelector("strong")?.textContent).toBe("new text");
        expect(edit.content.isConnected).toBeTrue();
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
});
