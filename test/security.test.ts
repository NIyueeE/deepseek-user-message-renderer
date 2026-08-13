import { describe, expect, test } from "bun:test";
import { appendUserMessage, loadUserscript, settle, setupTampermonkeyEnv } from "./env";

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

async function render(text: string): Promise<HTMLElement> {
    const msg = appendUserMessage(env.document, text);
    await settle();
    return msg.querySelector(".fbb737a4") as HTMLElement;
}

describe("HTML safety policy", () => {
    test("escapes tags with event handlers without creating elements", () => {
        expect(dangerous.querySelector("img")).toBeNull();
        expect(dangerous.innerHTML).toContain("&lt;img");
    });

    test("escapes javascript: protocol links", () => {
        const rendered = dangerous.querySelector(".fbb737a4");
        // Assert on the rendered children only: dataset attributes on the
        // container hold the raw Markdown and would trip substring checks
        expect(rendered?.querySelector("a")).toBeNull();
        expect(rendered?.innerHTML).toContain("&lt;a");
        expect(rendered?.innerHTML).not.toContain("<a ");
    });

    test("escapes unknown tags", () => {
        expect(dangerous.querySelector("zzz")).toBeNull();
        expect(dangerous.innerHTML).toContain("&lt;zzz&gt;");
    });

    test("keeps legal tags as HTML", () => {
        expect(legal.querySelector("b")?.textContent).toBe("valid bold");
    });

    test("blocks tags that can hijack or impersonate the page", async () => {
        const rendered = await render(
            [
                '<iframe src="https://evil.example"></iframe>',
                '<base href="https://evil.example/">',
                '<meta http-equiv="refresh" content="0;url=https://evil.example">',
                '<form action="https://evil.example/collect"><input name="x"></form>',
                "<style>body{display:none}</style>",
                '<link rel="stylesheet" href="https://evil.example/x.css">',
                '<object data="https://evil.example"></object>',
                '<embed src="https://evil.example/x.swf">',
                "<script>alert(1)</script>",
                '<video src="https://evil.example/x.mp4" autoplay></video>',
                '<audio src="https://evil.example/x.mp3" autoplay></audio>',
            ].join("\n"),
        );

        for (const tag of [
            "iframe",
            "base",
            "meta",
            "form",
            "style",
            "link",
            "object",
            "embed",
            "script",
            "video",
            "audio",
        ]) {
            expect(rendered.querySelector(tag), tag).toBeNull();
        }
        expect(rendered.innerHTML).toContain("&lt;iframe");
    });

    test("blocks event handlers and URL schemes smuggled via character references", async () => {
        const rendered = await render('<a href="jav&#x61;script:alert(1)">x</a>');

        expect(rendered.querySelector("a")).toBeNull();
        expect(rendered.innerHTML).toContain("&lt;a");
    });

    test("blocks dangerous schemes in markdown links and images", async () => {
        const rendered = await render(
            ["[click](javascript:alert(1))", "", "![x](data:text/html,alert(1))", "", "[ok](https://example.com)"].join(
                "\n",
            ),
        );

        const links = rendered.querySelectorAll("a");
        expect(links.length).toBe(1);
        expect(links[0]?.getAttribute("href")).toBe("https://example.com");
        expect(rendered.querySelector("img")).toBeNull();
        expect(rendered.textContent).toContain("click");
        expect(rendered.textContent).toContain("x");
    });

    test("allows data:image URIs in markdown images", async () => {
        const rendered = await render("![icon](data:image/png;base64,iVBORw0KGgo=)");

        expect(rendered.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    });

    test("keeps safe URLs and harmless attribute values (no false positives)", async () => {
        const rendered = await render(
            '<a href="https://example.com/x" title="data:image note">ok</a>\n\n<b title="data:image/png">bold</b>',
        );

        expect(rendered.querySelector("a")?.getAttribute("href")).toBe("https://example.com/x");
        expect(rendered.querySelector("a")?.getAttribute("title")).toBe("data:image note");
        expect(rendered.querySelector("b")?.textContent).toBe("bold");
    });

    test("escapes an unsafe tag nested inside a legal block", async () => {
        const rendered = await render("<div>hello<img src=x onerror=alert(1)></div>");

        expect(rendered.querySelector("div")).toBeNull();
        expect(rendered.innerHTML).toContain("&lt;div&gt;");
    });

    test("illegal opener in one message does not suppress close tags in another", async () => {
        await render('<a href="javascript:alert(1)">bad</a>');
        const second = await render("text </a> more");

        // pre-fix: message 1's orphaned "a" leaked into message 2's parse and
        // forced the close tag to be escaped (visible literal "</a>"); each
        // parse is now isolated, so the stray close tag is simply ignored by
        // the HTML parser like any other stray end tag
        expect(second.textContent).not.toContain("</a>");
        expect(second.innerHTML).not.toContain("&lt;/a&gt;");
    });

    test("matches blocked close tags case-insensitively", async () => {
        const rendered = await render("<zzz>a</ZZZ>");

        expect(rendered.querySelector("zzz")).toBeNull();
        expect(rendered.innerHTML).toContain("&lt;zzz&gt;");
        expect(rendered.innerHTML).toContain("&lt;/ZZZ&gt;");
    });
});
