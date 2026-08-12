// ==UserScript==
// @name         DeepSeek User Message Markdown Renderer
// @name:zh-CN   DeepSeek 用户消息 Markdown 渲染器
// @namespace    http://tampermonkey.net/
// @version      1.0.6
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
    const DANGEROUS_HTML_RE = /\son\w+\s*=|(?:javascript|vbscript|data):|\bsrcdoc\s*=/i;
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

    function isKnownElement(tagName) {
        try {
            return !(document.createElement(tagName) instanceof HTMLUnknownElement);
        } catch {
            return false;
        }
    }

    // Single tag (open/close): render as HTML only if the element name is legal,
    // attributes carry no event handlers, and no dangerous protocol is used
    function isLegalHtmlTag(text) {
        const match = HTML_TAG_RE.exec(text.trim());
        if (!match || !isKnownElement(match[1])) {
            return false;
        }
        return !DANGEROUS_HTML_RE.test(text);
    }

    // Block-level HTML (marked merges things like <div>...</div> into one token):
    // render only when the opening tag is legal, the closing tag matches, and the
    // whole block contains nothing dangerous
    function isLegalHtmlBlock(text) {
        const trimmed = text.trim();
        const open = /^<([a-zA-Z][a-zA-Z0-9-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^\s"'>])+)*\s*\/?>/.exec(trimmed);
        if (!open || !isKnownElement(open[1]) || DANGEROUS_HTML_RE.test(text)) {
            return false;
        }
        if (VOID_TAGS.has(open[1])) {
            return open[0] === trimmed;
        }
        return new RegExp(`</${open[1]}>\\s*$`).test(trimmed);
    }

    // Names of opening tags judged illegal and escaped; their matching closing
    // tags are also escaped so the original text is preserved completely
    const blockedTags = new Set();

    if (typeof marked !== "undefined") {
        marked.use({
            breaks: true,
            renderer: {
                html(token) {
                    const text = typeof token === "string" ? token : token.text || "";
                    const trimmed = text.trim();

                    // Handle closing tags first (e.g. </a>) to avoid misreading
                    // them as block-level HTML
                    const close = /^<\/\s*([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(trimmed);
                    if (close) {
                        if (blockedTags.delete(close[1])) {
                            return escapeHtml(text, /\n/.test(text));
                        }
                        if (isLegalHtmlTag(text)) {
                            return text;
                        }
                        return escapeHtml(text, /\n/.test(text));
                    }

                    // Block-level HTML (marked merges things like <div>...</div>
                    // into a single token)
                    if (/\n/.test(text) || /<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/.test(text)) {
                        return isLegalHtmlBlock(text) ? text : escapeHtml(text, true);
                    }

                    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(trimmed);
                    if (open && !/^<[!?]/.test(trimmed)) {
                        if (isLegalHtmlTag(text)) {
                            blockedTags.delete(open[1]);
                            return text;
                        }
                        blockedTags.add(open[1]);
                        return escapeHtml(text, false);
                    }

                    return escapeHtml(text, false);
                },
            },
        });
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
    // Blank lines inside code fences are left untouched, and a blank line is
    // preserved before fence openers: standard Markdown formatting, and a
    // guard against setext misparsing (marked <=12 treated a fence directly
    // after a paragraph as a heading when its content started with ---;
    // see test/marked-quirk.test.ts).
    function collapseBlankLinesOutsideFences(text) {
        const fence = /(`{3,}|~{3,})[\s\S]*?\1/g;
        let result = "";
        let last = 0;
        for (let match = fence.exec(text); match !== null; match = fence.exec(text)) {
            result += collapseBlankRuns(text.slice(last, match.index), true);
            result += match[0];
            last = fence.lastIndex;
        }
        result += collapseBlankRuns(text.slice(last), false);
        return result;
    }

    function collapseBlankRuns(text, beforeFence) {
        let collapsed = text
            // A newline right next to an explicit <br> would add a second
            // <br> through GFM soft breaks (breaks: true), so drop it
            .replace(/\n[ \t]*(?=<br\b)/gi, "")
            .replace(/(?<=<br\b[^>]*>)[ \t]*\n/gi, "")
            // Keep a blank line before setext underlines (---, ===) and
            // footnote definitions ([^1]: ...) so they stay separate blocks
            // instead of collapsing into the previous paragraph
            .replace(/\n{2,}/g, (run, offset, whole) => {
                const after = whole.slice(offset + run.length);
                if (/^[ \t]*(?:(?:-{3,}|={3,})[ \t]*(?:\n|$)|\[\^[^\]]+\]:)/.test(after)) {
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

        // Right after an edit-button restore, give the host app a moment to set up
        // its editor without the observer racing in and re-rendering the message
        const restoredAt = Number(textEl.dataset.mdRestoredAt) || 0;
        if (restoredAt && Date.now() - restoredAt < RESTORE_COOLDOWN_MS) {
            return;
        }

        // Use textContent, not innerText: innerText depends on the page's
        // white-space CSS and collapses newlines to spaces when the container
        // is not pre-wrap, which would flatten code fences and code lines
        const rawText = textEl.textContent;
        if (!rawText?.trim()) {
            // An emptied message box (DeepSeek's edit UI moved the content into
            // the editor) should go back to a clean native state
            if (textEl.classList.contains("ds-markdown")) {
                textEl.classList.remove(...MARKDOWN_CONTAINER_CLASSES);
                textEl.style.whiteSpace = "";
                delete textEl.dataset.mdRendered;
                delete textEl.dataset.mdRenderedText;
            }
            return;
        }

        // Skip if already rendered for the current text; re-render if the SPA
        // updated the text in place. mdRenderedText is the text of the last
        // render output, so it only matches content this script produced.
        if (textEl.dataset.mdRenderedText === rawText) {
            return;
        }

        // 3. Parse Markdown and render it in place: the original text element
        //    becomes the Markdown container. No original node is hidden or
        //    removed and no extra bubble is created, so attachments and the
        //    native bubble layout are never touched.
        let parsed = null;
        if (typeof marked !== "undefined") {
            try {
                parsed = marked.parse(collapseBlankLinesOutsideFences(rawText));
            } catch (err) {
                console.error("Markdown parsing failed", err);
            }
            // marked always appends a trailing newline; the bubble's
            // white-space: pre-wrap would render it as an extra empty line
            // below the content, so strip trailing whitespace outside tags
            parsed = parsed.replace(/\s+$/, "");
        }
        if (parsed == null) {
            // Fallback: keep the raw text visible, preserving line breaks
            textEl.textContent = rawText.replace(/\s+$/, "");
            textEl.style.whiteSpace = "pre-wrap";
        } else {
            textEl.innerHTML = parsed;
            removeWhitespaceOnlyTextNodes(textEl);
            textEl.style.whiteSpace = "";
        }
        textEl.classList.add(...MARKDOWN_CONTAINER_CLASSES);

        // 4. Add the official style class to paragraph nodes and wrap text
        //    segments in <span class=""> like DeepSeek's native renderer
        //    (must run before KaTeX so math output is untouched)
        textEl.querySelectorAll("p").forEach((p) => {
            p.classList.add("ds-markdown-paragraph");
            wrapTextSegments(p);
        });

        // 5. Render LaTeX math
        if (typeof renderMathInElement === "function") {
            try {
                renderMathInElement(textEl, {
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

        // 6. Apply code syntax highlighting
        if (typeof hljs !== "undefined" && typeof hljs.highlightElement === "function") {
            try {
                textEl.querySelectorAll("pre code").forEach((block) => {
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

        // 7. Rebuild code blocks into DeepSeek's native md-code-block structure
        //    so the page's built-in CSS renders them like native code blocks
        textEl.querySelectorAll("pre code").forEach((codeEl) => {
            try {
                if (codeEl.parentElement) {
                    upgradeCodeBlock(codeEl.parentElement);
                }
            } catch (err) {
                console.error("Code block upgrade failed", err);
            }
        });

        // 8. Mark only after a successful render: mdRendered stores the raw
        //    Markdown (restored on edit click), mdRenderedText stores the text
        //    of the render output, which is what the next scan reads, so the
        //    dedup check above stops the observer from re-rendering in a loop.
        //    Failed renders can retry next time.
        textEl.dataset.mdRendered = rawText;
        textEl.dataset.mdRenderedText = textEl.textContent;
    }

    // 10. Edit-button restore: when DeepSeek's "edit" is clicked it reads/takes
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

    function restoreUserMessage(msgNode) {
        const textEl = msgNode.querySelector(USER_TEXT_SELECTOR);
        // Only touch messages rendered by this script; leave native ones alone
        if (!textEl?.isConnected || textEl.dataset.mdRendered == null) {
            return;
        }

        // Put the raw Markdown back so the host app reads the original content,
        // and drop the injected classes so the page styles it natively again.
        // A cooldown window blocks the observer while the editor is set up.
        textEl.textContent = textEl.dataset.mdRendered;
        textEl.classList.remove(...MARKDOWN_CONTAINER_CLASSES);
        textEl.style.whiteSpace = "";
        delete textEl.dataset.mdRenderedText;
        textEl.dataset.mdRestoredAt = String(Date.now());

        // After the cooldown, re-check the message once: if the edit was submitted
        // and the text changed, render the new content; if the editor is still
        // active, the input-control guard skips it
        setTimeout(() => {
            delete textEl.dataset.mdRestoredAt;
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
        // Only messages restored by this script can be re-rendered on cancel
        if (!textEl || textEl.dataset.mdRendered == null) {
            return;
        }
        delete textEl.dataset.mdRendered;
        delete textEl.dataset.mdRenderedText;
        delete textEl.dataset.mdRestoredAt;
        setTimeout(() => {
            try {
                renderUserMessage(textEl);
            } catch (err) {
                console.error("Re-render after cancel failed", err);
            }
        }, 50);
    }

    function handleEditUiEvent(e) {
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

    // Watch the message list for changes
    if (document.body) {
        const observer = new MutationObserver(scheduleProcess);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        processMessages();
    }
})();
