import { describe, expect, test } from "bun:test";
import { appendAssistantMessage, appendWrappedUserMessage, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

// A page where highlight.js never loaded (the CDN @require failed, or the
// library was renamed by a future build). The code-block STRUCTURE must still be
// built, and the raw view must still be readable and unmistakably monospace.
const env = setupTampermonkeyEnv({ highlight: false });

const unknownLang = appendWrappedUserMessage(env.document, "```text\nplain <b>not html</b>\n```");
const noLang = appendWrappedUserMessage(env.document, "```\nno language\n```");
const assistant = appendAssistantMessage(env.document, "# 标题\n\n正文 **加粗**", {
    rendered: "<h1>标题</h1><p>正文 <strong>加粗</strong></p>",
});

await loadUserscript();

function clickOn(el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("click", { bubbles: true }));
}

describe("code blocks without highlight.js", () => {
    test("still builds the native md-code-block frame for a known-plain language", () => {
        const block = unknownLang.content.querySelector(".md-code-block");
        expect(block).not.toBeNull();
        // The banner advertises the language even though it is not highlighted
        expect(block?.querySelector(".d813de27")?.textContent).toBe("text");
        // The source is preserved verbatim, and never interpreted as HTML
        const pre = block?.querySelector("pre");
        expect(pre?.textContent).toBe("plain <b>not html</b>\n");
        expect(pre?.querySelector("b")).toBeNull();
    });

    test("still builds the native md-code-block frame for a fenced block with no language", () => {
        const block = noLang.content.querySelector(".md-code-block");
        expect(block).not.toBeNull();
        expect(block?.querySelector(".d813de27")?.textContent).toBe("text");
        expect(block?.querySelector("pre")?.textContent).toBe("no language\n");
    });

    test("the theme variant comes from the page's own dark-mode marker", async () => {
        // Dark mode is a document-element attribute (the live build) rather than
        // a body class, and it is what picks md-code-block-dark
        env.document.documentElement.setAttribute("data-ds-dark-theme", "");
        await settle();
        expect(unknownLang.content.querySelector(".md-code-block-dark")).not.toBeNull();

        env.document.documentElement.removeAttribute("data-ds-dark-theme");
        await settle();
        expect(unknownLang.content.querySelector(".md-code-block-light")).not.toBeNull();
    });
});

describe("raw view without highlight.js", () => {
    test("still gets the native code-block frame, just without token colours", () => {
        const button = (assistant.message.parentElement as HTMLElement).querySelector(
            "[data-md-raw-toggle]",
        ) as HTMLElement;
        clickOn(button);

        const container = (assistant.message.parentElement as HTMLElement).querySelector(".md-raw-source");
        // The frame is structural, so it survives a missing highlight.js: only
        // the token colours are lost, and the source stays verbatim text
        expect(container?.querySelector(".md-code-block")).not.toBeNull();
        expect(container?.querySelector(".d813de27")?.textContent).toBe("markdown");
        expect(container?.classList.contains("md-raw-source-plain")).toBeFalse();
        expect(container?.querySelector("pre")?.textContent).toBe(assistant.raw);
        // Even then the source is never treated as live HTML
        expect(container?.querySelector("pre")?.querySelector("*")).toBeNull();
        // The view sits where the toggle expects it, so a scan keeps it as-is
        expect(container?.previousElementSibling).toBe(assistant.markdown);

        clickOn(button);
        expect((assistant.message.parentElement as HTMLElement).querySelector(".md-raw-source")).toBeNull();
    });

    test("a theme switch rebuilds the baked-in light/dark variant", async () => {
        const button = (assistant.message.parentElement as HTMLElement).querySelector(
            "[data-md-raw-toggle]",
        ) as HTMLElement;
        clickOn(button);
        const item = assistant.message.parentElement as HTMLElement;
        expect(item.querySelector(".md-code-block-light")).not.toBeNull();

        env.document.documentElement.setAttribute("data-ds-dark-theme", "");
        await settle();
        // The md-code-block variant is baked at build time, so the observer must
        // rebuild the view rather than leave a light frame on a dark page
        expect(item.querySelector(".md-raw-source .md-code-block-dark")).not.toBeNull();
        expect(item.querySelectorAll(".md-raw-source").length).toBe(1);

        env.document.documentElement.removeAttribute("data-ds-dark-theme");
        await settle();
        expect(item.querySelector(".md-raw-source .md-code-block-light")).not.toBeNull();
        clickOn(button);
    });
});
