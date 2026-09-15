import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const src = process.argv[2];
const html = readFileSync(src, "utf-8");
const w = new Window();
w.document.write(html);
const d = w.document;

const q = (sel) => d.querySelectorAll(sel).length;
console.log("=== counts ===");
for (const sel of [
    "._9663006",
    "div.fbb737a4",
    ".ds-collapsible-text",
    "._4f9bf79",
    ".ds-assistant-message-main-content",
    "._0a3d93b",
    ".md-code-block",
    ".md-code-block pre",
    ".md-code-block pre .token",
    "._5255ff8",
    "._74c0879",
    "._121d384",
    ".d813de27",
    "[data-ds-dark-theme]",
]) {
    console.log(`  ${sel.padEnd(38)} ${q(sel)}`);
}

console.log("\n=== user messages (raw text, first 160 chars) ===");
d.querySelectorAll("._9663006").forEach((g, i) => {
    const t = g.querySelector("div.fbb737a4");
    const col = t?.querySelector(".ds-collapsible-text");
    const holder = col?.firstElementChild ?? t;
    console.log(`  [${i}] collapsible=${Boolean(col)}`, JSON.stringify((holder?.textContent ?? "").slice(0, 160)));
});

console.log("\n=== assistant replies: rendered text + language banners ===");
d.querySelectorAll("._4f9bf79").forEach((item, i) => {
    const md = item.querySelector(".ds-assistant-message-main-content");
    const langs = [...item.querySelectorAll(".d813de27")].map((e) => e.textContent);
    console.log(`  [${i}] langs=${JSON.stringify(langs)}`);
    console.log(`      text=${JSON.stringify((md?.textContent ?? "").slice(0, 120))}`);
});

console.log("\n=== first real code block: structure ===");
const block = d.querySelector(".md-code-block");
if (block) {
    console.log("  className:", block.className);
    const kids = [...block.children].map((c) => `${c.tagName.toLowerCase()}.${c.className || "-"}`);
    console.log("  children:", JSON.stringify(kids));
    const pre = block.querySelector("pre");
    console.log("  pre exists:", Boolean(pre), " pre class:", pre?.className ?? "(none)");
    console.log(
        "  pre children tags:",
        JSON.stringify([...pre.children].slice(0, 6).map((c) => c.tagName.toLowerCase())),
    );
    console.log("  pre text:", JSON.stringify((pre.textContent ?? "").slice(0, 90)));
    console.log("  tokens:", pre.querySelectorAll(".token").length);
    const svgs = [...block.querySelectorAll(":scope > svg")].map((s) => s.getAttribute("class"));
    console.log("  decorative svgs (direct children):", JSON.stringify(svgs));
}

console.log("\n=== first assistant reply's own html head (for fibre shape) ===");
const md = d.querySelector("._4f9bf79 .ds-assistant-message-main-content");
console.log("  tag/class:", md?.tagName, md?.className);
