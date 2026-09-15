import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendUserMessage, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

/**
 * The DARK build, against a real capture.
 *
 * `deepseek-chat-dark.html` is the same conversation as `deepseek-chat.html`,
 * saved in the dark theme. It is what makes the dark variant verifiable — and it
 * immediately corrected an assumption in the script:
 *
 *   the live build puts its dark marker on the BODY, not the document element:
 *       <body class="zh_CN dark" data-ds-dark-theme="dark">
 *   and its stylesheet keys off `body[data-ds-dark-theme] …`.
 *
 * The script had a comment claiming the attribute was on the document element,
 * and an observer watching `document.documentElement` for it. Detection happened
 * to work (a broad `querySelector` found the body attribute), and the observer
 * happened to work (the build toggles the `dark` class too) — so nothing failed.
 * These tests pin the real mechanism, and the attribute-only and class-only cases
 * separately, so neither accident has to keep holding.
 */
const FIXTURE = join(import.meta.dir, "fixtures", "deepseek-chat-dark.html");
const REPLY_MARKDOWN = "# 标题\n\n正文 **加粗**";

const env = setupTampermonkeyEnv();
env.window.document.write(readFileSync(FIXTURE, "utf-8"));

for (const md of env.document.querySelectorAll("._4f9bf79 .ds-assistant-message-main-content")) {
    const component = { memoizedProps: { markdown: REPLY_MARKDOWN }, return: null };
    const domFiber = { memoizedProps: { className: md.className }, return: component };
    Object.defineProperty(md, "__reactFiber$fixture", {
        value: domFiber,
        enumerable: true,
        configurable: true,
    });
}

await loadUserscript();
await settle();

// A user message carrying a fence, so we have a code block the SCRIPT built
// (the capture's own blocks are DeepSeek's)
appendUserMessage(env.document, "```javascript\nconst answer = 42;\n```");
await settle();

const body = env.document.body as HTMLElement;

/** The variant class of the block the script built for that user message. */
function ourBlockVariant(): string | null {
    const group = [...env.document.querySelectorAll("._9663006")].at(-1);
    return group?.querySelector(".md-code-block")?.className ?? null;
}

/** The variant class inside the raw view, if it is open. */
function rawVariant(): string | null {
    return env.document.querySelector(".md-raw-source .md-code-block")?.className ?? null;
}

async function setTheme(attribute: boolean, darkClass: boolean): Promise<void> {
    if (attribute) {
        body.setAttribute("data-ds-dark-theme", "dark");
    } else {
        body.removeAttribute("data-ds-dark-theme");
    }
    if (darkClass) {
        body.classList.add("dark");
    } else {
        body.classList.remove("dark");
    }
    await settle();
}

describe("real DeepSeek DOM: dark capture", () => {
    test("the dark marker is on the body, not the document element", () => {
        // This is the fact that corrected the script. If DeepSeek moves it, this
        // fails and points at what to re-derive.
        expect(body.hasAttribute("data-ds-dark-theme")).toBeTrue();
        expect(body.classList.contains("dark")).toBeTrue();
        expect(env.document.documentElement.hasAttribute("data-ds-dark-theme")).toBeFalse();
    });

    test("the capture carries the dark palette, not just dark class names", () => {
        // Read the file (happy-dom does not compute the cascade): a capture with
        // md-code-block-dark but no dark token rules would look verifiable and
        // would not be.
        const html = readFileSync(FIXTURE, "utf-8");
        for (const rule of [
            ".md-code-block.md-code-block-dark .token.keyword{color:#e9ae7e}",
            ".md-code-block.md-code-block-dark .token.string{color:#91d076}",
            ".md-code-block.md-code-block-dark .token.function{color:#c699e3}",
        ]) {
            expect(html).toContain(rule);
        }
        // ...and the dark theme loads different surface tokens
        expect(html).toContain("body[data-ds-dark-theme]");
    });

    test("DeepSeek's own blocks in this capture are all dark", () => {
        const nativeVariants = [...env.document.querySelectorAll("._4f9bf79 .md-code-block")].map((b) => b.className);
        expect(nativeVariants.length).toBeGreaterThanOrEqual(2);
        for (const variant of nativeVariants) {
            expect(variant).toContain("md-code-block-dark");
        }
    });

    test("the script builds dark blocks on this page", () => {
        expect(ourBlockVariant()).toBe("md-code-block md-code-block-dark");
    });

    test("the raw view is dark too", async () => {
        const toggle = env.document.querySelector("[data-md-raw-toggle]") as HTMLElement;
        expect(toggle).not.toBeNull();
        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));
        await settle();
        expect(rawVariant()).toBe("md-code-block md-code-block-dark");
        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));
        await settle();
        expect(rawVariant()).toBeNull();
    });

    test("dark is detected from the body ATTRIBUTE alone", async () => {
        // The attribute is the real marker and the stylesheet keys off it. If the
        // script only looked at the class, this would stay light.
        await setTheme(true, false);
        expect(ourBlockVariant()).toBe("md-code-block md-code-block-dark");
        await setTheme(true, true);
    });

    test("a theme switch that only changes the body ATTRIBUTE is observed", async () => {
        // The regression this pins: the observer used to watch only `class` on the
        // body (plus `data-ds-dark-theme` on the document element, where it never
        // appears). The live build happens to toggle BOTH, so the scan fired
        // anyway — by accident. If a build ever sets only the attribute, every
        // code block and an open raw view would keep a stale variant. Here the
        // class is left untouched, so only an attribute-aware observer can react.
        await setTheme(false, false);
        expect(ourBlockVariant()).toBe("md-code-block md-code-block-light");
        const classBefore = body.className;

        body.setAttribute("data-ds-dark-theme", "dark"); // attribute ONLY
        await settle();

        expect(body.className).toBe(classBefore); // nothing else changed
        expect(ourBlockVariant()).toBe("md-code-block md-code-block-dark");
        await setTheme(true, true);
    });

    test("dark is detected from the dark CLASS alone", async () => {
        // The older mechanism, kept working: some builds signal only the class.
        await setTheme(false, true);
        expect(ourBlockVariant()).toBe("md-code-block md-code-block-dark");
        await setTheme(true, true);
    });

    test("removing both markers returns the page to light", async () => {
        await setTheme(false, false);
        expect(ourBlockVariant()).toBe("md-code-block md-code-block-light");
        await setTheme(true, true);
        expect(ourBlockVariant()).toBe("md-code-block md-code-block-dark");
    });

    test("a theme switch rebuilds an open raw view", async () => {
        // The raw view's variant is baked in at build time, so it cannot follow
        // the theme on its own.
        const toggle = env.document.querySelector("[data-md-raw-toggle]") as HTMLElement;
        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));
        await settle();
        expect(rawVariant()).toBe("md-code-block md-code-block-dark");

        await setTheme(false, false);
        expect(rawVariant()).toBe("md-code-block md-code-block-light");

        await setTheme(true, true);
        expect(rawVariant()).toBe("md-code-block md-code-block-dark");
        expect(env.document.querySelectorAll(".md-raw-source").length).toBe(1);

        toggle.dispatchEvent(new env.window.Event("click", { bubbles: true }));
        await settle();
    });
});
