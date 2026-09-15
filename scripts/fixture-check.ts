#!/usr/bin/env bun
/**
 * Offline report: does the checked-in capture still satisfy the DOM/CSS contract?
 *
 *   bun run fixture:check              # every fixture with a provenance sidecar
 *   bun run fixture:check deepseek-chat  # just one
 *
 * Runs in CI (as part of `bun test`) and by hand. No browser, no network.
 * Use `bun run fixture:capture` when you need a fresh capture from the live page.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import type { FixtureAudit, FixtureProvenance } from "../test/fixture-contract";
import { auditFixture, parseProvenance } from "../test/fixture-contract";

const dir = join(import.meta.dir, "..", "test", "fixtures");
const only = process.argv[2];

const names = readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""))
    .filter((n) => !only || n === only)
    .sort();

if (names.length === 0) {
    console.error(only ? `no fixture named ${only}` : "no fixtures found");
    process.exit(1);
}

const tick = (ok: boolean) => (ok ? "ok  " : "MISS");
let blocked = 0;

function report(name: string, audit: FixtureAudit, provenance: FixtureProvenance | null): void {
    console.log(`\n${"=".repeat(72)}\nfixture: ${name}.html`);
    if (provenance) {
        console.log(`  source:     ${provenance.source}`);
        console.log(`  capturedAt: ${provenance.capturedAt}  theme: ${provenance.theme}`);
    }
    console.log(
        `  size:       ${audit.counts.styleBytes} css bytes, ${audit.counts.cssRules} rules, ` +
            `${audit.counts.domAnchors}/${Object.keys(audit.domPresent).length} DOM anchors, ` +
            `${audit.counts.tokens}/${Object.keys(audit.tokensPresent).length} tokens`,
    );

    console.log("\nDOM anchors");
    for (const [key, ok] of Object.entries(audit.domPresent)) {
        console.log(`  ${tick(ok)} ${key}`);
    }
    console.log("design tokens");
    for (const [key, ok] of Object.entries(audit.tokensPresent)) {
        console.log(`  ${tick(ok)} ${key}`);
    }
    console.log("CSS features");
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
    const extra = provenance as (FixtureProvenance & { notes?: string[]; knownDeficiencies?: string[] }) | null;
    for (const [label, list] of [
        ["known deficiencies of this capture", extra?.knownDeficiencies],
        ["notes", extra?.notes],
    ] as const) {
        if (list?.length) {
            console.log(`\n${label}`);
            for (const d of list) {
                console.log(`  - ${d}`);
            }
        }
    }

    const findings = [...audit.failures, ...audit.staleGaps];
    if (findings.length > 0) {
        blocked += findings.length;
        console.log(`\nFAILURES (${findings.length})`);
        for (const f of findings) {
            console.log(`  x ${f.detail}`);
        }
    }
}

for (const name of names) {
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
    report(name, audit, provenance);
}

if (blocked > 0) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(`${blocked} finding(s) across ${names.length} fixture(s).`);
    console.log("A capture that no longer satisfies the contract must be re-captured:");
    console.log("  bun run fixture:capture\n");
    process.exit(1);
}
console.log(`\n${"=".repeat(72)}`);
console.log(`Contract satisfied for ${names.length} fixture(s) (declared gaps noted above).\n`);
