import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UserscriptEnv } from "./env";
import { loadUserscript, settle, setupTampermonkeyEnv } from "./env";

/**
 * Loader and shared assertion battery for the real captures in `test/fixtures/`.
 *
 * Three captures (light, dark, and the older blockquote-regression one) all need
 * the same setup and the same basic "the script still works on a real page"
 * assertions. Having each file re-implement them meant a fix to one copy could
 * silently miss the others, so they live here once.
 *
 * What stays per-file is what actually differs: capture-specific shape counts,
 * the code-block structural diff, the blockquote regression, and the dark-theme
 * detection cases.
 *
 * Each capture keeps the DOM but not React's internals, so the assistant reply's
 * source is supplied by a synthetic fibre shaped like the live one.
 */

export interface Capture {
    env: UserscriptEnv;
    /** The Markdown handed to every assistant reply's fibre. */
    replyMarkdown: string;
}

export interface LoadCaptureOptions {
    /** Fixture file stem under `test/fixtures/`. */
    fixture: string;
    /** Markdown to expose as each assistant reply's source. */
    replyMarkdown: string;
}

/** Parse a capture, install the synthetic fibres, then run the userscript. */
export async function loadCapture(options: LoadCaptureOptions): Promise<Capture> {
    const env = setupTampermonkeyEnv();
    env.window.document.write(readFileSync(join(import.meta.dir, "fixtures", `${options.fixture}.html`), "utf-8"));

    // Install the fibres BEFORE the userscript runs, so its very first scan sees
    // them (matching the live page, where React is already mounted)
    for (const md of env.document.querySelectorAll("._4f9bf79 .ds-assistant-message-main-content")) {
        const component = { memoizedProps: { markdown: options.replyMarkdown }, return: null };
        const domFiber = { memoizedProps: { className: md.className }, return: component };
        Object.defineProperty(md, "__reactFiber$fixture", {
            value: domFiber,
            enumerable: true,
            configurable: true,
        });
    }

    await loadUserscript();
    await settle();
    return { env, replyMarkdown: options.replyMarkdown };
}

/** Click something the way a user would, through the document's own listeners. */
export function clickOn(env: UserscriptEnv, el: HTMLElement): void {
    el.dispatchEvent(new env.window.Event("click", { bubbles: true }));
}

/**
 * The assertions every capture must satisfy. `expectedToggles` differs per
 * capture because DeepSeek mounts the action bar lazily: the light and dark
 * captures have two replies but one row (the last reply had none when saved),
 * the older capture has two.
 */
export function describeCaptureBattery(capture: Capture, expected: { toggles: number }): void {
    const { env, replyMarkdown } = capture;

    describe("real capture battery", () => {
        test("the raw toggle is injected into every action bar there is, and only those", () => {
            const toggles = env.document.querySelectorAll("[data-md-raw-toggle]");
            expect(toggles.length).toBe(expected.toggles);
            for (const item of env.document.querySelectorAll("._4f9bf79")) {
                const toggle = item.querySelector("[data-md-raw-toggle]");
                if (!item.querySelector("._0a3d93b")) {
                    // No row, no toggle: the observer adds one if a row is mounted later
                    expect(toggle).toBeNull();
                    continue;
                }
                expect(toggle).not.toBeNull();
                // Reuses the native button's classes and structure, so the page's
                // own stylesheet renders it like its neighbours
                expect(toggle?.classList.contains("ds-button")).toBeTrue();
                expect(toggle?.classList.contains("ds-button--xs")).toBeTrue();
                expect(toggle?.querySelector(".ds-button__background")).not.toBeNull();
                // Appended last: the action bar keeps its native button order
                const buttons = item.querySelectorAll("._0a3d93b [role=button]");
                expect(buttons[buttons.length - 1]).toBe(toggle as Element);
                // A filled glyph with no stroke, and our own hint attribute rather
                // than `title` (which would raise the browser's unstyled box)
                const path = toggle?.querySelector("svg path");
                expect(path?.getAttribute("fill")).toBe("currentColor");
                expect(path?.hasAttribute("stroke")).toBeFalse();
                expect(toggle?.hasAttribute("title")).toBeFalse();
                expect(toggle?.getAttribute("data-md-raw-tip")).toBeTruthy();
            }
        });

        test("the toggle shows the reply source as a native code block", async () => {
            const toggle = env.document.querySelector("[data-md-raw-toggle]") as HTMLElement;
            expect(toggle).not.toBeNull();
            clickOn(env, toggle);

            const container = env.document.querySelector(".md-raw-source") as HTMLElement;
            const pre = container?.querySelector("pre") as HTMLElement;
            // The source text is the <pre>'s; the wrapper's own textContent also
            // carries the language banner
            expect(pre?.textContent).toBe(replyMarkdown);
            expect(container?.querySelector(".md-code-block")).not.toBeNull();
            expect(container?.querySelector(".d813de27")?.textContent).toBe("markdown");
            expect(container?.classList.contains("ds-markdown")).toBeTrue();
            // Only the rendered column is hidden
            const column = env.document.querySelector("._4f9bf79 .ds-assistant-message-main-content");
            expect(column?.getAttribute("data-md-raw-mode")).toBe("1");

            clickOn(env, toggle);
            await settle();
            expect(env.document.querySelector(".md-raw-source")).toBeNull();
            expect(column?.getAttribute("data-md-raw-mode")).toBeNull();
        });

        test("finds the edit button by the real pencil icon", () => {
            // The edit button is identified by its SVG path prefix; this asserts
            // the prefix still matches the icon the page actually ships.
            const EDIT_PREFIX = "M9.94076 1.34942";
            const paths = [...env.document.querySelectorAll("._9663006 svg path")];
            expect(paths.some((p) => (p.getAttribute("d") ?? "").startsWith(EDIT_PREFIX))).toBeTrue();
        });

        test("leaves the assistant messages' native nodes intact", () => {
            for (const item of env.document.querySelectorAll("._4f9bf79")) {
                // The reasoning header, its icons and the markdown column are the
                // host's; the toggle only ever appends to the action bar
                expect(item.querySelector("._74c0879")).not.toBeNull();
                expect(item.querySelector("._5255ff8")?.textContent).toContain("已思考");
                expect(item.querySelector(".ds-markdown.ds-assistant-message-main-content")).not.toBeNull();
            }
        });

        test("keeps every collapsible wrapper's own child nodes", () => {
            const boxes = [...env.document.querySelectorAll(".ds-collapsible-text")];
            expect(boxes.length).toBeGreaterThan(0);
            for (const box of boxes) {
                // Our Markdown lives in a sibling inside the collapsible container…
                expect(box.querySelector(".md-user-markdown")).not.toBeNull();
                // …and the host's own node is still there, holding the ORIGINAL raw
                // text (not our render output), so React's recorded node stays valid
                const hostChild = box.firstElementChild;
                expect(hostChild).not.toBeNull();
                expect(hostChild?.classList.contains("md-user-markdown")).toBeFalse();
                expect(hostChild?.textContent?.length ?? 0).toBeGreaterThan(0);
                expect(box.getAttribute("data-md-collapsible")).toBe("1");
                // The inline max-height DeepSeek measures against must survive
                expect(box.getAttribute("style")).toContain("max-height");
            }
        });
    });
}
