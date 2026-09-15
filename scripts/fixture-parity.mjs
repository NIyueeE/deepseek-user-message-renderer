#!/usr/bin/env bun
/**
 * Styling parity against the REAL capture (L3).
 *
 *   bun run fixture:parity
 *
 * Renders a javascript fence through the userscript on the captured page —
 * same DOM, same stylesheet, same libraries as `@require` — and diffs the
 * block it builds against a block DEEPSEEK rendered in that same capture:
 *
 *   structure    wrapper classes, child order, banner markup, corner decorations
 *   frame        border radius, margin, banner background
 *   typography   the <pre> font family / size / line height / background
 *   token colour for every token kind BOTH blocks contain, the computed colour
 *                must be identical
 *
 * Token-colour parity is the point: it proves the script's hljs -> Prism class
 * mapping lands on the classes DeepSeek's palette actually colours, rather than
 * producing spans that merely look plausible.
 *
 * This is the only check that can answer a styling question, and it needs a real
 * browser, so it is NOT part of `bun test` — CI stays light. Run it by hand
 * whenever rendering, CSS or the code-block structure changes. It found a real
 * bug the first time it ran (the raw view was 14px instead of the code block's
 * 13px, and painted its own background over the frame's).
 *
 * Doesn't work until the capture has a rendered code block: if
 * `bun run fixture:check` reports the `syntax-token-palette` gap, this script
 * cannot compare anything and will fail loudly.
 *
 * Setup (playwright is deliberately not a repo dependency):
 *   mkdir -p /tmp/dsr-browser && cd /tmp/dsr-browser
 *   echo '{"private":true}' > package.json && bun add playwright
 *   bunx playwright install chromium
 *   cd /tmp/dsr-browser && bun <repo>/scripts/fixture-parity.mjs
 *
 * Usage:
 *   bun run fixture:parity
 *   DSR_FIXTURE=deepseek-bugcase bun run fixture:parity   # compare another capture
 *   DSR_SRC=... bun run fixture:parity                    # compare another script
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = process.env.DSR_FIXTURE ?? "deepseek-chat";
const FIX = join(REPO, "test", "fixtures", `${FIXTURE}.html`);
const SRC = process.env.DSR_SRC ?? join(REPO, "src", "deepseek-user-message-renderer.user.js");

/**
 * Playwright is deliberately not a repo dependency, so it is usually installed
 * in a scratch dir and the script is invoked from there. Bare `import()` resolves
 * relative to THIS file, so fall back to resolving from the working directory.
 */
async function loadPlaywright() {
    try {
        return await import("playwright");
    } catch {
        // fall through to the cwd
    }
    try {
        const require = createRequire(join(process.cwd(), "package.json"));
        return await import(pathToFileURL(require.resolve("playwright")).href);
    } catch {
        return null;
    }
}

const playwright = await loadPlaywright();
if (!playwright) {
    console.error(
        "playwright is not resolvable from here.\n" +
            "Set it up in a scratch dir (see the header of this file) and run this script from there.",
    );
    process.exit(2);
}
const { chromium } = playwright;

const userscript = readFileSync(SRC, "utf-8");
const page = readFileSync(FIX, "utf-8");

// Take the library URLs straight from the userscript's @require lines, so the
// harness can never drift from what production loads.
const requires = [...userscript.matchAll(/^\/\/ @require\s+(\S+)$/gm)].map((m) => m[1]);
if (requires.length === 0) {
    console.error("no @require URLs found in the userscript");
    process.exit(2);
}
const resources = { HLJS_CSS: "", KATEX_CSS: "" };
for (const m of userscript.matchAll(/^\/\/ @resource\s+(\S+)\s+(\S+)$/gm)) {
    resources[m[1]] = m[2];
}

console.log(`fixture: ${FIXTURE}.html`);
console.log(`loading ${requires.length} @require libraries from their CDNs...`);
const loaded = new Map();
for (const url of requires) {
    const res = await fetch(url);
    if (!res.ok) {
        console.error(`failed to fetch ${url}: HTTP ${res.status}`);
        process.exit(2);
    }
    loaded.set(url, await res.text());
    console.log(`  ok  ${url.split("/").slice(-2).join("/")}`);
}
for (const [name, url] of Object.entries(resources)) {
    const res = await fetch(url);
    resources[name] = res.ok ? await res.text() : "";
}

const scripts = [...loaded.entries()]
    .map(([url, body], i) => {
        const path = `/vendor/lib-${i}.js`;
        loaded.set(path, body);
        return `<script src="${path}"></script>`;
    })
    .join("\n");

const boot = `${scripts}
<script>
window.__RESOURCES = ${JSON.stringify(resources)};
window.GM_addStyle = (c) => { const s = document.createElement("style"); s.textContent = c; document.head.appendChild(s); return s; };
window.GM_getResourceText = (n) => window.__RESOURCES[n] || "";
</script>`;

// Surround the fence with paragraphs, like a real message: a lone block would be
// both :first-child and :last-child of the markdown container, and the page's own
// CSS zeroes its margins then (`.ds-markdown > :first-child/:last-child`), which
// would look like a difference that is not one.
const fence = [
    "这是一段说明文字。",
    "",
    "```javascript",
    "function greet(name) {",
    "  console.log('Hello, ' + name);",
    "}",
    "greet('world');",
    "```",
    "",
    "这是结尾段落。",
].join("\n");

const appendFence = `<script>
(function () {
  const group = document.createElement("div");
  group.className = "_9663006";
  const msg = document.createElement("div");
  msg.className = "ds-message";
  const text = document.createElement("div");
  text.className = "fbb737a4";
  text.textContent = ${JSON.stringify(fence)};
  msg.appendChild(text);
  group.appendChild(msg);
  document.body.appendChild(group);

  // Synthetic fibres for the assistant replies (a SingleFile save keeps the DOM
  // but not React's internals)
  document.querySelectorAll("._4f9bf79 .ds-assistant-message-main-content").forEach((md) => {
    const comp = { memoizedProps: { markdown: "# t\\n\\n\`\`\`javascript\\nconst a = 1;\\n\`\`\`" }, return: null };
    const dom = { memoizedProps: { className: md.className }, return: comp };
    Object.defineProperty(md, "__reactFiber$parity", { value: dom, enumerable: true, configurable: true });
  });
})();
</script>
<script src="/userscript.js"></script>`;

// The capture ships DeepSeek's own CSP meta, which blocks every external script
// (`script-src 'unsafe-inline' data:`). Faithful to the live page, but it would
// block the harness's own libraries, so it is stripped for the test.
const stripped = page.replace(/<meta[^>]*content-security-policy[^>]*>/i, "");
const withBoot = stripped.replace(/<body/i, `${boot}<body`);
const finalHtml = withBoot.includes("</body>")
    ? withBoot.replace(/<\/body>/i, `${appendFence}</body>`)
    : `${withBoot}${appendFence}`;

const server = createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(finalHtml);
        return;
    }
    if (url === "/userscript.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(userscript);
        return;
    }
    const body = loaded.get(url);
    if (typeof body === "string") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(body);
        return;
    }
    res.writeHead(404).end("nf");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => {
    if (m.type() !== "error") return;
    // The capture references assets (fonts, images) we do not serve: those 404s
    // are an artifact of the local fixture, not a script error
    if (/Failed to load resource/.test(m.text())) return;
    errs.push(m.text());
});
await p.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
await p.waitForTimeout(900);

const failures = [];
const passes = [];
const check = (name, ok, detail) => {
    (ok ? passes : failures).push(name);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};

const result = await p.evaluate(() => {
    const read = (block) => {
        if (!block) return null;
        const pre = block.querySelector("pre");
        const cs = pre ? getComputedStyle(pre) : null;
        const banner = block.querySelector(".md-code-block-banner");
        const bcs = banner ? getComputedStyle(banner) : null;
        const tokens = {};
        for (const t of block.querySelectorAll("pre .token")) {
            for (const cls of t.classList) {
                if (cls === "token") continue;
                if (!(cls in tokens)) tokens[cls] = getComputedStyle(t).color;
            }
        }
        return {
            wrapper: [...block.classList].sort(),
            children: [...block.children].map((c) => c.tagName.toLowerCase()),
            corners: [...block.querySelectorAll(":scope > svg")].map((s) => s.getAttribute("class")),
            bannerClass: banner?.className ?? null,
            label: block.querySelector(".d813de27")?.textContent ?? null,
            frameRadius: getComputedStyle(block).borderRadius,
            frameBg: getComputedStyle(block).backgroundColor,
            frameMargin: getComputedStyle(block).margin,
            bannerBg: bcs?.backgroundColor ?? null,
            bannerRadius: bcs?.borderTopLeftRadius ?? null,
            wrapPresent: Boolean(block.querySelector(".md-code-block-banner-wrap")),
            preClass: pre?.className ?? null,
            fontFamily: cs?.fontFamily ?? null,
            fontSize: cs?.fontSize ?? null,
            lineHeight: cs?.lineHeight ?? null,
            preColor: cs?.color ?? null,
            preBg: cs?.backgroundColor ?? null,
            tokens,
        };
    };

    const native = [...document.querySelectorAll("._4f9bf79 .md-code-block")].find(
        (b) => b.querySelector(".d813de27")?.textContent === "javascript",
    );
    const ours = [...document.querySelectorAll("._9663006 .md-code-block")].find(
        (b) => b.querySelector(".d813de27")?.textContent === "javascript",
    );
    return { native: read(native), ours: read(ours) };
});

const { native, ours } = result;
check("a native javascript block exists in the capture", native !== null);
check("the script rendered a javascript block", ours !== null);

if (native && ours) {
    const same = (name, key, format = (v) => v) =>
        check(name, native[key] === ours[key], `${format(native[key])} vs ${format(ours[key])}`);
    const sameJson = (name, key) =>
        check(name, JSON.stringify(native[key]) === JSON.stringify(ours[key]),
            `${JSON.stringify(native[key])} vs ${JSON.stringify(ours[key])}`);

    sameJson("wrapper classes match", "wrapper");
    sameJson("child order matches (banner, pre, corner, corner)", "children");
    sameJson("corner decorations match", "corners");
    same("banner markup matches", "bannerClass");
    same("language label matches", "label");
    same("frame border-radius matches", "frameRadius");
    same("frame background matches", "frameBg");
    same("frame margin matches", "frameMargin");
    same("banner background matches", "bannerBg");
    same("banner radius matches", "bannerRadius");
    same("code font family matches", "fontFamily");
    same("code font size matches", "fontSize");
    same("code line height matches", "lineHeight");
    same("code text colour matches", "preColor");
    same("code background matches", "preBg");

    // The one deliberate difference, asserted so it stays deliberate
    check("native <pre> is bare; ours carries the language class",
        ours.preClass === "language-javascript",
        `ours="${ours.preClass}" native="${native.preClass}"`);

    // TOKEN COLOUR PARITY: every kind both blocks contain must colour the same.
    const shared = Object.keys(native.tokens).filter((k) => k in ours.tokens);
    const mismatched = shared.filter((k) => native.tokens[k] !== ours.tokens[k]);
    check(
        `token colours match for every shared kind (${shared.length}: ${shared.join(", ") || "none"})`,
        shared.length > 0 && mismatched.length === 0,
        mismatched.map((k) => `${k}: native=${native.tokens[k]} ours=${ours.tokens[k]}`).join("; "),
    );
    // A mapping that produced no coloured token at all would pass the check above
    // vacuously, so assert the script's tokens actually picked up real colours.
    check("the script's tokens picked up real palette colours",
        Object.keys(ours.tokens).length > 0, JSON.stringify(ours.tokens));
}

// The raw view must get the same treatment
await p.evaluate(() => document.querySelector("[data-md-raw-toggle]")?.click());
await p.waitForTimeout(400);
const raw = await p.evaluate(() => {
    const c = document.querySelector(".md-raw-source");
    if (!c) return null;
    const pre = c.querySelector("pre");
    const cs = pre ? getComputedStyle(pre) : null;
    const frame = c.querySelector(".md-code-block");
    const banner = c.querySelector(".md-code-block-banner");
    return {
        frame: frame?.className ?? null,
        frameRadius: frame ? getComputedStyle(frame).borderRadius : null,
        fontFamily: cs?.fontFamily ?? null,
        fontSize: cs?.fontSize ?? null,
        lineHeight: cs?.lineHeight ?? null,
        preBg: cs?.backgroundColor ?? null,
        bannerBg: banner ? getComputedStyle(banner).backgroundColor : null,
        tokens: c.querySelectorAll("pre .token").length,
        tokenColours: [...new Set([...c.querySelectorAll("pre .token")].map((t) => getComputedStyle(t).color))],
    };
});

check("raw view uses the native frame variant", /md-code-block md-code-block-(light|dark)/.test(raw?.frame ?? ""), raw?.frame);
check("raw view code font matches the native block",
    raw?.fontFamily === native?.fontFamily && raw?.fontSize === native?.fontSize,
    `${raw?.fontSize} vs native ${native?.fontSize}`);
check("raw view line height matches the native block", raw?.lineHeight === native?.lineHeight,
    `${raw?.lineHeight} vs ${native?.lineHeight}`);
check("raw view frame radius matches the native block", raw?.frameRadius === native?.frameRadius,
    `${raw?.frameRadius} vs ${native?.frameRadius}`);
check("raw view background placement matches the native block", raw?.preBg === native?.preBg,
    `pre bg ${raw?.preBg} vs ${native?.preBg}`);
check("raw view banner background matches the native block", raw?.bannerBg === native?.bannerBg,
    `${raw?.bannerBg} vs ${native?.bannerBg}`);
check("raw view is syntax coloured (markdown grammar)", (raw?.tokens ?? 0) > 0, `tokens=${raw?.tokens}`);
// Honest reporting rather than a dressed-up pass: the page's palette only covers
// a few token kinds per theme (light: keyword, string, function, punctuation).
// hljs' markdown grammar emits heading/bold/code/quote kinds, which the palette
// does NOT colour — so the raw view is largely monochrome, exactly as a
// ```markdown fence rendered by DeepSeek itself would be. Assert the class
// convention, report the coverage.
const inherited = await p.evaluate(() => {
    const pre = document.querySelector(".md-raw-source pre");
    return pre ? getComputedStyle(pre).color : null;
});
const beyondInherited = (raw?.tokenColours ?? []).filter((c) => c !== inherited);
console.log(
    `\nnote: raw-view token colours: ${JSON.stringify(raw?.tokenColours)}\n` +
        `      inherited code colour:    ${inherited}\n` +
        `      distinct palette colours: ${JSON.stringify([...new Set(Object.values(native?.tokens ?? {}))])}\n` +
        `      tokens coloured BEYOND the inherited colour: ${beyondInherited.length} ` +
        `(${JSON.stringify(beyondInherited)}) — a markdown fence is mostly ` +
        "heading/bold/code tokens, which this palette does not colour, so a low " +
        "number here matches what DeepSeek does with a markdown fence itself.",
);
check(
    "raw view uses the page's token-class convention",
    /token/.test(await p.evaluate(() => document.querySelector(".md-raw-source pre .token")?.className ?? "")),
);

check("no console/page errors", errs.length === 0, errs.join(" | "));

console.log(`\npassed: ${passes.length}   failed: ${failures.length}`);
if (failures.length) {
    console.log("failed checks:");
    for (const f of failures) console.log(`  - ${f}`);
}
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
