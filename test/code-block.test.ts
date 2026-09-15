import { describe, expect, test } from "bun:test";
import { appendAssistantMessage, appendWrappedUserMessage, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

/**
 * Degradation: a page where highlight.js never loaded (the CDN `@require`
 * failed, or a future build renamed it).
 *
 * The code-block FRAME is structural, so it must still be built and the source
 * must still be verbatim, readable text — only the token colours are lost.
 *
 * The theme tests here deliberately use the DOCUMENT-ELEMENT marker, which is the
 * one branch of `isDarkTheme()` the live build does not use (it marks the body —
 * see `real-dom-dark.test.ts`); `render.test.ts` covers the body class. Keeping
 * this branch tested is what lets the check stay tolerant of other builds.
 */
const env = setupTampermonkeyEnv({ highlight: false });

const unhighlightable = [
    // A language hljs does not know
    {
        message: appendWrappedUserMessage(env.document, "```text\nplain <b>not html</b>\n```"),
        source: "plain <b>not html</b>\n",
    },
    // No language at all
    { message: appendWrappedUserMessage(env.document, "```\nno language\n```"), source: "no language\n" },
];
const assistant = appendAssistantMessage(env.document, "# 标题\n\n正文 **加粗**", {
    rendered: "<h1>标题</h1><p>正文 <strong>加粗</strong></p>",
});

await loadUserscript();

function clickOn(el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("click", { bubbles: true }));
}

function rawToggle(): HTMLElement {
    return (assistant.message.parentElement as HTMLElement).querySelector("[data-md-raw-toggle]") as HTMLElement;
}

function rawContainer(): HTMLElement | null {
    return (assistant.message.parentElement as HTMLElement).querySelector(".md-raw-source");
}

describe("code blocks without highlight.js", () => {
    test("still builds the native frame, with the source verbatim and never as HTML", () => {
        for (const { message, source } of unhighlightable) {
            const block = message.content.querySelector(".md-code-block");
            expect(block).not.toBeNull();
            // The banner advertises the language even though it is not highlighted
            // (a language-less fence is labelled "text", like DeepSeek does)
            expect(block?.querySelector(".d813de27")?.textContent).toBe("text");
            const pre = block?.querySelector("pre");
            expect(pre?.textContent).toBe(source);
            expect(pre?.querySelector("*")).toBeNull();
        }
    });
});

describe("raw view without highlight.js", () => {
    test("still gets the native code-block frame, just without token colours", () => {
        clickOn(rawToggle());

        const container = rawContainer();
        expect(container?.querySelector(".md-code-block")).not.toBeNull();
        expect(container?.querySelector(".d813de27")?.textContent).toBe("markdown");
        expect(container?.classList.contains("md-raw-source-plain")).toBeFalse();
        expect(container?.querySelector("pre")?.textContent).toBe(assistant.raw);
        // Even then the source is never treated as live HTML
        expect(container?.querySelector("pre")?.querySelector("*")).toBeNull();
        // The view sits where the toggle expects it, so a scan keeps it as-is
        expect(container?.previousElementSibling).toBe(assistant.markdown);

        clickOn(rawToggle());
        expect(rawContainer()).toBeNull();
    });

    test("the document-element dark marker still picks the variant and rebuilds an open view", async () => {
        clickOn(rawToggle());
        expect(rawContainer()?.querySelector(".md-code-block-light")).not.toBeNull();

        env.document.documentElement.setAttribute("data-ds-dark-theme", "");
        await settle();
        // The variant is baked in at build time, so the observer must rebuild the
        // view rather than leave a light frame on a dark page
        expect(rawContainer()?.querySelector(".md-code-block-dark")).not.toBeNull();
        expect((assistant.message.parentElement as HTMLElement).querySelectorAll(".md-raw-source").length).toBe(1);

        env.document.documentElement.removeAttribute("data-ds-dark-theme");
        await settle();
        expect(rawContainer()?.querySelector(".md-code-block-light")).not.toBeNull();
        clickOn(rawToggle());
    });
});
