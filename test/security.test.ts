import { describe, expect, test } from "bun:test";
import { appendUserMessage, loadUserscript, setupTampermonkeyEnv } from "./env";

const env = setupTampermonkeyEnv();
const dangerous = appendUserMessage(
    env.document,
    [
        "<img src=x onerror=alert(1)>",
        "",
        '<a href="javascript:alert(1)">click me</a>',
        "",
        "<zzz>unknown tag</zzz>",
    ].join("\n"),
);
const legal = appendUserMessage(env.document, "<b>valid bold</b>");

await loadUserscript();

describe("HTML safety policy", () => {
    test("escapes tags with event handlers without creating elements", () => {
        expect(dangerous.querySelector("img")).toBeNull();
        expect(dangerous.innerHTML).toContain("&lt;img");
    });

    test("escapes javascript: protocol links", () => {
        expect(dangerous.querySelector("a")).toBeNull();
        expect(dangerous.innerHTML).toContain("&lt;a");
        expect(dangerous.innerHTML).not.toContain("<a ");
    });

    test("escapes unknown tags", () => {
        expect(dangerous.querySelector("zzz")).toBeNull();
        expect(dangerous.innerHTML).toContain("&lt;zzz&gt;");
    });

    test("keeps legal tags as HTML", () => {
        expect(legal.querySelector("b")?.textContent).toBe("valid bold");
    });
});
