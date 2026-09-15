// ==UserScript==
// @name         DeepSeek User Message Markdown Renderer
// @name:zh-CN   DeepSeek 用户消息 Markdown 渲染器
// @namespace    http://tampermonkey.net/
// @version      1.1.4
// @description  Render your own messages on DeepSeek web with native-style Markdown, LaTeX math, and official code blocks; safe editing and history highlight included.
// @description:zh-CN  让 DeepSeek 网页版中你自己发送的消息以原生样式渲染 Markdown、LaTeX 公式和官方风格代码块;支持安全编辑与历史消息高亮。
// @author       NIyueeE
// @license      MIT
// @homepageURL  https://github.com/NIyueeE/deepseek-user-message-renderer
// @supportURL   https://github.com/NIyueeE/deepseek-user-message-renderer/issues
// @updateURL    https://raw.githubusercontent.com/NIyueeE/deepseek-user-message-renderer/master/src/deepseek-user-message-renderer.user.js
// @downloadURL  https://raw.githubusercontent.com/NIyueeE/deepseek-user-message-renderer/master/src/deepseek-user-message-renderer.user.js
// @match        https://chat.deepseek.com/*
// @require      https://cdn.jsdelivr.net/npm/marked@18.0.9/lib/marked.umd.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js
// @resource     HLJS_CSS https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css
// @resource     KATEX_CSS https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @run-at       document-idle
// ==/UserScript==

(() => {
    // Source: https://github.com/NIyueeE/deepseek-user-message-renderer
    // Synced to GreasyFork & OpenUserJS via GitHub webhooks.
    // 1. Load stylesheets safely
    try {
        const hljsCss = GM_getResourceText("HLJS_CSS");
        const katexCss = GM_getResourceText("KATEX_CSS");
        if (hljsCss) {
            GM_addStyle(hljsCss);
        }
        if (katexCss) {
            GM_addStyle(katexCss);
        }
    } catch (e) {
        console.warn("Failed to inject stylesheets", e);
    }

    // While the Markdown lives in a sibling container inside a collapsible
    // container, the host app's own children stay in the DOM (React must keep
    // finding them for its commits to succeed) but out of view. They must stay
    // MEASURABLE: the host component derives the toggle visibility and the box
    // heights from the content element's size, so display:none (which measures
    // 0 and made the toggle disappear) is wrong — take the nodes out of flow
    // with an absolute position and hide them visually instead. Their size
    // then still reports the native text dimensions. The container itself
    // becomes the positioning parent, and the toggle button is excluded in
    // case a build moves it inside the container.
    try {
        GM_addStyle(
            "[data-md-collapsible] { position: relative !important; }" +
                "[data-md-collapsible] > :not(.md-user-markdown):not(.ds-collapsible-text-toggle-button) {" +
                " position: absolute !important; top: 0 !important; left: 0 !important;" +
                " width: 100% !important; visibility: hidden !important; }",
        );
    } catch (e) {
        console.warn("Failed to inject collapsible style", e);
    }

    // Assistant "raw source" mode: only the rendered Markdown column is hidden
    // while the raw source is shown in a <pre> next to it. The action bar (which
    // holds the toggle) therefore stays visible, and the assistant message's own
    // nodes are never mutated — the toggle is a pure view switch and reverts
    // losslessly. display:none is safe here: unlike the collapsible user-message
    // host nodes, nothing measures this column.
    const RAW_MODE_ATTR = "data-md-raw-mode";
    const RAW_SOURCE_CLASS = "md-raw-source";
    // The toggle button and its active-state marker (see section 10); declared
    // here because the stylesheet below needs them
    const RAW_BUTTON_ATTR = "data-md-raw-toggle";
    const RAW_ACTIVE_ATTR = "data-md-raw-active";
    try {
        GM_addStyle(
            `[${RAW_MODE_ATTR}] { display: none !important; }` +
                // The raw source is styled from DeepSeek's OWN design tokens and
                // reuses the native markdown container class (added in
                // showRawSource), so it inherits the page's typography and
                // follows the light/dark theme without hardcoding any colour.
                // The fallbacks only apply if a future build drops a token.
                `.${RAW_SOURCE_CLASS} {` +
                " margin: 0; padding: 0; border: 0;" +
                " font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);" +
                " font-size: var(--dsw-font-markdown-code-font-size, 14px);" +
                " line-height: var(--dsw-font-markdown-code-line-height, 22px);" +
                " font-weight: var(--dsw-font-markdown-code-font-weight, 400);" +
                " color: var(--dsw-alias-label-primary, inherit);" +
                " background-color: transparent;" +
                " white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }" +
                // While the raw source is shown, tint the toggle the way an
                // active native button is tinted. The host's own
                // ds-button__background element paints it, so the indicator
                // follows the theme; a build without that element shows no tint.
                `[${RAW_BUTTON_ATTR}][${RAW_ACTIVE_ATTR}="1"] .ds-button__background {` +
                " background-color: currentColor !important; opacity: 0.16 !important; }" +
                // Native-looking tooltip: the browser's own title box looks
                // nothing like DeepSeek's, so the hint is drawn from the page's
                // tooltip tokens (background, inverted label, caption font) and
                // revealed on hover with the usual short delay. `title` is
                // deliberately NOT set, so no second, unstyled box appears.
                `[${RAW_BUTTON_ATTR}]::after {` +
                " content: attr(data-md-raw-tip); position: absolute; top: calc(100% + 8px); left: 50%;" +
                " transform: translateX(-50%);" +
                " box-sizing: border-box; padding: 4px 8px; border-radius: 6px;" +
                " background-color: var(--dsw-alias-tooltip-bg, #2c2c2e);" +
                " color: var(--dsw-alias-label-primary-inverted, #fff);" +
                " font-family: var(--dsw-font-family, inherit);" +
                " font-size: var(--dsw-font-xxs-12-font-size, 12px);" +
                " font-weight: var(--dsw-font-xxs-12-font-weight, 400);" +
                " line-height: var(--dsw-font-xxs-12-line-height, 18px);" +
                " box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0, 0, 0, 0.12));" +
                " white-space: nowrap; opacity: 0; pointer-events: none; z-index: 10;" +
                " transition: opacity var(--ds-transition-duration-fast, 0.1s) ease; }" +
                `[${RAW_BUTTON_ATTR}]:hover::after, [${RAW_BUTTON_ATTR}]:focus-visible::after {` +
                " opacity: 1; transition-delay: 0.4s; }",
        );
    } catch (e) {
        console.warn("Failed to inject raw-mode style", e);
    }

    // The user message text element: the hashed class is confirmed stable in
    // DeepSeek's current build (same kind as _9663006; update if DeepSeek
    // changes it). Note: the companion class _8271fc3 only marks messages that
    // carry an attachment, so fbb737a4 alone identifies the text element.
    // Rendering happens in place on this element — no extra bubble is created
    // and no original node is hidden, so attachments and the native bubble
    // styling are never affected.
    const USER_TEXT_SELECTOR = "div.fbb737a4";
    // Class DeepSeek's own Markdown containers carry; adding it makes the
    // page's built-in stylesheet render the injected HTML with native styles.
    // Deliberately only `ds-markdown` (the previous implementation pattern):
    // `ds-assistant-message-main-content` carries assistant-column layout
    // rules (line-height, paragraph spacing) that make user bubbles too loose.
    const MARKDOWN_CONTAINER_CLASSES = ["ds-markdown"];

    // Newer DeepSeek builds wrap long user messages in a collapsible container:
    // fbb737a4 > div.ds-collapsible-text (clipped via an inline max-height, with
    // the measured height set inline too) plus a sibling
    // div.ds-collapsible-text-toggle-button that expands/collapses it. The host
    // app (React) inserts and removes its own children inside that container on
    // every toggle (a fade mask etc.), so its recorded child nodes must survive
    // at all times: the Markdown is rendered into a SIBLING container
    // (md-user-markdown) and the host's original children stay in the DOM,
    // hidden by the injected stylesheet rule. Replacing them instead would make
    // the host's next commit throw (NotFoundError) and swallow the message.
    // Short messages keep the flat structure and still render into fbb737a4
    // directly, in place.
    const COLLAPSIBLE_TEXT_CLASS = "ds-collapsible-text";
    // Class of our sibling Markdown container inside the collapsible container
    const MD_MARKDOWN_CLASS = "md-user-markdown";
    // dataset key (data-md-collapsible) marking a collapsible container whose
    // host children are hidden by the injected stylesheet rule. A data
    // attribute is used instead of a class because React rewrites className
    // when its own class state changes, while unknown data attributes are
    // never touched.
    const MD_COLLAPSIBLE_ATTR = "mdCollapsible";
    // After a collapse/expand toggle click, wait for the host's commit and
    // height animation before re-checking the message (see handleToggleClick)
    const TOGGLE_RECHECK_MS = 450;
    // The host's collapsed max-height per container, captured at first render;
    // used to tell collapsed from expanded when correcting stale box heights
    const COLLAPSED_MAX_HEIGHTS = new WeakMap();

    // The element whose content this script manages: the collapsible container
    // when the message is wrapped in one, otherwise the text element itself.
    // It carries the markdown classes and all md-rendered dataset markers.
    function resolveContentEl(textEl) {
        for (const child of Array.from(textEl.children)) {
            if (child.classList.contains(COLLAPSIBLE_TEXT_CLASS)) {
                return child;
            }
        }
        return textEl;
    }

    // 2. Configure marked
    //    - html: legal HTML tags render as native HTML; illegal ones (unknown tags,
    //      comments, declarations, or tags with event handlers or dangerous
    //      protocols) are kept as plain text without losing line breaks
    //    - Soft line breaks follow chat-style Markdown (GFM breaks): a single
    //      newline renders as a <br>, matching how DeepSeek displays user
    //      input; two trailing spaces or a backslash also produce a hard break,
    //      blank lines separate paragraphs, and newlines inside text kept
    //      verbatim are not affected
    function escapeHtml(text, preserveBreaks) {
        const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        return preserveBreaks ? escaped.replace(/\n/g, "<br>") : escaped;
    }

    const HTML_TAG_RE = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^\s"'>])+)*\s*\/?>$/;
    const OPEN_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^\s"'>])+)*\s*\/?>/;
    const TAG_ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    const BLOCK_TAG_SCAN_RE = /<([a-zA-Z][a-zA-Z0-9-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^\s"'>])+)*\s*\/?>/g;
    const VOID_TAGS = new Set([
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    ]);
    // Tags that can hijack or impersonate the page (phishing iframes, base/meta
    // redirects, form exfiltration, remote CSS, autoplaying media). They are
    // always escaped, regardless of their attributes.
    const BLOCKED_TAGS = new Set([
        "applet",
        "audio",
        "base",
        "embed",
        "form",
        "frame",
        "frameset",
        "iframe",
        "link",
        "meta",
        "noframes",
        "object",
        "portal",
        "script",
        "style",
        "video",
    ]);
    // Attribute names the browser resolves as URLs: their values are checked for
    // dangerous schemes. Other attributes (title, alt, class, ...) are never
    // treated as dangerous, so legal tags that merely mention "data:" or
    // "javascript:" in prose stay legal.
    const URL_ATTRS = new Set([
        "action",
        "background",
        "cite",
        "classid",
        "codebase",
        "data",
        "formaction",
        "href",
        "icon",
        "longdesc",
        "manifest",
        "poster",
        "profile",
        "src",
        "usemap",
        "xlink:href",
    ]);
    const EVENT_ATTR_RE = /^on\w+$/i;
    // Browsers decode character references in attribute values and strip tabs
    // and newlines from URLs before parsing the scheme; mirror both steps so
    // "jav&#x61;script:" can never slip through as a live handler.
    const DANGEROUS_SCHEME_RE = /^(?:javascript|vbscript|data|file):/i;

    // Numeric character references are decoded defensively: String.fromCodePoint
    // throws RangeError for anything outside Unicode, and browsers replace such
    // references with U+FFFD instead. A single out-of-range reference (e.g.
    // "&#x110000;" in a message) used to throw out of the renderer, abort the
    // whole parse, and silently drop that entire message back to plain text.
    function codePointFromRef(digits, radix) {
        const code = parseInt(digits, radix);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
            return "\ufffd";
        }
        return String.fromCodePoint(code);
    }

    function decodeAttrEntities(value) {
        const named = {
            amp: "&",
            lt: "<",
            gt: ">",
            quot: '"',
            apos: "'",
            Tab: "\t",
            NewLine: "\n",
            nbsp: "\u00a0",
        };
        return value
            .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePointFromRef(hex, 16))
            .replace(/&#(\d+);/g, (_, dec) => codePointFromRef(dec, 10))
            .replace(/&(amp|lt|gt|quot|apos|Tab|NewLine|nbsp);/g, (_, name) => named[name]);
    }

    function isKnownElement(tagName) {
        try {
            // createElement is case-insensitive for known elements in browsers;
            // lowercase first so happy-dom and real browsers agree
            return !(document.createElement(tagName.toLowerCase()) instanceof HTMLUnknownElement);
        } catch {
            return false;
        }
    }

    // Any attribute that can execute code or smuggle a dangerous URL makes the
    // whole tag illegal: event-handler names, srcdoc, and URL-valued attributes
    // whose decoded value starts with a dangerous scheme
    function hasUnsafeAttrs(tagText) {
        TAG_ATTR_RE.lastIndex = 0;
        for (let m = TAG_ATTR_RE.exec(tagText); m !== null; m = TAG_ATTR_RE.exec(tagText)) {
            const name = m[1].toLowerCase();
            const value = m[2] ?? m[3] ?? m[4] ?? "";
            if (EVENT_ATTR_RE.test(name) || name === "srcdoc") {
                return true;
            }
            if (URL_ATTRS.has(name)) {
                const decoded = decodeAttrEntities(value).replace(/[\t\n\r]/g, "");
                if (DANGEROUS_SCHEME_RE.test(decoded)) {
                    return true;
                }
            }
        }
        return false;
    }

    // Single tag (open/close): render as HTML only if the element name is legal,
    // not blocked, and carries no unsafe attribute
    function isLegalHtmlTag(text) {
        const match = HTML_TAG_RE.exec(text.trim());
        if (!match || !isKnownElement(match[1])) {
            return false;
        }
        if (BLOCKED_TAGS.has(match[1].toLowerCase())) {
            return false;
        }
        return !hasUnsafeAttrs(text);
    }

    // Block-level HTML (marked merges things like <div>...</div> into one token):
    // render only when the opening tag is legal, the closing tag matches, and
    // every tag inside the block is legal too (inner tags such as <img onerror>
    // are live HTML just like the outer one)
    function isLegalHtmlBlock(text) {
        const trimmed = text.trim();
        const open = OPEN_TAG_RE.exec(trimmed);
        if (!open || !isKnownElement(open[1]) || BLOCKED_TAGS.has(open[1].toLowerCase())) {
            return false;
        }
        if (VOID_TAGS.has(open[1].toLowerCase())) {
            return open[0] === trimmed;
        }
        if (!new RegExp(`</${open[1]}>\\s*$`, "i").test(trimmed)) {
            return false;
        }
        BLOCK_TAG_SCAN_RE.lastIndex = 0;
        for (let m = BLOCK_TAG_SCAN_RE.exec(trimmed); m !== null; m = BLOCK_TAG_SCAN_RE.exec(trimmed)) {
            const name = m[1].toLowerCase();
            if (BLOCKED_TAGS.has(name) || hasUnsafeAttrs(m[0])) {
                return false;
            }
        }
        return true;
    }

    function isSafeUrl(value) {
        if (!value) {
            return true;
        }
        const decoded = decodeAttrEntities(value)
            .replace(/[\t\n\r]/g, "")
            .trim();
        return !DANGEROUS_SCHEME_RE.test(decoded);
    }

    function isSafeImageUrl(value) {
        if (!value) {
            return true;
        }
        const decoded = decodeAttrEntities(value)
            .replace(/[\t\n\r]/g, "")
            .trim();
        if (/^(?:javascript|vbscript|file):/i.test(decoded)) {
            return false;
        }
        // data: URIs are acceptable for images (they cannot execute); other
        // data: payloads are not
        return !/^data:/i.test(decoded) || /^data:image\//i.test(decoded);
    }

    // Names of opening tags judged illegal and escaped; their matching closing
    // tags are also escaped so the original text is preserved completely. The
    // set is scoped to a single parse (see parseMarkdown) so one message's
    // state can never leak into another message's render.
    let activeBlockedTags = null;

    function parseMarkdown(text) {
        activeBlockedTags = new Set();
        try {
            return md.parse(text);
        } finally {
            activeBlockedTags = null;
        }
    }

    const mdRenderer = {
        html(token) {
            const text = typeof token === "string" ? token : token.text || "";
            const trimmed = text.trim();

            // Handle closing tags first (e.g. </a>) to avoid misreading them
            // as block-level HTML
            const close = /^<\/\s*([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(trimmed);
            if (close) {
                const name = close[1].toLowerCase();
                if (activeBlockedTags?.delete(name)) {
                    return escapeHtml(text, /\n/.test(text));
                }
                if (isKnownElement(name) && !BLOCKED_TAGS.has(name)) {
                    return text;
                }
                return escapeHtml(text, /\n/.test(text));
            }

            // Block-level HTML (marked merges things like <div>...</div> into
            // a single token)
            if (/\n/.test(text) || /<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/.test(text)) {
                return isLegalHtmlBlock(text) ? text : escapeHtml(text, true);
            }

            const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(trimmed);
            if (open && !/^<[!?]/.test(trimmed)) {
                const name = open[1].toLowerCase();
                if (isLegalHtmlTag(text)) {
                    activeBlockedTags?.delete(name);
                    return text;
                }
                activeBlockedTags?.add(name);
                return escapeHtml(text, false);
            }

            return escapeHtml(text, false);
        },
        // Markdown links and images are not raw HTML: marked generates the
        // anchor/img elements itself, so the html() policy never sees them.
        // Validate the destination here (the default renderer would emit the
        // dangerous URL verbatim) and render the text only when it is unsafe.
        link({ href, title, tokens, text }) {
            const inner = this.parser ? this.parser.parseInline(tokens) : escapeHtml(text ?? "");
            if (!isSafeUrl(href)) {
                return inner;
            }
            return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${inner}</a>`;
        },
        image({ href, title, text }) {
            if (!isSafeImageUrl(href)) {
                return escapeHtml(text ?? "");
            }
            return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text ?? "")}"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
        },
    };

    // Configure a private marked instance so the page-global `marked` (shared
    // with any other scripts) is never mutated; fall back to configuring the
    // shared instance only on very old UMD builds without the Marked constructor
    let md = null;
    if (typeof marked !== "undefined") {
        if (typeof marked.Marked === "function") {
            md = new marked.Marked({ breaks: true, renderer: mdRenderer });
        } else {
            marked.use({ breaks: true, renderer: mdRenderer });
            md = marked;
        }
    }

    // 2.5 Code blocks: rebuild marked's <pre><code> into DeepSeek's native
    //     md-code-block structure (banner with language label plus corner
    //     decorations) so the page's built-in CSS renders it exactly like native
    //     code blocks. Copy/download buttons are intentionally omitted: these
    //     are the user's own messages, so the actions would be pointless. The
    //     hashed class names come from DeepSeek's current build (same as
    //     _9663006 above).
    const SVG_NS = "http://www.w3.org/2000/svg";
    const CORNER_SVG_PATH = "M-5.24537e-07 0C-2.34843e-07 6.62742 5.37258 12 12 12L0 12L-5.24537e-07 0Z";
    const CODE_BLOCK_CLASSES = {
        label: "d813de27",
        header: "_121d384",
        side: "d2a24f03",
        cornerLeft: "_9bc997d _33882ae",
        cornerRight: "_9bc997d _28d7e84",
    };
    // highlight.js emits hljs-* span classes, but DeepSeek's CSS colors
    // Prism-style `token *` classes. Map them so the official theme applies.
    const HLJS_TO_PRISM = {
        keyword: "keyword",
        string: "string",
        comment: "comment",
        number: "number",
        function: "function",
        title: "function",
        "title.function_": "function",
        "title.class_": "class-name",
        built_in: "builtin",
        literal: "boolean",
        punctuation: "punctuation",
        operator: "operator",
        attr: "attr-name",
        attribute: "attr-name",
        variable: "variable",
        "variable.constant_": "constant",
        meta: "prolog",
        type: "class-name",
        params: "variable",
        regexp: "regex",
        symbol: "symbol",
        bullet: "bullet",
        link: "link",
        section: "heading",
        quote: "quote",
        deletion: "deleted",
        addition: "inserted",
        emphasis: "italic",
        strong: "bold",
        name: "tag",
        selector: "selector",
        tag: "tag",
        "template-variable": "variable",
        property: "property",
        "literal-property": "property",
        doctag: "tag",
        "meta string": "string",
    };

    function codeLanguageOf(codeEl) {
        const match = /language-([\w-]+)/.exec(codeEl.className);
        return match ? match[1] : "text";
    }

    function buildCornerSvg(doc, cornerClass) {
        const svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "12");
        svg.setAttribute("height", "12");
        svg.setAttribute("viewBox", "0 0 12 12");
        svg.setAttribute("fill", "none");
        svg.setAttribute("class", cornerClass);
        const pathEl = doc.createElementNS(SVG_NS, "path");
        pathEl.setAttribute("d", CORNER_SVG_PATH);
        pathEl.setAttribute("fill", "currentColor");
        svg.appendChild(pathEl);
        return svg;
    }

    function upgradeCodeBlock(pre) {
        if (!pre || pre.closest(".md-code-block")) {
            return;
        }
        const doc = pre.ownerDocument;
        const code = pre.querySelector("code");
        if (!code) {
            return;
        }
        const language = codeLanguageOf(code);

        // highlight.js put hljs-* classes on the code element and its spans;
        // DeepSeek's CSS styles `token *` classes instead, so rewrite them.
        code.classList.remove("hljs");
        code.querySelectorAll("span").forEach((span) => {
            const hljsClasses = Array.from(span.classList).filter((cls) => cls.startsWith("hljs-"));
            if (hljsClasses.length === 0) {
                return;
            }
            const tokens = [];
            for (const cls of hljsClasses) {
                const key = cls.slice("hljs-".length);
                const token = HLJS_TO_PRISM[key] ?? HLJS_TO_PRISM[key.split(".")[0]];
                if (token) {
                    tokens.push(token);
                }
            }
            span.className = tokens.length > 0 ? `token ${tokens.join(" ")}` : "token";
        });

        // Native DeepSeek code blocks have no <code> element: the highlighted
        // spans live directly inside <pre>. Unwrap ours the same way so page
        // rules targeting `code` (inline-code styles, white-space overrides)
        // can never hit the code block.
        while (code.firstChild) {
            pre.appendChild(code.firstChild);
        }
        code.remove();

        // Guarantee hard line breaks regardless of any page CSS: an inline
        // !important declaration beats every stylesheet rule (even other
        // !important ones), and pre-wrap matches native code blocks
        pre.style.setProperty("white-space", "pre-wrap", "important");

        const dark = doc.body.classList.contains("dark");
        const wrapper = doc.createElement("div");
        wrapper.className = `md-code-block md-code-block-${dark ? "dark" : "light"}`;

        const bannerWrap = doc.createElement("div");
        bannerWrap.className = "md-code-block-banner-wrap";
        const banner = doc.createElement("div");
        banner.className = "md-code-block-banner md-code-block-banner-lite";
        const header = doc.createElement("div");
        header.className = CODE_BLOCK_CLASSES.header;
        const left = doc.createElement("div");
        left.className = CODE_BLOCK_CLASSES.side;
        const label = doc.createElement("span");
        label.className = CODE_BLOCK_CLASSES.label;
        label.textContent = language;
        left.appendChild(label);
        header.appendChild(left);
        banner.appendChild(header);
        bannerWrap.appendChild(banner);
        wrapper.appendChild(bannerWrap);

        // The official CSS targets pre[class*=language-]; marked only puts the
        // language class on <code>
        pre.classList.add(`language-${language}`);
        const cornerLeft = buildCornerSvg(doc, CODE_BLOCK_CLASSES.cornerLeft);
        const cornerRight = buildCornerSvg(doc, CODE_BLOCK_CLASSES.cornerRight);
        wrapper.append(bannerWrap, cornerLeft, cornerRight);

        // Swap the wrapper in where the pre used to be, then move the pre inside
        // it (in that order: appending first would make replaceWith insert the
        // wrapper into itself)
        pre.replaceWith(wrapper);
        wrapper.insertBefore(pre, cornerLeft);
    }

    // Mirror DeepSeek's native inline structure: the assistant messages'
    // renderer wraps every text segment in <span class="">, and its stylesheet
    // is built around that shape. Bare text nodes are wrapped the same way.
    // Inline <code> and code blocks are left untouched: native inline code is
    // a bare <code> element and code blocks are rebuilt later (step 7).
    function wrapTextSegments(root) {
        for (const node of Array.from(root.childNodes)) {
            if (node.nodeType === 3) {
                if (!node.textContent) {
                    continue;
                }
                const span = document.createElement("span");
                span.className = "";
                node.replaceWith(span);
                span.textContent = node.textContent;
            } else if (node.nodeType === 1 && node.tagName !== "CODE" && node.tagName !== "PRE") {
                wrapTextSegments(node);
            }
        }
    }

    // marked emits a newline after every block element; the bubble's
    // white-space: pre-wrap would render each of those whitespace-only text
    // nodes as an extra empty line, so drop them everywhere except inside
    // <pre> (code indentation) and inline elements (spacing between words)
    const INLINE_ANCESTOR_SELECTOR =
        "a, span, code, em, strong, kbd, u, del, ins, sub, sup, small, b, i, label, q, s, mark";

    function removeWhitespaceOnlyTextNodes(root) {
        const toRemove = [];
        const collect = (node) => {
            for (const child of Array.from(node.childNodes)) {
                if (child.nodeType === 3) {
                    const text = child.textContent ?? "";
                    if (
                        !text.trim() &&
                        /\n/.test(text) &&
                        !child.parentElement?.closest(`pre, ${INLINE_ANCESTOR_SELECTOR}`)
                    ) {
                        toRemove.push(child);
                    }
                } else if (child.nodeType === 1) {
                    collect(child);
                }
            }
        };
        collect(root);
        for (const node of toRemove) {
            node.remove();
        }
    }

    // Chat-style line breaks (Typora-like): a run of M newlines between lines
    // renders as M-1 line breaks, so one blank line is just a <br> and only
    // three or more blank lines produce visible empty lines. Runs are rewritten
    // so marked keeps everything in one paragraph: the first newline stays a
    // soft break and each extra newline becomes a backslash hard break.
    // The scanner mirrors CommonMark's code constructs instead of guessing with
    // a regex: block fences (3+ backticks or tildes at line start, closed by a
    // run of the same character with at least the opening length) and inline
    // code spans (a backtick string closed by a backtick string of equal
    // length) keep their content verbatim — including blank lines — and a
    // blank line is preserved before fence openers: standard Markdown
    // formatting, plus a guard against setext misparsing (marked <=12 treated a
    // fence directly after a paragraph as a heading when its content started
    // with ---; see test/marked-quirk.test.ts).
    const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
    const FENCE_CLOSE_RE = /^[ \t]{0,3}([`~]+)[ \t]*$/;

    function findBacktickRun(str, exactLen) {
        for (let i = 0; i < str.length; i++) {
            if (str[i] !== "`") {
                continue;
            }
            let j = i;
            while (j < str.length && str[j] === "`") {
                j += 1;
            }
            const len = j - i;
            if (exactLen === undefined || len === exactLen) {
                return { index: i, len };
            }
            i = j - 1;
        }
        return null;
    }

    function isEscaped(str, index) {
        let slashes = 0;
        for (let i = index - 1; i >= 0 && str[i] === "\\"; i--) {
            slashes += 1;
        }
        return slashes % 2 === 1;
    }

    function collapseBlankLinesOutsideFences(text) {
        const lines = text.split("\n");
        let out = "";
        let pending = ""; // normal text accumulated since the last fence/span
        let fence = null; // { char, len } when inside a block fence
        let fenceContent = "";
        let spanLen = 0; // >0 when inside an inline code span
        let spanContent = "";

        for (const line of lines) {
            if (fence) {
                const close = FENCE_CLOSE_RE.exec(line);
                if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
                    out += collapseBlankRuns(pending, true);
                    pending = "";
                    out += fenceContent;
                    fence = null;
                    fenceContent = "";
                    pending = `${line}\n`;
                    continue;
                }
                fenceContent += `${line}\n`;
                continue;
            }
            if (spanLen > 0) {
                const close = findBacktickRun(line, spanLen);
                if (close) {
                    spanContent += line.slice(0, close.index + close.len);
                    out += collapseBlankRuns(pending, false);
                    pending = "";
                    out += spanContent;
                    spanLen = 0;
                    spanContent = "";
                    pending = `${line.slice(close.index + close.len)}\n`;
                    continue;
                }
                spanContent += `${line}\n`;
                continue;
            }

            // Fence opener: the whole opening line (info string included) is
            // verbatim fence content
            const fenceOpen = FENCE_OPEN_RE.exec(line);
            if (fenceOpen) {
                out += collapseBlankRuns(pending, true);
                pending = "";
                fence = { char: fenceOpen[1][0], len: fenceOpen[1].length };
                fenceContent = `${line}\n`;
                continue;
            }

            // Inline code spans: split the line into normal text and span
            // content, handling multiple spans per line and spans that
            // continue onto later lines
            let rest = line;
            let normalPart = "";
            let continued = false;
            for (;;) {
                const run = findBacktickRun(rest);
                if (!run || isEscaped(rest, run.index)) {
                    if (!run) {
                        normalPart += rest;
                        break;
                    }
                    normalPart += rest.slice(0, run.index + run.len);
                    rest = rest.slice(run.index + run.len);
                    continue;
                }
                normalPart += rest.slice(0, run.index + run.len);
                const after = rest.slice(run.index + run.len);
                const close = findBacktickRun(after, run.len);
                if (close) {
                    normalPart += after.slice(0, close.index + close.len);
                    rest = after.slice(close.index + close.len);
                    continue;
                }
                continued = true;
                spanLen = run.len;
                spanContent = `${after}\n`;
                break;
            }
            pending += continued ? normalPart : `${normalPart}\n`;
        }

        if (fence) {
            out += collapseBlankRuns(pending, true);
            out += fenceContent;
        } else if (spanLen > 0) {
            out += collapseBlankRuns(pending, false);
            out += spanContent;
        } else {
            out += collapseBlankRuns(pending, false);
        }
        return out;
    }

    // Lines that OPEN a construct ending at the next blank line. Collapsing the
    // blank line away would let the following line become a lazy continuation of
    // that construct: "> test\n\n你好" would render BOTH lines inside the quote,
    // and "- a\n\nplain" would put "plain" inside the list item.
    const QUOTE_LINE_RE = /^[ \t]{0,3}>/;
    const LIST_ITEM_RE = /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
    const HTML_BLOCK_LINE_RE = /^[ \t]{0,3}</;
    // A GFM table delimiter row ("| --- | :--: |"); tables only exist because
    // marked runs with GFM on.
    const TABLE_DELIMITER_RE = /^[ \t]{0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

    function isTableDelimiterRow(line) {
        return line.includes("|") && TABLE_DELIMITER_RE.test(line);
    }

    // True when the text right before the blank run is part of a table body
    // (a delimiter row is open and every line since is a table row)
    function endsInsideTable(before) {
        const lines = before.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
            if (!lines[i].includes("|")) {
                return false;
            }
            if (isTableDelimiterRow(lines[i])) {
                return true;
            }
        }
        return false;
    }

    function opensStrictContainer(line) {
        return QUOTE_LINE_RE.test(line) || LIST_ITEM_RE.test(line) || HTML_BLOCK_LINE_RE.test(line);
    }

    // True when the line after the blank run stays inside the same construct,
    // so the blank line may still collapse (multi-line quotes and lists keep
    // their compact chat-style spacing)
    function continuesContainer(prevLine, nextLine) {
        if (QUOTE_LINE_RE.test(prevLine)) {
            return QUOTE_LINE_RE.test(nextLine);
        }
        if (LIST_ITEM_RE.test(prevLine)) {
            return LIST_ITEM_RE.test(nextLine) || /^[ \t]/.test(nextLine);
        }
        return false;
    }

    // The blank line between the two lines must survive: it is either needed by
    // a setext underline / footnote definition (so they stay separate blocks
    // instead of collapsing into the previous paragraph), or it is what ends a
    // blockquote / list item / HTML block / table body.
    function mustKeepBlankLine(prevLine, nextLine, before) {
        if (/^[ \t]*(?:(?:-{3,}|={3,})[ \t]*(?:\n|$)|\[\^[^\]]+\]:)/.test(nextLine)) {
            return true;
        }
        if (endsInsideTable(before)) {
            return !nextLine.includes("|");
        }
        return opensStrictContainer(prevLine) && !continuesContainer(prevLine, nextLine);
    }

    function collapseBlankRuns(text, beforeFence) {
        let collapsed = text
            // A newline right next to an explicit <br> would add a second
            // <br> through GFM soft breaks (breaks: true), so drop it
            .replace(/\n[ \t]*(?=<br\b)/gi, "")
            .replace(/(?<=<br\b[^>]*>)[ \t]*\n/gi, "")
            .replace(/\n{2,}/g, (run, offset, whole) => {
                const after = whole.slice(offset + run.length);
                const before = whole.slice(0, offset);
                const prevLine = before.slice(before.lastIndexOf("\n") + 1);
                const nextBreak = after.indexOf("\n");
                const nextLine = nextBreak === -1 ? after : after.slice(0, nextBreak);
                if (mustKeepBlankLine(prevLine, nextLine, before)) {
                    return "\n\n";
                }
                return `\n${"\\\n".repeat(run.length - 2)}`;
            });
        if (beforeFence && collapsed && !collapsed.endsWith("\n\n")) {
            collapsed += "\n";
        }
        return collapsed;
    }

    function renderUserMessage(textEl) {
        // Only handle user messages: the text element lives inside the user
        // message container _9663006 (status rows and AI messages do not)
        if (!textEl.closest("._9663006")) {
            return;
        }

        // Edit-mode guard: skip messages while the group hosts an editor
        // (textarea / contenteditable), so DeepSeek's edit placeholder nodes
        // are never rendered in the first place
        const group = textEl.closest("._9663006");
        if (group?.querySelector("textarea, [contenteditable]")) {
            return;
        }

        // Edit-state guard: skip rendering while the message box contains an input
        // control (textarea / contenteditable) so DeepSeek's editor is not clobbered
        if (textEl.querySelector("textarea, [contenteditable]")) {
            return;
        }

        // Render into DeepSeek's collapsible container when the message is
        // wrapped in one; everything below operates on that element
        const contentEl = resolveContentEl(textEl);

        // Right after an edit-button restore, give the host app a moment to set up
        // its editor without the observer racing in and re-rendering the message
        const restoredAt = Number(contentEl.dataset.mdRestoredAt) || 0;
        if (restoredAt && Date.now() - restoredAt < RESTORE_COOLDOWN_MS) {
            return;
        }

        // While a collapse/expand toggle re-check is pending, the host app is
        // committing its own children in and out of the container — do not race it
        const toggledAt = Number(contentEl.dataset.mdToggledAt) || 0;
        if (toggledAt && Date.now() - toggledAt < TOGGLE_RECHECK_MS) {
            return;
        }

        // Theme switch: code blocks carry a dark/light variant class decided at
        // upgrade time, so when the page theme changes the rendered message
        // must be rebuilt. The observer picks up the body class change.
        const themeKey = document.body.classList.contains("dark") ? "dark" : "light";

        // Collapsible messages render into a sibling container so the host's
        // own child nodes stay valid for its commits; short (flat) messages
        // render in place, which has always been safe there
        if (contentEl !== textEl) {
            renderCollapsibleMessage(contentEl, themeKey);
            return;
        }

        // -- Flat message: render in place --
        // Use textContent, not innerText: innerText depends on the page's
        // white-space CSS and collapses newlines to spaces when the container
        // is not pre-wrap, which would flatten code fences and code lines.
        // Trim DOM whitespace around the message text: wrapper elements may
        // carry indentation-only text nodes, and leading spaces beyond three
        // would break fence detection (the message is its trimmed text)
        let rawText = (contentEl.textContent ?? "").trim();
        if (!rawText) {
            // An emptied message box (DeepSeek's edit UI moved the content into
            // the editor) should go back to a clean native state
            if (contentEl.classList.contains("ds-markdown")) {
                contentEl.classList.remove(...MARKDOWN_CONTAINER_CLASSES);
                contentEl.style.whiteSpace = "";
                delete contentEl.dataset.mdRendered;
                delete contentEl.dataset.mdRenderedText;
            }
            return;
        }

        // Re-render from the stored raw Markdown on a theme switch: the current
        // textContent is the script's own render output and would re-parse as
        // plain text.
        if (
            contentEl.dataset.mdRendered != null &&
            contentEl.dataset.mdTheme &&
            contentEl.dataset.mdTheme !== themeKey
        ) {
            if (contentEl.dataset.mdRenderedText === (contentEl.textContent ?? "").trim()) {
                rawText = contentEl.dataset.mdRendered;
            }
            delete contentEl.dataset.mdRenderedText;
        }

        // Skip if already rendered for the current text; re-render if the SPA
        // updated the text in place. mdRenderedText stores the trimmed text of
        // the last render output and is compared against the trimmed input, so
        // trailing whitespace (e.g. the newline a code fence keeps in
        // textContent) can never make the comparison unstable.
        if (contentEl.dataset.mdRenderedText === rawText) {
            return;
        }

        // Parse Markdown and render it in place: the text element becomes the
        // Markdown container. No original node is hidden or removed and no
        // extra bubble is created, so attachments and the native bubble layout
        // are never touched.
        const parsed = parseRawMarkdown(rawText);
        if (parsed == null) {
            // Fallback: keep the raw text visible, preserving line breaks
            contentEl.textContent = rawText.replace(/\s+$/, "");
            contentEl.style.whiteSpace = "pre-wrap";
        } else {
            contentEl.innerHTML = parsed;
            removeWhitespaceOnlyTextNodes(contentEl);
            contentEl.style.whiteSpace = "";
        }
        contentEl.classList.add(...MARKDOWN_CONTAINER_CLASSES);
        decorateMarkdown(contentEl);

        // Mark only after a successful render: mdRendered stores the raw
        // Markdown (restored on edit click), mdRenderedText stores the
        // trimmed text of the render output, which is what the next scan
        // reads, so the dedup check above stops the observer from
        // re-rendering in a loop. Failed renders can retry next time.
        contentEl.dataset.mdRendered = rawText;
        contentEl.dataset.mdRenderedText = (contentEl.textContent ?? "").trim();
        contentEl.dataset.mdTheme = themeKey;
    }

    // Parse raw Markdown into HTML for injection; null when marked is
    // unavailable or parsing failed (callers fall back to plain text)
    function parseRawMarkdown(rawText) {
        if (!md) {
            return null;
        }
        try {
            // marked always appends a trailing newline; the bubble's
            // white-space: pre-wrap would render it as an extra empty line
            // below the content, so strip trailing whitespace outside tags
            return parseMarkdown(collapseBlankLinesOutsideFences(rawText)).replace(/\s+$/, "");
        } catch (err) {
            console.error("Markdown parsing failed", err);
            return null;
        }
    }

    // Shared pipeline for a container that received parsed Markdown: native
    // paragraph classes and text-segment wrapping (must run before KaTeX so
    // math output is untouched), LaTeX math, syntax highlighting, and the
    // native md-code-block rebuild.
    function decorateMarkdown(container) {
        container.querySelectorAll("p").forEach((p) => {
            p.classList.add("ds-markdown-paragraph");
            wrapTextSegments(p);
        });

        if (typeof renderMathInElement === "function") {
            try {
                renderMathInElement(container, {
                    delimiters: [
                        { left: "$$", right: "$$", display: true },
                        { left: "$", right: "$", display: false },
                        { left: "\\(", right: "\\)", display: false },
                        { left: "\\[", right: "\\]", display: true },
                    ],
                    throwOnError: false,
                });
            } catch (err) {
                console.error("KaTeX math rendering failed", err);
            }
        }

        if (typeof hljs !== "undefined" && typeof hljs.highlightElement === "function") {
            try {
                container.querySelectorAll("pre code").forEach((block) => {
                    // Skip languages hljs does not know (e.g. mermaid, text):
                    // highlightElement would log a console warning and fall back
                    // to no highlighting anyway
                    const langMatch = /language-([\w-]+)/.exec(block.className);
                    if (langMatch) {
                        const language = langMatch[1];
                        if (language === "text" || !hljs.getLanguage(language)) {
                            return;
                        }
                    }
                    hljs.highlightElement(block);
                });
            } catch (err) {
                console.error("Highlight.js rendering failed", err);
            }
        }

        container.querySelectorAll("pre code").forEach((codeEl) => {
            try {
                if (codeEl.parentElement) {
                    upgradeCodeBlock(codeEl.parentElement);
                }
            } catch (err) {
                console.error("Code block upgrade failed", err);
            }
        });
    }

    function findMarkdownContainer(contentEl) {
        for (const child of Array.from(contentEl.children)) {
            if (child.classList.contains(MD_MARKDOWN_CLASS)) {
                return child;
            }
        }
        return null;
    }

    // -- Collapsible message --
    // The host app commits its own children in and out of the container on
    // every toggle, so they must stay in the DOM at all times. The Markdown
    // therefore lives in a sibling container (hidden host children via the
    // injected stylesheet rule) and the dedup fingerprint is our own
    // container's text, which the host never touches.
    function renderCollapsibleMessage(contentEl, themeKey) {
        const markdownEl = findMarkdownContainer(contentEl);
        if (markdownEl) {
            const unchanged = contentEl.dataset.mdRenderedText === markdownEl.textContent.trim();
            const themeChanged = contentEl.dataset.mdTheme !== themeKey;
            if (unchanged && !themeChanged) {
                return;
            }
            // Theme switch (or a mutated output container): rebuild from the
            // stored raw Markdown — the host's children may have been swapped
            // out by its toggle commits, so they are not a reliable source
            buildCollapsibleMarkdown(contentEl, contentEl.dataset.mdRendered || "", themeKey);
            return;
        }

        // Not rendered yet (fresh message, or a restore removed our container):
        // the host's children hold the raw message
        const rawText = (contentEl.textContent ?? "").trim();
        if (!rawText) {
            delete contentEl.dataset.mdRendered;
            delete contentEl.dataset.mdRenderedText;
            delete contentEl.dataset.mdTheme;
            delete contentEl.dataset[MD_COLLAPSIBLE_ATTR];
            return;
        }
        buildCollapsibleMarkdown(contentEl, rawText, themeKey);
    }

    function buildCollapsibleMarkdown(contentEl, rawText, themeKey) {
        const markdownEl = contentEl.ownerDocument.createElement("div");
        markdownEl.className = [MD_MARKDOWN_CLASS, ...MARKDOWN_CONTAINER_CLASSES].join(" ");
        const parsed = parseRawMarkdown(rawText);
        if (parsed == null) {
            // Fallback: keep the raw text visible, preserving line breaks
            markdownEl.textContent = rawText;
            markdownEl.style.whiteSpace = "pre-wrap";
        } else {
            markdownEl.innerHTML = parsed;
            removeWhitespaceOnlyTextNodes(markdownEl);
        }
        decorateMarkdown(markdownEl);

        findMarkdownContainer(contentEl)?.remove();
        contentEl.appendChild(markdownEl);
        // Stylesheet-scoped hiding of the host's own children (see the
        // injected rule at the top). A data attribute survives React rewriting
        // className, unlike a class.
        contentEl.dataset[MD_COLLAPSIBLE_ATTR] = "1";
        // Remember the host's collapsed box height so toggle handling can tell
        // collapsed from expanded later (see handleToggleClick)
        if (!COLLAPSED_MAX_HEIGHTS.has(contentEl)) {
            COLLAPSED_MAX_HEIGHTS.set(contentEl, contentEl.style.maxHeight);
        }
        // The message may already be expanded here (theme rebuild, or the host
        // expanded while we rendered): lift its stale measured height so the
        // taller Markdown is not clipped
        liftStaleExpandedHeight(contentEl);

        contentEl.dataset.mdRendered = rawText;
        contentEl.dataset.mdRenderedText = markdownEl.textContent.trim();
        contentEl.dataset.mdTheme = themeKey;
    }

    // The host sizes the collapsible box to the height it measured on the
    // native text. Our rendered Markdown is usually taller, so when the
    // message is expanded (its max-height differs from the collapsed value
    // captured at first render), lift the stale height to the actual content —
    // otherwise the expanded view clips. Collapsed boxes are left untouched.
    function liftStaleExpandedHeight(contentEl) {
        const collapsedMax = COLLAPSED_MAX_HEIGHTS.get(contentEl);
        if (!collapsedMax || contentEl.style.maxHeight === collapsedMax) {
            return;
        }
        contentEl.style.height = "auto";
        if (contentEl.style.maxHeight !== "none") {
            contentEl.style.maxHeight = "none";
        }
    }

    // 10. Assistant raw/rendered toggle: a native-style button injected into the
    //     assistant message's action bar (next to the copy button) that switches
    //     between the rendered Markdown (default) and the raw Markdown source.
    //     The assistant message's own DOM is never mutated: the toggle only marks
    //     the rendered Markdown column (hidden by the injected stylesheet) and
    //     puts a <pre> sibling next to it. Reverting removes both, so toggling is
    //     lossless and idempotent, and every node the host app recorded stays
    //     valid.
    //
    //     Current build layout (verified against the live DOM): the reply and its
    //     action row are SIBLINGS inside the assistant list item —
    //       div._4f9bf79._43c05b5
    //         div.ds-message                      <- the reply
    //           div.ds-assistant-message-main-content.ds-markdown   <- the answer
    //         div.ds-flex._0a3d93b                <- action row (copy/reply)
    //           div.ds-flex._965abe9._54866f7
    //             div[role=button].ds-button ...  <- the copy button
    //     so the row must be looked for as a sibling, not inside .ds-message.
    //
    //     The raw Markdown comes from the React fiber's memoized props. The
    //     assistant Markdown component exposes the answer as `markdown` and the
    //     reasoning chain as `content`; the thinking block renders into
    //     .ds-think-content, which is excluded so the toggle can never show the
    //     reasoning instead of the reply. Prop names survive minification, and
    //     the memoized props object is stable across renders — unlike the DOM,
    //     which keeps only what rendered — so the value is safe to cache.
    // Button labels: [0] while the raw source is shown (action: back to
    // rendered), [1] while the message is rendered (action: show raw source)
    const RAW_TOGGLE_TITLES = ["切换到渲染视图", "查看原始 Markdown"];
    // The reasoning chain container: its Markdown must never be mistaken for the
    // reply, and its React prop is `content` rather than `markdown`
    const THINKING_SELECTOR = ".ds-think-content";
    // The rendered reply column, most specific first
    const ANSWER_SELECTORS = [".ds-assistant-message-main-content", ".ds-markdown"];
    // Candidate prop names for the raw source, in priority order. `markdown` is
    // the reply; `content` is the thinking chain (only reached for elements that
    // are not inside .ds-think-content).
    const MARKDOWN_PROP_NAMES = ["markdown", "content", "source", "raw", "text", "value"];

    // Per-assistant-message state: the injected button, the Markdown column, the
    // raw source, and whether the raw view is currently shown
    const ASSISTANT_STATE = new WeakMap();
    // Cache the host's memoized props per Markdown element: the raw source
    // cannot change for a given element (a new message means a new element), so
    // a hit is always valid, which also keeps the frequent observer scans cheap
    const RAW_SOURCE_CACHE = new WeakMap();
    // Messages whose toggle was already injected; only these are refreshed on
    // later scans, so the frequent observer scans stay small
    const TRACKED_ASSISTANT_MESSAGES = new Set();
    // Messages for which the "no readable source" diagnostic was already logged
    const SOURCE_WARNED = new WeakSet();

    // React stores the internal fiber as a property on the DOM node
    function getFiberFrom(el) {
        for (const key of Object.keys(el)) {
            if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
                return el[key];
            }
        }
        return null;
    }

    // Rank a candidate source against the rendered column: strip everything that
    // is not a letter, digit, or CJK character and check that the beginning of
    // the rendered text still appears in the source. Used only to CHOOSE between
    // several named props — never to reject the only candidate, because rich
    // rendering (KaTeX, images, code blocks) legitimately diverges from the
    // source early on and would otherwise hide a perfectly good answer.
    function normalizeForCompare(text) {
        return text.replace(/[^\p{L}\p{N}]+/gu, "");
    }

    function contentLooksLikeRender(markdownEl, candidate) {
        const domText = normalizeForCompare(markdownEl.textContent || "");
        if (domText.length < 8) {
            // Too little rendered text to judge
            return true;
        }
        const source = normalizeForCompare(candidate);
        if (!source) {
            return false;
        }
        return source.includes(domText.slice(0, Math.min(12, domText.length)));
    }

    // Walk up from the Markdown column to the component that owns its source.
    // Prop names are tried in priority order (across the whole chain) so the
    // reply's `markdown` always wins over an ancestor's `content`; the first
    // candidate that matches the rendered output wins, and the highest-priority
    // candidate is used when none matches.
    function findMarkdownProps(markdownEl, fiber) {
        let firstNamed = null;
        for (const key of MARKDOWN_PROP_NAMES) {
            let current = fiber;
            for (let depth = 0; current && depth < 15; depth++, current = current.return) {
                const props = current.memoizedProps;
                if (!props || typeof props !== "object" || Array.isArray(props)) {
                    continue;
                }
                const value = props[key];
                if (typeof value !== "string" || value.trim().length === 0) {
                    continue;
                }
                if (contentLooksLikeRender(markdownEl, value)) {
                    return value;
                }
                firstNamed ??= value;
            }
        }
        return firstNamed;
    }

    // The cached entry stores the render fingerprint it was read for: the
    // virtualized message list can recycle a Markdown element for a different
    // message, and the raw source must then be re-read rather than served from
    // the cache (cheap enough — only messages the user toggled are tracked)
    function readRawAssistantMarkdown(markdownEl) {
        const fingerprint = markdownEl.textContent ?? "";
        const cached = RAW_SOURCE_CACHE.get(markdownEl);
        if (cached && cached.fingerprint === fingerprint) {
            return cached.raw;
        }
        const fiber = getFiberFrom(markdownEl);
        const raw = fiber ? findMarkdownProps(markdownEl, fiber) : null;
        if (raw != null) {
            RAW_SOURCE_CACHE.set(markdownEl, { raw, fingerprint });
            return raw;
        }
        return null;
    }

    // The rendered reply column: the first answer element that is NOT part of
    // the reasoning chain (the thinking block also renders a .ds-markdown)
    function findAnswerMarkdown(message) {
        for (const selector of ANSWER_SELECTORS) {
            for (const el of message.querySelectorAll(selector)) {
                if (!el.closest(THINKING_SELECTOR)) {
                    return el;
                }
            }
        }
        return null;
    }

    // The action row holding the copy/reply buttons. In the current build it is
    // a SIBLING of the reply .ds-message (inside the assistant list item); older
    // or nested builds keep it inside the message, so both shapes are supported.
    function findAssistantActionRow(message) {
        let sibling = message.nextElementSibling;
        for (let hops = 0; sibling && hops < 3; hops++, sibling = sibling.nextElementSibling) {
            if (sibling.matches?.('[role="button"]') || sibling.querySelector?.('[role="button"]')) {
                return sibling;
            }
        }
        sibling = message.previousElementSibling;
        for (let hops = 0; sibling && hops < 3; hops++, sibling = sibling.previousElementSibling) {
            if (sibling.matches?.('[role="button"]') || sibling.querySelector?.('[role="button"]')) {
                return sibling;
            }
        }
        for (const row of message.querySelectorAll("div.ds-flex")) {
            if (row.matches('[role="button"]') || row.querySelector('[role="button"]')) {
                return row;
            }
        }
        return null;
    }

    // The reverse of findAssistantActionRow: given the row (or anything inside
    // it), return the reply message it belongs to. In the current build the row
    // is a SIBLING of the message, so closest() alone is not enough — walk up to
    // the shared list item and take its message child.
    function findMessageForActionRow(row) {
        const nested = row.closest?.(".ds-message");
        if (nested) {
            return nested;
        }
        let node = row.parentElement;
        for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
            const message = node.querySelector?.(".ds-message");
            if (message) {
                return message;
            }
        }
        return null;
    }

    // Build the toggle by CLONING the neighbouring native action button. This is
    // what makes it behave natively: the host's own DOM shape — the icon
    // wrapper, the ds-button__background element that paints hover/active/focus,
    // and every state class — is reused verbatim, so whatever CSS the host
    // applies to its own buttons applies to ours, and it keeps working when the
    // build changes. Only the source button's identity is stripped (ids must not
    // be duplicated, and its tooltip/pressed state would be wrong here).
    function buildRawToggleButton(doc, anchor) {
        if (anchor && typeof anchor.cloneNode === "function") {
            const clone = anchor.cloneNode(true);
            clone.removeAttribute("id");
            clone.removeAttribute("title");
            clone.removeAttribute("data-md-raw-tip");
            clone.removeAttribute("aria-label");
            clone.removeAttribute("aria-pressed");
            clone.removeAttribute("aria-disabled");
            clone.removeAttribute(RAW_BUTTON_ATTR);
            clone.removeAttribute(RAW_ACTIVE_ATTR);
            for (const el of clone.querySelectorAll("[id]")) {
                el.removeAttribute("id");
            }
            // Put our glyph where the native icon was, keeping the host's
            // wrapper element(s) so their sizing and colour rules keep applying
            const nativeSvg = clone.querySelector("svg");
            const icon = buildRawToggleIcon(doc, nativeSvg);
            if (nativeSvg) {
                nativeSvg.replaceWith(icon);
            } else {
                (clone.querySelector(".ds-button__icon") || clone).appendChild(icon);
            }
            clone.classList.add("md-raw-toggle");
            clone.setAttribute(RAW_BUTTON_ATTR, "1");
            clone.setAttribute("role", "button");
            clone.setAttribute("tabindex", "0");
            clone.setAttribute("aria-disabled", "false");
            // The hint is drawn by our own token-styled tooltip (see the
            // stylesheet); no `title`, so the browser's box never shows up
            clone.setAttribute("data-md-raw-tip", RAW_TOGGLE_TITLES[1]);
            return clone;
        }
        // Fallback for a build without a clonable neighbour button: rebuild the
        // same structure by hand, background element included so hover works
        const button = doc.createElement("div");
        button.className =
            "md-raw-toggle ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs";
        button.setAttribute(RAW_BUTTON_ATTR, "1");
        button.setAttribute("role", "button");
        button.setAttribute("tabindex", "0");
        button.setAttribute("aria-disabled", "false");
        button.setAttribute("data-md-raw-tip", RAW_TOGGLE_TITLES[1]);
        const background = doc.createElement("div");
        background.className = "ds-button__background";
        button.appendChild(background);
        const icon = doc.createElement("div");
        icon.className = "ds-button__icon ds-button__icon--last-child";
        icon.appendChild(buildRawToggleIcon(doc));
        button.appendChild(icon);
        return button;
    }

    // The element the native action buttons actually live in: the row may be a
    // wrapper around a single inner row, and appending to the wrong one would
    // misalign the toggle
    function buttonRowFor(actionRow) {
        const buttons = actionRow.querySelectorAll('[role="button"]');
        if (buttons.length === 0) {
            return actionRow;
        }
        // Walk up from a button to the deepest ancestor that still holds exactly
        // this row's buttons
        let row = buttons[0].parentElement;
        while (row && row !== actionRow && row.parentElement !== actionRow) {
            const parent = row.parentElement;
            if (!parent || parent.querySelectorAll('[role="button"]').length !== buttons.length) {
                break;
            }
            row = parent;
        }
        return row ?? actionRow;
    }

    // A "</>" mark laid out on a 16x16 grid: a left chevron, a slash, and a
    // right chevron. The proportions follow the widely used "code" icon — a
    // wider slash and roomier chevrons — because a tighter hand-rolled variant
    // turned to mush at the ~20px the action bar renders.
    const CODE_GLYPH = [
        // left chevron
        [
            [6, 4],
            [2, 8],
            [6, 12],
        ],
        // slash
        [
            [9.33, 2.67],
            [6.67, 13.33],
        ],
        // right chevron
        [
            [10, 4],
            [14, 8],
            [10, 12],
        ],
    ];

    // Map the 16x16 glyph onto the icon's own coordinate system, scaling
    // uniformly so the mark keeps its proportions whatever viewBox a build uses
    function mapGlyphToViewBox(points, viewBox) {
        const nums = String(viewBox || "")
            .trim()
            .split(/[\s,]+/)
            .map(Number)
            .filter((n) => Number.isFinite(n));
        const [minX, minY, vbW, vbH] = nums.length === 4 ? nums : [0, 0, 16, 16];
        const scale = Math.min(vbW, vbH) / 16;
        const round = (n) => Math.round(n * 100) / 100;
        return points
            .map(([x, y]) => [round(minX + x * scale), round(minY + y * scale)])
            .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`)
            .join("");
    }

    // Our "</>" glyph, drawn with the native icon's own geometry
    function buildRawToggleIcon(doc, template) {
        // Derive every geometric attribute from the native icon being replaced,
        // so our glyph is exactly the same box, scale, stroke and colour as the
        // host's own icons. Hardcoding a size was why the button looked smaller
        // and off-centre compared with its neighbours. The fallback values only
        // apply when there is no native icon to copy.
        const size = template?.getAttribute("width") || template?.getAttribute("height") || "16";
        const viewBox = template?.getAttribute("viewBox") || "0 0 16 16";
        const stroke = template?.getAttribute("stroke") || "currentColor";
        const svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", size);
        svg.setAttribute("height", size);
        svg.setAttribute("viewBox", viewBox);
        svg.setAttribute("fill", template?.getAttribute("fill") || "none");
        svg.setAttribute("xmlns", SVG_NS);
        if (template?.getAttribute("class")) {
            svg.setAttribute("class", template.getAttribute("class"));
        }
        // Copy the native paths' presentation attributes (stroke width, line
        // caps/joins, ...) onto our own paths, so the glyph is drawn with the
        // page's own icon language instead of guessed values.
        const inherited = {};
        const collect = (el, skip) => {
            if (!el) {
                return;
            }
            for (const attr of Array.from(el.attributes)) {
                if (!skip.includes(attr.name) && !(attr.name in inherited)) {
                    inherited[attr.name] = attr.value;
                }
            }
        };
        // The native icon may carry its presentation attributes on the <svg>
        // itself (stroke, stroke-width, ...) or on the path; take both, with the
        // path winning, so the glyph is drawn exactly like the host's icons
        collect(template, ["class", "xmlns", "viewBox", "width", "height", "fill"]);
        collect(template?.querySelector("path"), ["d", "class"]);
        // One path carrying all three strokes, so the whole mark inherits the
        // native icon's presentation attributes at once and always scales as a
        // single unit (separate paths used to disagree about the viewBox)
        const pathEl = doc.createElementNS(SVG_NS, "path");
        pathEl.setAttribute("d", CODE_GLYPH.map((points) => mapGlyphToViewBox(points, viewBox)).join(" "));
        for (const [name, value] of Object.entries(inherited)) {
            pathEl.setAttribute(name, value);
        }
        const withDefault = (name, value) => {
            if (!(name in inherited)) {
                pathEl.setAttribute(name, value);
            }
        };
        withDefault("stroke", stroke);
        withDefault("fill", "none");
        withDefault("stroke-width", "1.5");
        withDefault("stroke-linecap", "round");
        withDefault("stroke-linejoin", "round");
        svg.appendChild(pathEl);
        return svg;
    }

    // Build the button once per message and keep it injected. It deliberately
    // copies the sibling copy button's own classes so the page stylesheet
    // renders it exactly like the other action buttons.
    function ensureRawToggleButton(message, actionRow) {
        let state = ASSISTANT_STATE.get(message);
        if (!state) {
            state = { button: null, markdownEl: null, rawSource: null, raw: false };
            ASSISTANT_STATE.set(message, state);
        }
        if (state.button?.isConnected) {
            return state;
        }
        state.button = null;
        // Adopt (and de-duplicate) a toggle that is already in this message: the
        // host can re-render or clone the node, which would otherwise leave two
        // buttons or an untracked one behind
        const existingButtons = message.parentElement
            ? message.parentElement.querySelectorAll(`[${RAW_BUTTON_ATTR}]`)
            : [];
        if (existingButtons.length > 0) {
            const [kept, ...extras] = existingButtons;
            for (const extra of extras) {
                extra.remove();
            }
            state.button = kept;
            TRACKED_ASSISTANT_MESSAGES.add(message);
            return state;
        }
        const doc = message.ownerDocument;
        // Clone the host's own button, so every native class and the whole
        // hover/active/focus structure come along
        const copyBtn = actionRow.querySelector('[role="button"]');
        const anchor = copyBtn ?? (actionRow.matches?.('[role="button"]') ? actionRow : null);
        const button = buildRawToggleButton(doc, anchor);
        // Kept at the FAR RIGHT of the action row, after the reply/share buttons,
        // so it reads as an extra utility instead of interrupting the native
        // button order. It is appended to the innermost row that actually holds
        // the buttons, so it lines up with them.
        buttonRowFor(actionRow).appendChild(button);
        state.button = button;
        // Track the message so later scans keep the toggle and the raw view
        // consistent with the host's DOM
        TRACKED_ASSISTANT_MESSAGES.add(message);
        return state;
    }

    // Reflect the current mode on the button: a highlighted "on" state plus a
    // label describing the action a click performs
    function syncRawToggleState(state) {
        const button = state.button;
        if (!button) {
            return;
        }
        button.setAttribute(RAW_ACTIVE_ATTR, state.raw ? "1" : "0");
        button.setAttribute("aria-pressed", state.raw ? "true" : "false");
        // Describes the action a click performs; drawn by our own tooltip
        button.setAttribute("data-md-raw-tip", state.raw ? RAW_TOGGLE_TITLES[0] : RAW_TOGGLE_TITLES[1]);
    }

    function findRawSourceEl(message) {
        return message.querySelector(`.${RAW_SOURCE_CLASS}`);
    }

    function showRawSource(message, state) {
        if (!state.rawSource || !state.markdownEl?.isConnected) {
            return;
        }
        const existing = findRawSourceEl(message);
        const markdownEl = state.markdownEl;
        // Already in the desired state: do nothing. The scan runs after every
        // relevant mutation, and re-creating the nodes here would mutate the DOM
        // again and re-trigger the observer forever.
        if (
            existing?.previousElementSibling === markdownEl &&
            existing.textContent === state.rawSource &&
            markdownEl.getAttribute(RAW_MODE_ATTR) === "1"
        ) {
            state.raw = true;
            syncRawToggleState(state);
            return;
        }
        existing?.remove();
        // The host may have re-rendered the Markdown column: never leave a
        // stale hidden element behind
        for (const el of message.querySelectorAll(`[${RAW_MODE_ATTR}]`)) {
            el.removeAttribute(RAW_MODE_ATTR);
        }
        const pre = message.ownerDocument.createElement("pre");
        // The native markdown container class is reused so the page's own
        // markdown rules (typography, colour) apply to the raw source too
        pre.className = `${RAW_SOURCE_CLASS} ds-markdown`;
        pre.textContent = state.rawSource;
        // Only the Markdown column is hidden, and the raw source is placed next
        // to it — the host's recorded nodes are never touched, moved, or
        // replaced, and the action bar stays usable
        markdownEl.insertAdjacentElement("afterend", pre);
        markdownEl.setAttribute(RAW_MODE_ATTR, "1");
        state.raw = true;
        syncRawToggleState(state);
    }

    function showRenderedMessage(message, state) {
        findRawSourceEl(message)?.remove();
        for (const el of message.querySelectorAll(`[${RAW_MODE_ATTR}]`)) {
            el.removeAttribute(RAW_MODE_ATTR);
        }
        state.raw = false;
        syncRawToggleState(state);
    }

    // Toggle one assistant message. The raw source is resolved once (and cached)
    // so repeated clicks and observer scans stay cheap.
    function toggleAssistantRawView(message) {
        const markdownEl = findAnswerMarkdown(message);
        if (!markdownEl) {
            return;
        }
        const raw = readRawAssistantMarkdown(markdownEl);
        if (raw == null) {
            return;
        }
        const actionRow = findAssistantActionRow(message);
        if (!actionRow) {
            return;
        }
        const state = ensureRawToggleButton(message, actionRow);
        state.markdownEl = markdownEl;
        state.rawSource = raw;
        if (state.raw) {
            showRenderedMessage(message, state);
        } else {
            showRawSource(message, state);
        }
    }

    // Keep already-injected toggles consistent with the host's DOM: re-attach a
    // button the host re-rendered away, rebuild the raw view if the host
    // re-rendered the Markdown column, and drop the button when the source is
    // no longer readable (never leave a button that would do nothing)
    function refreshAssistantMessage(message) {
        const state = ASSISTANT_STATE.get(message);
        if (!state) {
            return;
        }
        const markdownEl = findAnswerMarkdown(message);
        if (!markdownEl) {
            return;
        }
        const raw = readRawAssistantMarkdown(markdownEl);
        if (raw == null) {
            showRenderedMessage(message, state);
            state.button?.remove();
            state.button = null;
            return;
        }
        const actionRow = findAssistantActionRow(message);
        if (!actionRow) {
            return;
        }
        state.markdownEl = markdownEl;
        state.rawSource = raw;
        ensureRawToggleButton(message, actionRow);
        if (state.raw) {
            showRawSource(message, state);
        }
    }

    // Locate the assistant reply messages: .ds-message elements outside a user
    // message group that render a reply column
    function findAssistantMessages() {
        const messages = [];
        for (const message of document.querySelectorAll(".ds-message")) {
            if (message.closest("._9663006")) {
                continue;
            }
            if (findAnswerMarkdown(message)) {
                messages.push(message);
            }
        }
        return messages;
    }

    // Only messages whose toggle was already injected are tracked, so the
    // frequent observer scans stay small and messages whose DOM was recycled by
    // the virtualized list drop out instead of growing the set forever
    function processAssistantMessages() {
        // 1. Keep the toggles already injected consistent with the host's DOM
        //    (re-attach a button the host re-rendered away, rebuild the raw view)
        for (const message of Array.from(TRACKED_ASSISTANT_MESSAGES)) {
            if (!message.isConnected) {
                TRACKED_ASSISTANT_MESSAGES.delete(message);
                continue;
            }
            try {
                refreshAssistantMessage(message);
            } catch (err) {
                console.error("Assistant raw toggle refresh failed", err);
            }
        }
        // 2. Inject the toggle for assistant replies that do not have one yet.
        //    The action row only exists once the reply is complete, which keeps
        //    this off the streaming hot path and avoids a toggle on a
        //    half-written message.
        for (const message of findAssistantMessages()) {
            if (TRACKED_ASSISTANT_MESSAGES.has(message)) {
                continue;
            }
            try {
                injectAssistantToggle(message);
            } catch (err) {
                console.error("Assistant raw toggle injection failed", err);
            }
        }
    }

    function injectAssistantToggle(message) {
        const markdownEl = findAnswerMarkdown(message);
        if (!markdownEl) {
            return;
        }
        const actionRow = findAssistantActionRow(message);
        if (!actionRow) {
            return;
        }
        const raw = readRawAssistantMarkdown(markdownEl);
        if (raw == null) {
            // No readable source (a build whose React internals changed, or a
            // hand-written/bot message): never inject a button that would do
            // nothing. Warned once per message so a real break stays diagnosable.
            if (!SOURCE_WARNED.has(message)) {
                SOURCE_WARNED.add(message);
                console.warn(
                    "[deepseek-user-message-renderer] assistant reply has no readable raw Markdown; raw toggle not injected",
                );
            }
            return;
        }
        const state = ensureRawToggleButton(message, actionRow);
        state.markdownEl = markdownEl;
        state.rawSource = raw;
        syncRawToggleState(state);
    }
    // 11. Edit-button restore: when DeepSeek's "edit" is clicked it reads/takes
    //     over the message box content. If the box still holds the script's
    //     ds-markdown structure, the host app errors out. So the message box is
    //     restored to its original content before the event reaches the app
    //     (capture phase).
    //     The edit button is identified by its pencil icon: its SVG path starts
    //     with a fixed d value (from DeepSeek's current build; update if it changes).
    const EDIT_ICON_PATH_PREFIX = "M9.94076 1.34942";
    // Labels of the cancel button shown in DeepSeek's edit UI
    const CANCEL_BUTTON_LABELS = new Set(["取消", "Cancel"]);
    // After a restore, skip re-rendering for this long so the host app can enter
    // edit mode without the observer re-rendering the message in between
    const RESTORE_COOLDOWN_MS = 2000;

    function findMessageForButton(el) {
        // Walk up from the button to the nearest container that holds a user
        // message box (a div.ds-message inside ._9663006)
        let node = el;
        while (node && node !== document.body && node !== document.documentElement) {
            const msg = node.querySelector?.("div.ds-message");
            if (msg?.closest("._9663006")) {
                return msg;
            }
            node = node.parentElement;
        }
        return null;
    }

    function handleToggleClick(toggleBtn) {
        const msg = findMessageForButton(toggleBtn);
        const textEl = msg?.querySelector(USER_TEXT_SELECTOR);
        if (!textEl?.isConnected) {
            return;
        }
        const contentEl = resolveContentEl(textEl);
        // Only messages rendered by this script need the re-check; native
        // messages and flat messages have no collapsible container to fix up
        if (contentEl === textEl || contentEl.dataset.mdRendered == null) {
            return;
        }
        // Block the observer while the host commits its collapse/expand state
        contentEl.dataset.mdToggledAt = String(Date.now());
        setTimeout(() => {
            delete contentEl.dataset.mdToggledAt;
            try {
                renderUserMessage(textEl);
                liftStaleExpandedHeight(contentEl);
            } catch (err) {
                console.error("Toggle re-check failed", err);
            }
        }, TOGGLE_RECHECK_MS);
    }

    function restoreUserMessage(msgNode) {
        const textEl = msgNode.querySelector(USER_TEXT_SELECTOR);
        if (!textEl?.isConnected) {
            return;
        }
        const contentEl = resolveContentEl(textEl);
        // Only touch messages rendered by this script; leave native ones alone
        if (contentEl.dataset.mdRendered == null) {
            return;
        }

        if (contentEl !== textEl) {
            // Collapsible message: our Markdown lives in a sibling container.
            // Removing it unhides the host's own children (they were never
            // touched, so the host app takes over a fully native DOM and its
            // commits keep succeeding). Never write into the host's nodes.
            findMarkdownContainer(contentEl)?.remove();
            delete contentEl.dataset[MD_COLLAPSIBLE_ATTR];
            delete contentEl.dataset.mdRendered;
            delete contentEl.dataset.mdRenderedText;
            delete contentEl.dataset.mdTheme;
            delete contentEl.dataset.mdToggledAt;
            contentEl.dataset.mdRestoredAt = String(Date.now());
        } else {
            // Flat message: put the raw Markdown back so the host app reads
            // the original content, and drop the injected classes so the page
            // styles it natively again. A cooldown window blocks the observer
            // while the editor is set up.
            contentEl.textContent = contentEl.dataset.mdRendered;
            contentEl.classList.remove(...MARKDOWN_CONTAINER_CLASSES);
            contentEl.style.whiteSpace = "";
            delete contentEl.dataset.mdRenderedText;
            contentEl.dataset.mdRestoredAt = String(Date.now());
        }

        // After the cooldown, re-check the message once: if the edit was submitted
        // and the text changed, render the new content; if the editor is still
        // active, the input-control guard skips it
        setTimeout(() => {
            delete contentEl.dataset.mdRestoredAt;
            try {
                renderUserMessage(textEl);
            } catch (err) {
                console.error("Post-restore re-check failed", err);
            }
        }, RESTORE_COOLDOWN_MS + 50);
    }

    // After the edit is dismissed (cancel), put the message back into rendered
    // mode: clear the "processed" markers so the next scan renders it again.
    // The actual render is deferred so the host app can finish dismissing the
    // edit UI first; the observer also picks it up if DeepSeek mutates the node.
    function reRenderRestoredMessage(msgNode) {
        const textEl = msgNode.querySelector(USER_TEXT_SELECTOR);
        if (!textEl) {
            return;
        }
        const contentEl = resolveContentEl(textEl);
        setTimeout(() => {
            try {
                renderUserMessage(textEl);
            } catch (err) {
                console.error("Re-render after cancel failed", err);
            }
        }, 50);
        if (contentEl !== textEl) {
            // Collapsible message: the restore already removed our container
            // and markers; lifting the cooldown is enough — the host's own
            // commit puts the text back and the re-render rebuilds from it
            if (contentEl.dataset.mdRestoredAt == null) {
                return;
            }
            delete contentEl.dataset.mdRestoredAt;
            return;
        }
        // Only flat messages restored by this script can be re-rendered on
        // cancel; the raw Markdown is put back first so it re-parses
        if (contentEl.dataset.mdRendered == null) {
            return;
        }
        delete contentEl.dataset.mdRendered;
        delete contentEl.dataset.mdRenderedText;
        delete contentEl.dataset.mdRestoredAt;
    }

    // Both window and document listen in the capture phase, so every event
    // arrives twice; only the first pass may act (restore must not run twice
    // and schedule two cooldown timers)
    let lastHandledEvent = null;
    function handleEditUiEvent(e) {
        if (e === lastHandledEvent) {
            return;
        }
        lastHandledEvent = e;
        // Mouse/pointer events: primary button only; keyboard events: Enter/Space
        if (e.type !== "keydown" && e.button !== undefined && e.button !== 0) {
            return;
        }
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") {
            return;
        }
        const target = e.target;
        if (!target || typeof target.closest !== "function") {
            return;
        }

        // Assistant raw/rendered toggle: a pure view switch on our own button,
        // handled before the user-message logic (which requires _9663006)
        const rawToggle = target.closest(`[${RAW_BUTTON_ATTR}]`);
        if (rawToggle) {
            const assistantMsg = findMessageForActionRow(rawToggle);
            if (assistantMsg) {
                try {
                    toggleAssistantRawView(assistantMsg);
                } catch (err) {
                    console.error("Assistant raw toggle failed", err);
                }
            }
            return;
        }

        // Collapse/expand toggle of a collapsible long message: the host handles
        // the toggle itself; we only re-check the message once it has finished
        // (and lift its stale measured height when expanded — see below)
        const toggleBtn = target.closest(".ds-collapsible-text-toggle-button");
        if (toggleBtn) {
            handleToggleClick(toggleBtn);
            return;
        }

        const btn = target.closest('[role="button"], button, .ds-button');
        if (!btn) {
            return;
        }
        const msg = findMessageForButton(btn);
        if (!msg) {
            return;
        }

        // Edit (pencil) button: restore the message before the app reads it
        const path = btn.querySelector?.("svg path");
        const d = path?.getAttribute("d");
        if (d?.startsWith(EDIT_ICON_PATH_PREFIX)) {
            restoreUserMessage(msg);
            return;
        }

        // Cancel button (edit UI): re-render the message after dismissing
        const label = btn.querySelector?.(".ds-button__content");
        if (label && CANCEL_BUTTON_LABELS.has(label.textContent?.trim() || "")) {
            reRenderRestoredMessage(msg);
        }
    }

    // Capture-phase listeners on window/document run before DeepSeek's own
    // (bubble-phase) handlers. Only `click` restores the message: mutating the DOM
    // during pointerdown/mousedown can shift the layout and move the button away
    // from the cursor, so the browser never dispatches the click and the first
    // click appears dead. By `click` time the event is already dispatched.
    for (const scope of [window, document]) {
        scope.addEventListener("click", handleEditUiEvent, true);
        scope.addEventListener("keydown", handleEditUiEvent, true);
    }

    function processMessages() {
        // Select the user message text elements directly. Attachment cards and
        // other message UI are siblings of these elements and are never
        // touched, so they stay visible and native.
        const textEls = document.querySelectorAll(`._9663006 ${USER_TEXT_SELECTOR}`);
        textEls.forEach((textEl) => {
            try {
                renderUserMessage(textEl);
            } catch (err) {
                // A failure on one message must not affect the others
                console.error("Message rendering failed", err);
            }
        });

        // Keep the assistant raw/rendered toggles consistent with the host's
        // DOM (the buttons are injected lazily, so this never modifies native
        // messages that the user has not toggled)
        try {
            processAssistantMessages();
        } catch (err) {
            console.error("Assistant message scan failed", err);
        }
    }

    // Batch processing: DOM changes are frequent, so coalesce them into a single
    // microtask scan
    let pending = false;
    function scheduleProcess() {
        if (pending) {
            return;
        }
        pending = true;
        queueMicrotask(() => {
            pending = false;
            processMessages();
        });
    }

    // True when a mutation node is our injected raw toggle or contains it: such
    // mutations must be observed so a button the host re-rendered away is
    // re-injected and the raw view is kept consistent
    function touchesRawToggle(node) {
        if (node?.nodeType !== 1) {
            return false;
        }
        return Boolean(node.closest?.(`[${RAW_BUTTON_ATTR}]`) || node.querySelector?.(`[${RAW_BUTTON_ATTR}]`));
    }

    // True when the node lives in the same list item as a reply message: the
    // action row is a sibling of .ds-message in the current build, so the check
    // walks a few ancestors up looking for the message.
    function belongsToAssistantItem(node) {
        for (let cur = node, depth = 0; cur && depth < 3; depth++, cur = cur.parentElement) {
            if (cur.querySelector?.(".ds-message")) {
                return true;
            }
        }
        return false;
    }

    // True when a node is, or contains, an action button of an assistant
    // message. Watching for it is what makes the toggle appear on replies that
    // finish AFTER the script started, while assistant streaming text (which is
    // not an action button) never triggers a scan.
    function touchesAssistantActionBar(node) {
        if (node?.nodeType !== 1) {
            return false;
        }
        if (!node.matches?.('[role="button"]') && !node.querySelector?.('[role="button"]')) {
            return false;
        }
        return belongsToAssistantItem(node);
    }

    // Only relevant mutations should trigger a scan: anything inside a user
    // message group, new groups (appended outside any existing group), theme
    // changes (the body class), our own raw toggles, and assistant action bars.
    // AI-streaming churn outside those areas is ignored, so the observer never
    // scans the whole page per streamed token.
    function isRelevantMutation(records) {
        for (const record of records) {
            if (record.type === "characterData") {
                const parent = record.target.parentElement;
                if (parent?.closest("._9663006") || parent === document.body) {
                    return true;
                }
            } else if (record.type === "attributes") {
                const target = record.target;
                if (target === document.body || target.closest?.("._9663006")) {
                    return true;
                }
            } else if (record.type === "childList") {
                for (const node of [...record.addedNodes, ...record.removedNodes]) {
                    if (node.nodeType !== 1) {
                        if (node.parentElement?.closest("._9663006")) {
                            return true;
                        }
                        continue;
                    }
                    // closest() covers nodes inside a group and new groups
                    // themselves; querySelector() covers wholesale list
                    // re-renders whose root sits outside any group
                    if (
                        node.closest?.("._9663006") ||
                        node.querySelector?.("._9663006") ||
                        touchesRawToggle(node) ||
                        touchesAssistantActionBar(node)
                    ) {
                        return true;
                    }
                }
                if (
                    record.target.closest?.("._9663006") ||
                    touchesRawToggle(record.target) ||
                    touchesAssistantActionBar(record.target)
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    // Watch the message list for changes. characterData is observed because
    // React updates text nodes in place via nodeValue (a characterData
    // mutation) instead of replacing them; without it, in-place text edits
    // would never re-render. attributes is observed for the body class so a
    // theme switch re-renders the code blocks.
    if (document.body) {
        const observer = new MutationObserver((records) => {
            if (isRelevantMutation(records)) {
                scheduleProcess();
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class"],
        });

        processMessages();
    }
})();
