import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { auditFixture, CONTRACT_GAPS, parseProvenance } from "./fixture-contract";

/**
 * Fail fast when a captured fixture no longer matches the DOM/CSS contract the
 * userscript is written against.
 *
 * A hand-written fixture always agrees with the selectors its author wrote, so
 * it can never notice that DeepSeek renamed or restructured something. The only
 * defence is a real capture — and the only defence against a real capture
 * quietly losing half the page (external stylesheets dropped, a section not
 * saved) is to assert what the capture must contain.
 *
 * Every `*.html` in test/fixtures/ that has a `*.provenance.json` sidecar is
 * audited, so adding a capture is all it takes to bring it under the contract.
 *
 * When this fails:
 *   1. re-capture from the live page (see test/fixtures/README.md),
 *   2. re-run `bun run fixture:check`,
 *   3. only then continue the change you were making.
 *
 * Do NOT relax the contract to make a stale capture pass. If a required anchor
 * genuinely no longer exists on the page, that is not a test problem — it means
 * a selector in src/ needs updating, which is the whole point.
 */

const FIXTURE_DIR = join(import.meta.dir, "fixtures");

interface LoadedFixture {
    name: string;
    audit: ReturnType<typeof auditFixture>;
}

function loadFixtures(): LoadedFixture[] {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".html"));
    return files.map((file) => {
        const name = file.replace(/\.html$/, "");
        const html = readFileSync(join(FIXTURE_DIR, file), "utf-8");
        let provenanceRaw: string | null = null;
        try {
            provenanceRaw = readFileSync(join(FIXTURE_DIR, `${name}.provenance.json`), "utf-8");
        } catch {
            provenanceRaw = null;
        }
        // Parse with happy-dom so the assertion uses the SAME engine as the tests.
        const window = new Window();
        window.document.write(html);
        const audit = auditFixture({
            html,
            provenance: parseProvenance(provenanceRaw),
            count: (selector) => window.document.querySelectorAll(selector).length,
        });
        return { name, audit };
    });
}

const fixtures = loadFixtures();

describe("captured fixture contract", () => {
    test("there is at least one real capture under contract", () => {
        expect(fixtures.length).toBeGreaterThanOrEqual(1);
    });

    for (const { name, audit } of fixtures) {
        describe(name, () => {
            test("a provenance sidecar exists and names its source", () => {
                expect(audit.provenance).not.toBeNull();
                expect(audit.provenance?.source).toBeTruthy();
                expect(audit.provenance?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
            });

            test("carries every DOM anchor the script targets", () => {
                const missing = audit.failures.filter((f) => f.key in audit.domPresent);
                expect(missing.map((f) => f.detail)).toEqual([]);
            });

            test("carries every design token the script reads", () => {
                const missing = audit.failures.filter((f) => f.key.startsWith("--"));
                expect(missing.map((f) => f.detail)).toEqual([]);
            });

            test("still looks like a DeepSeek chat page", () => {
                expect(audit.counts.domAnchors).toBeGreaterThanOrEqual(5);
                expect(audit.counts.cssRules).toBeGreaterThan(100);
            });

            test("no undeclared stylistic gaps", () => {
                const missing = audit.failures.filter((f) => f.key in audit.cssPresent);
                expect(missing.map((f) => f.detail)).toEqual([]);
                for (const gap of audit.gaps) {
                    expect(CONTRACT_GAPS[gap.key]).toBeDefined();
                }
            });

            test("declared gaps match reality (no stale declarations)", () => {
                expect(audit.staleGaps.map((f) => f.detail)).toEqual([]);
            });

            test("no contract failures of any kind", () => {
                expect(audit.failures.map((f) => f.detail)).toEqual([]);
            });
        });
    }
});
