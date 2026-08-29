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
// The host app's own content holder: React recorded nodes that must survive
const hostInner = collapsible.querySelector("div");
const hostSpan = collapsible.querySelector("span");

// Collapsible messages with edit/copy/cancel buttons for the restore flow
const editFixture = appendMessageWithActions(env.document, "**edit me**", { collapsible: true });
const cancelFixture = appendMessageWithActions(env.document, "**cancel me**", { collapsible: true });
// Flat message without the collapsible wrapper must keep rendering as before
const flat = appendMessageWithActions(env.document, "**flat message**");

await loadUserscript();

function clickOn(el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("click", { bubbles: true }));
}

function markdownContainer(el: HTMLElement): HTMLElement | null | undefined {
    return el.querySelector(".md-user-markdown");
}

describe("collapsible user messages (long-message collapse)", () => {
    test("renders markdown into a sibling container, keeping the host's own children", () => {
        const mdEl = markdownContainer(collapsible);
        expect(mdEl).not.toBeNull();
        expect(mdEl?.classList.contains("ds-markdown")).toBeTrue();
        expect(mdEl?.querySelector("h1")?.textContent).toBe("Title");
        expect(mdEl?.querySelector("strong")?.textContent).toBe("bold");
        expect(collapsible.dataset.mdCollapsible).toBe("1");
        // The host's recorded nodes stay in the DOM with their original text —
        // this is what keeps React's commits from throwing on toggle
        expect(hostSpan?.isConnected).toBeTrue();
        expect(hostInner?.isConnected).toBeTrue();
        expect(hostSpan?.textContent).toContain("Paragraph with **bold**");
    });

    test("keeps the collapsible wrapper and the toggle button intact", () => {
        expect(collapsible.isConnected).toBeTrue();
        expect(toggle.isConnected).toBeTrue();
        // The toggle stays a direct child of the message text element, never
        // swallowed by the rendered markdown
        expect(toggle.parentElement).toBe(long.content);
        expect(markdownContainer(collapsible)).not.toBeNull();
    });

    test("rebuilds code blocks inside the sibling container", () => {
        const mdEl = markdownContainer(collapsible);
        expect(mdEl?.querySelector(".md-code-block")).not.toBeNull();
        expect(mdEl?.querySelector(".md-code-block-banner")?.textContent).toBe("python");
    });

    test("marks the container as rendered and does not re-render on re-scan", async () => {
        expect(collapsible.dataset.mdRendered).toBeTruthy();
        expect(collapsible.dataset.mdRenderedText).toBeTruthy();
        await settle();
        expect(collapsible.querySelectorAll(".md-user-markdown").length).toBe(1);
    });

    test("host app may insert and remove its own children (collapse mask) without breaking the render", async () => {
        // Simulate what the host's collapse commit does: insert a fade mask
        // element next to the content. It must stay in the DOM (never removed
        // by us) and must not trigger a re-render.
        const mask = env.document.createElement("div");
        mask.className = "ds-collapsible-text-mask";
        collapsible.appendChild(mask);
        await settle();

        expect(mask.isConnected).toBeTrue();
        expect(collapsible.querySelectorAll(".md-user-markdown").length).toBe(1);
        expect(collapsible.dataset.mdRenderedText).toBeTruthy();
        mask.remove();
    });

    test("theme switch rebuilds the markdown inside the sibling container", async () => {
        env.document.body.classList.add("dark");
        await settle();

        const mdEl = markdownContainer(collapsible);
        expect(mdEl?.querySelector(".md-code-block-dark")).not.toBeNull();
        expect(collapsible.dataset.mdTheme).toBe("dark");
        expect(mdEl?.querySelectorAll(".md-user-markdown").length).toBe(0);
        expect(collapsible.querySelectorAll(".md-user-markdown").length).toBe(1);
        // Host nodes still alive after the rebuild
        expect(hostSpan?.isConnected).toBeTrue();
        env.document.body.classList.remove("dark");
        await settle();
    });

    test("edit click removes the sibling container and unhides the host's children", async () => {
        const fx = editFixture.collapsible;
        if (!fx) {
            throw new Error("fixture missing collapsible container");
        }
        clickOn(editFixture.editButton);

        expect(markdownContainer(fx)).toBeNull();
        expect(fx.dataset.mdCollapsible).toBeUndefined();
        expect(fx.dataset.mdRendered).toBeUndefined();
        expect(fx.dataset.mdRestoredAt).toBeTruthy();
        // Host nodes untouched — they are the visible message content again
        expect(fx.querySelector("span")?.textContent).toBe("**edit me**");
        expect(editFixture.toggle?.isConnected).toBeTrue();

        // The cooldown blocks the observer from re-rendering right away
        await settle();
        expect(markdownContainer(fx)).toBeNull();
    });

    test("cancel after edit re-renders the message once the host restores its text", async () => {
        // Simulate DeepSeek's cancel flow: the edit UI is dismissed and the
        // host's own commit puts the message text back
        const fx = cancelFixture.collapsible;
        if (!fx) {
            throw new Error("fixture missing collapsible container");
        }
        clickOn(cancelFixture.editButton);
        await settle();
        const span = fx.querySelector("span");
        if (!span) {
            throw new Error("fixture missing host span");
        }
        span.textContent = "**cancel me**";
        clickOn(cancelFixture.cancelButton);
        await settle(80);

        const mdEl = markdownContainer(fx);
        expect(mdEl?.querySelector("strong")?.textContent).toBe("cancel me");
        expect(fx.dataset.mdCollapsible).toBe("1");
        expect(cancelFixture.toggle?.isConnected).toBeTrue();
    });

    test("toggle click schedules a re-check and lifts the stale height when expanded", async () => {
        // Collapsed (fixture default: max-height 192px) — the re-check must not
        // touch the host's box
        clickOn(toggle);
        await settle(600);
        expect(collapsible.dataset.mdToggledAt).toBeUndefined();
        expect(collapsible.querySelectorAll(".md-user-markdown").length).toBe(1);
        expect(collapsible.style.maxHeight).toBe("192px");

        // Simulate the host's expand commit: it raises max-height (stale
        // measured height stays) — our re-check lifts it to fit the markdown
        collapsible.style.maxHeight = "432px";
        clickOn(toggle);
        await settle(600);
        expect(collapsible.style.height).toBe("auto");
        expect(collapsible.style.maxHeight).toBe("none");
    });

    test("a rebuild while the message is expanded also lifts the stale height", async () => {
        // Simulate the message being expanded (host raised max-height), then
        // force a rebuild via a theme change
        collapsible.style.maxHeight = "432px";
        env.document.body.classList.add("dark");
        await settle();

        expect(collapsible.style.height).toBe("auto");
        expect(collapsible.style.maxHeight).toBe("none");
        expect(collapsible.dataset.mdTheme).toBe("dark");
        env.document.body.classList.remove("dark");
        await settle();
        // The box stays lifted: we only ever lift, never re-clip — the host
        // re-applies its own collapsed styles on the next collapse
        expect(collapsible.style.maxHeight).toBe("none");
    });

    test("does not lift the height when the message is collapsed", async () => {
        collapsible.style.maxHeight = "192px";
        collapsible.style.height = "432px";
        clickOn(toggle);
        await settle(600);
        // maxHeight equals the collapsed value recorded at render time: no fix
        expect(collapsible.style.maxHeight).toBe("192px");
        expect(collapsible.style.height).toBe("432px");
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

        const mdEl = markdownContainer(padded.collapsible);
        expect(mdEl?.querySelector(".md-code-block-banner")?.textContent).toBe("bash");
        expect(mdEl?.querySelector("pre")?.classList.contains("language-bash")).toBeTrue();
    });
});
