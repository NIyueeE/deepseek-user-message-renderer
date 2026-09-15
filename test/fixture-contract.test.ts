import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
 * When this fails:
 *   1. re-capture from the live page (see test/fixtures/README.md),
 *   2. re-run this test,
 *   3. only then continue the change you were making.
 *
 * Do NOT relax the contract to make a stale capture pass. If a required anchor
 * genuinely no longer exists on the page, that is not a test problem — it means
 * a selector in src/ needs updating, which is the whole point.
 */

const FIXTURE = join(import.meta.dir, "fixtures", "deepseek-chat.html");
const PROVENANCE = join(import.meta.dir, "fixtures", "deepseek-chat.provenance.json");

const html = readFileSync(FIXTURE, "utf-8");
const provenance = parseProvenance(
    (() => {
        try {
            return readFileSync(PROVENANCE, "utf-8");
        } catch {
            return null;
        }
    })(),
);

// Parse with happy-dom so the assertion uses the SAME engine the tests do.
const window = new Window();
window.document.write(html);
const audit = auditFixture({
    html,
    provenance,
    count: (selector) => window.document.querySelectorAll(selector).length,
});

describe("captured fixture contract", () => {
    test("the capture carries every DOM anchor the script targets", () => {
        const missing = audit.failures.filter((f) => f.key in audit.domPresent);
        expect(missing.map((f) => f.detail)).toEqual([]);
    });

    test("the capture carries every design token the script reads", () => {
        const missing = audit.failures.filter((f) => f.key.startsWith("--"));
        expect(missing.map((f) => f.detail)).toEqual([]);
    });

    test("the capture still looks like a DeepSeek chat page", () => {
        expect(audit.counts.domAnchors).toBeGreaterThanOrEqual(5);
        expect(audit.counts.cssRules).toBeGreaterThan(100);
    });

    test("no undeclared stylistic gaps", () => {
        // A CSS feature may be absent only when the provenance declares it; the
        // audit already fails on missing-and-undeclared, so this pins the intent.
        const cssFailures = audit.failures.filter((f) => f.key in audit.cssPresent);
        expect(cssFailures.map((f) => f.detail)).toEqual([]);
        // And every declared gap really is absent (checked again below).
        for (const gap of audit.gaps) {
            expect(CONTRACT_GAPS[gap.key]).toBeDefined();
        }
    });

    test("declared gaps match reality (no stale declarations)", () => {
        expect(audit.staleGaps.map((f) => f.detail)).toEqual([]);
    });

    test("a provenance sidecar exists and names its source", () => {
        expect(provenance).not.toBeNull();
        expect(provenance?.source).toBeTruthy();
        expect(provenance?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    test("no contract failures of any kind", () => {
        expect(audit.failures.map((f) => f.detail)).toEqual([]);
    });
});
