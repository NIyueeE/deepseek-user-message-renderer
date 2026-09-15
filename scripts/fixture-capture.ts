#!/usr/bin/env bun
/**
 * Capture a fresh DeepSeek fixture from the live page.
 *
 *   bun run fixture:capture                 # light theme, default output
 *   bun run fixture:capture --dark          # also capture the dark theme
 *   bun run fixture:capture --out my-name   # write my-name.html / .provenance.json
 *   bun run fixture:capture --url https://chat.deepseek.com/a/chat/s/XXXX
 *
 * Why this exists: the userscript is written against DeepSeek's build-specific
 * DOM. Hand-written fixtures always agree with the selectors their author wrote,
 * so the only way to notice that DeepSeek renamed or restructured something is to
 * test against a real capture — and the only way to notice that a capture has
 * quietly lost half the page is to assert what it must contain
 * (test/fixture-contract.ts).
 *
 * This script is deliberately NOT part of `bun test`: the test suite must never
 * depend on the live site. Run it by hand whenever the contract check says the
 * capture is stale, or when you are adapting the script to a new DeepSeek UI.
 *
 * It inlines EVERY stylesheet via CSSOM, which is the fix for the deficiency in
 * the 2026-08-29 capture: that one had no <link> and no @import, so any vendor
 * stylesheet (the syntax-highlighting theme most likely) never made it in. A
 * SingleFile-style save keeps only the app's own CSS-in-JS.
 *
 * Setup (not in the repo, to keep CI light):
 *   mkdir -p /tmp/dsr-capture && cd /tmp/dsr-capture
 *   echo '{"private":true}' > package.json && bun add playwright
 *   bunx playwright install chromium
 *
 * Then run this file with that playwright resolvable, e.g.
 *   cd /tmp/dsr-capture && bun /path/to/repo/scripts/fixture-capture.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1]?.startsWith("--") ? (args[i + 1] as string) : fallback;
};

const URL_TO_OPEN = value("url", "https://chat.deepseek.com/");
const OUT_NAME = value("out", "deepseek-chat");
const REPO_ROOT = join(import.meta.dir, "..");
const OUT_DIR = value("dir", join(REPO_ROOT, "test", "fixtures"));

let chromium: typeof import("playwright").chromium;
try {
    ({ chromium } = await import("playwright"));
} catch {
    console.error(
        "playwright is not resolvable from here.\n" +
            "Set it up in a scratch dir (see the header of this file) and run this script from there.",
    );
    process.exit(2);
}

/**
 * DOM surgery applied in the page before serialising. Keeps the fixture small
 * and stable without touching anything the script depends on.
 */
const PRUNE = `
(() => {
  const remove = (sel) => document.querySelectorAll(sel).forEach((n) => n.remove());
  // Sidebar / header chrome and overlays have nothing to do with message rendering
  remove('nav, aside, header, [class*="sidebar"], [class*="history"], [role="dialog"], [class*="modal"]');
  // Avatars are inline data URIs that bloat the file
  document.querySelectorAll('img[src^="data:"]').forEach((img) => img.removeAttribute("src"));
  // Keep only the message list if we can find it; otherwise keep the body
  return true;
})()`;

const INLINE_STYLES = `
(() => {
  const parts = [];
  let crossOrigin = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { crossOrigin += 1; continue; }
    if (!rules) { crossOrigin += 1; continue; }
    for (const rule of Array.from(rules)) parts.push(rule.cssText);
  }
  const style = document.createElement("style");
  style.setAttribute("data-fixture-inlined", "cssom");
  style.textContent = parts.join("\\n");
  document.head.appendChild(style);
  return { inlinedRules: parts.length, crossOriginSheets: crossOrigin,
           sheets: document.styleSheets.length };
})()`;

interface Report {
    inlinedRules: number;
    crossOriginSheets: number;
    sheets: number;
}

async function capture(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
    theme: "light" | "dark",
): Promise<{ html: string; report: Report }> {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    if (theme === "dark") {
        // The live build keys dark mode off this attribute; set it before the app boots.
        await page.addInitScript(() => {
            document.documentElement?.setAttribute("data-ds-dark-theme", "");
        });
    }
    await page.goto(URL_TO_OPEN, { waitUntil: "domcontentloaded", timeout: 120_000 });
    console.log("\nA browser window is open.");
    console.log("  1. Log in if asked.");
    console.log("  2. Open a conversation that CONTAINS, in an ASSISTANT reply:");
    console.log("     a fenced code block (js/python), inline code, a formula, a table, a quote,");
    console.log("     a list, and a reasoning chain; and IN A USER MESSAGE: a long message");
    console.log("     (to trigger the collapsible wrapper).");
    console.log(`  3. Switch to the ${theme.toUpperCase()} theme.`);
    console.log("  Then press Enter here.\n");
    await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.once("data", () => resolve());
    });

    const report = (await page.evaluate(INLINE_STYLES)) as Report;
    await page.evaluate(PRUNE);
    const html = await page.evaluate(() => {
        // Freeze any transition/animation state so the saved inline styles are stable
        document.querySelectorAll("*").forEach((el) => {
            const s = (el as HTMLElement).style;
            if (s?.animation) s.animation = "none";
        });
        return "<!doctype html>\n" + document.documentElement.outerHTML;
    });
    await page.close();
    return { html, report };
}

const browser = await chromium.launch({ headless: false });
mkdirSync(OUT_DIR, { recursive: true });

const themes: Array<"light" | "dark"> = flag("dark") ? ["light", "dark"] : ["light"];
const summary: string[] = [];

for (const theme of themes) {
    const name = theme === "light" ? OUT_NAME : `${OUT_NAME}-dark`;
    const { html, report } = await capture(browser, theme);
    writeFileSync(join(OUT_DIR, `${name}.html`), html, "utf-8");

    const provenance = {
        source: URL_TO_OPEN,
        capturedAt: new Date().toISOString().slice(0, 10),
        theme,
        method:
            "scripts/fixture-capture.ts — opened the live page in Chromium, inlined every stylesheet " +
            `via CSSOM (${report.inlinedRules} rules from ${report.sheets} sheets), pruned sidebar/header/overlay ` +
            "chrome and avatar data URIs, then serialised documentElement.outerHTML.",
        intentionalGaps: [] as string[],
        knownDeficiencies: [] as string[],
    };
    writeFileSync(join(OUT_DIR, `${name}.provenance.json`), `${JSON.stringify(provenance, null, 4)}\n`, "utf-8");

    summary.push(
        `${name}.html  ${(html.length / 1024).toFixed(0)} KB  ` +
            `${report.inlinedRules} css rules from ${report.sheets} sheets` +
            (report.crossOriginSheets ? `  (${report.crossOriginSheets} cross-origin sheets skipped!)` : ""),
    );
}

await browser.close();

console.log("\nwrote:");
for (const line of summary) {
    console.log(`  ${line}`);
}
console.log("\nNext: bun run fixture:check");
console.log("It will tell you exactly which anchors/tokens/CSS features are present, and");
console.log("which gaps to declare in the .provenance.json (or fix by re-capturing).");
