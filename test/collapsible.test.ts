import { describe, expect, test } from "bun:test";
import {
    appendCollapsibleUserMessage,
    appendMessageWithActions,
    loadUserscript,
    settle,
    setupTampermonkeyEnv,
} from "./env";

const env = setupTampermonkeyEnv();

// Long message in DeepSeek's newer collapsible structure
const long = appendCollapsibleUserMessage(
    env.document,
    ["# Title", "", "Paragraph with **bold**", "", "```python", "print(1)", "```", ""].join("\n"),
);
const collapsible = long.collapsible;
const toggle = long.toggle;

// Collapsible messages with edit/copy/cancel buttons for the restore flow
const editFixture = appendMessageWithActions(env.document, "**edit me**", { collapsible: true });
const cancelFixture = appendMessageWithActions(env.document, "**cancel me**", { collapsible: true });
// Flat message without the collapsible wrapper must keep rendering as before
const flat = appendMessageWithActions(env.document, "**flat message**");

await loadUserscript();

function clickOn(el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("click", { bubbles: true }));
}

describe("collapsible user messages (long-message collapse)", () => {
    test("renders markdown inside the collapsible container", () => {
        expect(collapsible.querySelector("h1")?.textContent).toBe("Title");
        expect(collapsible.querySelector("strong")?.textContent).toBe("bold");
        expect(collapsible.classList.contains("ds-markdown")).toBeTrue();
    });

    test("keeps the collapsible wrapper and the toggle button intact", () => {
        expect(collapsible.isConnected).toBeTrue();
        expect(toggle.isConnected).toBeTrue();
        // The toggle stays a direct child of the message text element, never
        // swallowed by the rendered markdown
        expect(toggle.parentElement).toBe(long.content);
        expect(collapsible.querySelector("h1")).not.toBeNull();
    });

    test("rebuilds code blocks inside the collapsible container", () => {
        expect(collapsible.querySelector(".md-code-block")).not.toBeNull();
        expect(collapsible.querySelector(".md-code-block-banner")?.textContent).toBe("python");
    });

    test("marks the collapsible container as rendered and does not re-render on re-scan", async () => {
        expect(collapsible.dataset.mdRendered).toBeTruthy();
        expect(collapsible.dataset.mdRenderedText).toBeTruthy();
        await settle();
        expect(collapsible.querySelectorAll("h1").length).toBe(1);
    });

    test("edit click restores the raw text inside the collapsible container", async () => {
        clickOn(editFixture.editButton);

        expect(editFixture.collapsible?.textContent).toBe("**edit me**");
        expect(editFixture.collapsible?.classList.contains("ds-markdown")).toBeFalse();
        expect(editFixture.toggle?.isConnected).toBeTrue();
        expect(editFixture.collapsible?.dataset.mdRestoredAt).toBeTruthy();

        // The cooldown blocks the observer from re-rendering right away
        await settle();
        expect(editFixture.collapsible?.querySelector("strong")).toBeNull();
    });

    test("cancel re-renders the message inside the collapsible container", async () => {
        clickOn(cancelFixture.editButton);
        await settle();

        clickOn(cancelFixture.cancelButton);
        await settle(80);

        expect(cancelFixture.collapsible?.querySelector("strong")?.textContent).toBe("cancel me");
        expect(cancelFixture.collapsible?.classList.contains("ds-markdown")).toBeTrue();
        expect(cancelFixture.toggle?.isConnected).toBeTrue();
    });

    test("messages without the collapsible wrapper still render into the text element", () => {
        expect(flat.content.classList.contains("ds-markdown")).toBeTrue();
        expect(flat.content.querySelector("strong")?.textContent).toBe("flat message");
        expect(flat.content.dataset.mdRendered).toBeTruthy();
    });

    test("tolerates whitespace text nodes around the message content", async () => {
        // Wrapper elements may carry indentation-only text nodes; leading
        // spaces beyond three would otherwise break fence detection
        const padded = appendCollapsibleUserMessage(env.document, "~~~bash\nls -la\n~~~\n");
        padded.collapsible.insertBefore(env.document.createTextNode("        "), padded.collapsible.firstChild);
        padded.collapsible.appendChild(env.document.createTextNode("    "));
        await settle();

        expect(padded.collapsible.querySelector(".md-code-block-banner")?.textContent).toBe("bash");
        expect(padded.collapsible.querySelector("pre")?.classList.contains("language-bash")).toBeTrue();
        expect(padded.collapsible.querySelectorAll("p").length).toBe(0);
    });
});
