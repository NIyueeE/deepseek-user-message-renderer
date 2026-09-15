import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clickOn, describeCaptureBattery, loadCapture } from "./capture";
import { appendUserMessage, settle } from "./env";

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
 *
 * Everything not specific to the dark theme (toggle injection, raw view, edit
 * icon, host nodes) is covered by the shared battery.
 */
const FIXTURE = join(import.meta.dir, "fixtures", "deepseek-chat-dark.html");
const capture = await loadCapture({ fixture: "deepseek-chat-dark", replyMarkdown: "# 标题\n\n正文 **加粗**" });
const { env } = capture;

describeCaptureBattery(capture, { toggles: 1 });

const body = env.document.body as HTMLElement;

// A user message carrying a fence, so there is a code block the SCRIPT built
// (the capture's own blocks are DeepSeek's)
appendUserMessage(env.document, "```javascript\nconst answer = 42;\n```");
await settle();

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

describe("the dark capture", () => {
    test("marks the theme on the body, not the document element", () => {
        // This is the fact that corrected the script. If DeepSeek moves it, this
        // fails and points at what to re-derive.
        expect(body.hasAttribute("data-ds-dark-theme")).toBeTrue();
        expect(body.classList.contains("dark")).toBeTrue();
        expect(env.document.documentElement.hasAttribute("data-ds-dark-theme")).toBeFalse();
    });

    test("carries the dark palette, not just dark class names", () => {
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

    test("DeepSeek's own blocks and the script's blocks are both dark", () => {
        const nativeVariants = [...env.document.querySelectorAll("._4f9bf79 .md-code-block")].map((b) => b.className);
        expect(nativeVariants.length).toBeGreaterThanOrEqual(2);
        for (const variant of nativeVariants) {
            expect(variant).toContain("md-code-block-dark");
        }
        expect(ourBlockVariant()).toBe("md-code-block md-code-block-dark");
    });

    test("the raw view follows the theme, rebuilt rather than left stale", async () => {
        // The raw view's variant is baked in at build time, so it cannot follow
        // the theme on its own — the observer has to rebuild it.
        const toggle = env.document.querySelector("[data-md-raw-toggle]") as HTMLElement;
        clickOn(env, toggle);
        await settle();
        expect(rawVariant()).toBe("md-code-block md-code-block-dark");

        await setTheme(false, false);
        expect(rawVariant()).toBe("md-code-block md-code-block-light");

        await setTheme(true, true);
        expect(rawVariant()).toBe("md-code-block md-code-block-dark");
        expect(env.document.querySelectorAll(".md-raw-source").length).toBe(1);

        clickOn(env, toggle);
        await settle();
        expect(rawVariant()).toBeNull();
    });

    test("the detection matrix: attribute, class, neither", async () => {
        // Each marker on its own must be enough (the stylesheet keys off the
        // attribute; older builds used the class), and neither means light.
        const cases: Array<{ attribute: boolean; darkClass: boolean; want: string }> = [
            { attribute: true, darkClass: false, want: "md-code-block md-code-block-dark" },
            { attribute: false, darkClass: true, want: "md-code-block md-code-block-dark" },
            { attribute: true, darkClass: true, want: "md-code-block md-code-block-dark" },
            { attribute: false, darkClass: false, want: "md-code-block md-code-block-light" },
        ];
        for (const { attribute, darkClass, want } of cases) {
            await setTheme(attribute, darkClass);
            expect(ourBlockVariant(), `attribute=${attribute} darkClass=${darkClass}`).toBe(want);
        }
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
});
