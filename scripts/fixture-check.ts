#!/usr/bin/env bun
/**
 * Offline report: does the checked-in capture still satisfy the DOM/CSS contract?
 *
 *   bun run fixture:check
 *
 * Runs in CI (as part of `bun test`) and by hand. No browser, no network.
 * Use `bun run fixture:capture` when you need a fresh capture from the live page.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { auditFixture, parseProvenance } from "../test/fixture-contract";

const dir = join(import.meta.dir, "..", "test", "fixtures");
const name = process.argv[2] ?? "deepseek-chat";
const html = readFileSync(join(dir, `${name}.html`), "utf-8");
let provenanceRaw: string | null = null;
try {
    provenanceRaw = readFileSync(join(dir, `${name}.provenance.json`), "utf-8");
} catch {
    provenanceRaw = null;
}
const provenance = parseProvenance(provenanceRaw);

const window = new Window();
window.document.write(html);
const audit = auditFixture({
    html,
    provenance,
    count: (selector) => window.document.querySelectorAll(selector).length,
});

const tick = (ok: boolean) => (ok ? "ok  " : "MISS");
console.log(`\nfixture: ${name}.html`);
if (provenance) {
    console.log(`  source:     ${provenance.source}`);
    console.log(`  capturedAt: ${provenance.capturedAt}  theme: ${provenance.theme}`);
}
console.log(
    `  size:       ${audit.counts.styleBytes} css bytes, ${audit.counts.cssRules} rules, ` +
        `${audit.counts.domAnchors} DOM anchors, ${audit.counts.tokens} tokens`,
);

console.log("\nDOM anchors");
for (const [key, ok] of Object.entries(audit.domPresent)) {
    console.log(`  ${tick(ok)} ${key}`);
}
console.log("\ndesign tokens");
for (const [key, ok] of Object.entries(audit.tokensPresent)) {
    console.log(`  ${tick(ok)} ${key}`);
}
console.log("\nCSS features");
for (const [key, ok] of Object.entries(audit.cssPresent)) {
    const declared = provenance?.intentionalGaps?.includes(key);
    console.log(`  ${tick(ok)} ${key}${!ok && declared ? "   (declared gap)" : ""}`);
}

if (audit.gaps.length > 0) {
    console.log("\nknown gaps (declared, allowed)");
    for (const g of audit.gaps) {
        console.log(`  - ${g.detail}`);
    }
}
if (audit.staleGaps.length > 0) {
    console.log("\nstale declarations (the capture has these now)");
    for (const g of audit.staleGaps) {
        console.log(`  ! ${g.detail}`);
    }
}
if (audit.warnings.length > 0) {
    console.log("\nwarnings");
    for (const w of audit.warnings) {
        console.log(`  ! ${w}`);
    }
}
const knownDeficiencies = (provenance as { knownDeficiencies?: string[] } | null)?.knownDeficiencies;
if (knownDeficiencies?.length) {
    console.log("\nknown deficiencies of this capture");
    for (const d of knownDeficiencies) {
        console.log(`  - ${d}`);
    }
}

const blocking = audit.failures.length + audit.staleGaps.length;
if (blocking > 0) {
    console.log(`\nFAILURES (${blocking})`);
    for (const f of [...audit.failures, ...audit.staleGaps]) {
        console.log(`  x ${f.detail}`);
    }
    console.log("\nThis capture can no longer be trusted. Re-capture: bun run fixture:capture\n");
    process.exit(1);
}
console.log("\nContract satisfied (declared gaps noted above).\n");
