// ==UserScript==
// @name         DeepSeek User Message Markdown Renderer
// @name:zh-CN   DeepSeek 用户消息 Markdown 渲染器
// @namespace    http://tampermonkey.net/
// @version      1.0.4
// @description  Render your own messages on DeepSeek web with native-style Markdown, LaTeX math, and official code blocks; safe editing and history highlight included.
// @description:zh-CN  让 DeepSeek 网页版中你自己发送的消息以原生样式渲染 Markdown、LaTeX 公式和官方风格代码块;支持安全编辑与历史消息高亮。
// @author       NIyueeE
// @license      MIT
// @homepageURL  https://github.com/NIyueeE/deepseek-user-message-renderer
// @supportURL   https://github.com/NIyueeE/deepseek-user-message-renderer/issues
// @updateURL    https://raw.githubusercontent.com/NIyueeE/deepseek-user-message-renderer/main/src/deepseek-user-message-renderer.user.js
// @downloadURL  https://raw.githubusercontent.com/NIyueeE/deepseek-user-message-renderer/main/src/deepseek-user-message-renderer.user.js
// @match        https://chat.deepseek.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js
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
        // Renderer's own style: hide the original content (hide only, never remove,
        // so references held by the host app stay valid)
        // The bubble background lives in CSS (not inline) on purpose: DeepSeek's
        // history-item highlight sets style.background inline and clears it to ""
        // after 1.5s; with a stylesheet rule the blue bubble survives that cleanup
        GM_addStyle(
            "._9663006 div.ds-message.ds-md-rendered > :not(.ds-markdown) { display: none !important; }" +
                // No transition on background: Chromium fails to apply inline
                // var() backgrounds on elements whose stylesheet background is
                // also a var() once a transition is involved
                "._9663006 div.ds-message.ds-md-rendered { background: var(--dsw-specific-bubble, #edf3fe); }",
        );
    } catch (e) {
        console.warn("Failed to inject stylesheets", e);
    }

    // 2. Configure marked
    //    - html: legal HTML tags render as native HTML; illegal ones (unknown tags,
    //      comments, declarations, or tags with event handlers or dangerous
    //      protocols) are kept as plain text without losing line breaks
    //    - Line breaks follow standard Markdown: a single newline is a soft break
    //      (rendered as a space), blank lines separate paragraphs, and two trailing
    //      spaces or a backslash produce a hard break <br>; newlines inside text
    //      that is kept verbatim are not affected
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

    // Original inline styles (saved on first render) so the message box can be
    // restored when the edit button is clicked
    const originalInlineStyles = new WeakMap();

    if (typeof marked !== "undefined") {
        marked.use({
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

    function renderUserMessage(msgNode) {
        // Only handle user messages: status rows (e.g. "Stopped") and AI message
        // rows live outside the user message container _9663006
        if (!msgNode.closest("._9663006")) {
            return;
        }

        // Remember the original inline styles (first render only) so they can be
        // restored when the message is edited. This must happen before any of the
        // script's own styles are applied, otherwise the snapshot would capture
        // the script's bubble styles instead of DeepSeek's original ones.
        if (!originalInlineStyles.has(msgNode)) {
            originalInlineStyles.set(msgNode, msgNode.getAttribute("style"));
        }

        // Cleanup: an empty message box that still carries renderer markers is a
        // leftover of DeepSeek's edit UI (its content was moved into the editor).
        // Drop the injected styling so no empty bubble is displayed.
        if (msgNode.dataset.mdRendered != null && !msgNode.textContent?.trim()) {
            for (const child of Array.from(msgNode.children)) {
                if (child.classList.contains("ds-markdown")) {
                    child.remove();
                }
            }
            msgNode.classList.remove("ds-md-rendered");
            const originalStyle = originalInlineStyles.get(msgNode);
            if (originalStyle == null) {
                msgNode.removeAttribute("style");
            } else {
                msgNode.setAttribute("style", originalStyle);
            }
            originalInlineStyles.delete(msgNode);
            delete msgNode.dataset.mdRendered;
            delete msgNode.dataset.mdRestoredAt;
            return;
        }

        // Edit-mode guard: skip messages while the group hosts an editor
        // (textarea / contenteditable), so DeepSeek's edit placeholder nodes
        // are never rendered in the first place
        const group = msgNode.closest("._9663006");
        if (group?.querySelector("textarea, [contenteditable]")) {
            return;
        }

        // Edit-state guard: skip rendering while the message box contains an input
        // control (textarea / contenteditable) so DeepSeek's editor is not clobbered
        if (msgNode.querySelector("textarea, [contenteditable]")) {
            return;
        }

        // Right after an edit-button restore, give the host app a moment to set up
        // its editor without the observer racing in and re-rendering the message
        const restoredAt = Number(msgNode.dataset.mdRestoredAt) || 0;
        if (restoredAt && Date.now() - restoredAt < RESTORE_COOLDOWN_MS) {
            return;
        }

        // Use textContent, not innerText: innerText depends on the page's
        // white-space CSS and collapses newlines to spaces when the container
        // is not pre-wrap, which would flatten code fences and code lines
        const rawText = msgNode.textContent;
        if (!rawText?.trim()) {
            return;
        }

        // AI messages ship with native Markdown; skip them
        if (!msgNode.dataset.mdRendered && msgNode.querySelector(".ds-markdown")) {
            return;
        }

        // Skip if already rendered for the current text; re-render if the SPA
        // updated the text in place
        if (msgNode.dataset.mdRendered === rawText) {
            return;
        }

        // 3. Dynamic width and right-aligned bubble layout (background comes
        //    from the injected stylesheet, see the GM_addStyle call above)
        msgNode.style.borderRadius = "22px";
        msgNode.style.padding = "10px 16px";
        // Wrap short text to its content width
        msgNode.style.width = "fit-content";
        // Cap long text width
        msgNode.style.maxWidth = "calc(100% - 88px)";
        // Align to the right
        msgNode.style.marginLeft = "auto";
        msgNode.style.boxSizing = "border-box";
        msgNode.style.wordBreak = "break-word";

        // 4. Build the DOM container
        const markdownContainer = document.createElement("div");
        markdownContainer.className = "ds-markdown";
        markdownContainer.style.width = "fit-content";
        markdownContainer.style.maxWidth = "100%";

        // 5. Parse Markdown; fall back to plain text if marked is missing or fails,
        //    so the raw text is never injected as HTML and line breaks are kept
        if (typeof marked !== "undefined") {
            try {
                markdownContainer.innerHTML = marked.parse(rawText);
            } catch (err) {
                console.error("Markdown parsing failed", err);
                markdownContainer.textContent = rawText;
                markdownContainer.style.whiteSpace = "pre-wrap";
            }
        } else {
            markdownContainer.textContent = rawText;
            markdownContainer.style.whiteSpace = "pre-wrap";
        }

        // 6. Add the official style class to paragraph nodes
        markdownContainer.querySelectorAll("p").forEach((p) => {
            p.classList.add("ds-markdown-paragraph");
        });

        // 7. Render LaTeX math
        if (typeof renderMathInElement === "function") {
            try {
                renderMathInElement(markdownContainer, {
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

        // 8. Apply code syntax highlighting
        if (typeof hljs !== "undefined" && typeof hljs.highlightElement === "function") {
            try {
                markdownContainer.querySelectorAll("pre code").forEach((block) => {
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

        // 8.5 Rebuild code blocks into DeepSeek's native md-code-block structure
        //      so the page's built-in CSS renders them like native code blocks
        markdownContainer.querySelectorAll("pre code").forEach((codeEl) => {
            try {
                if (codeEl.parentElement) {
                    upgradeCodeBlock(codeEl.parentElement);
                }
            } catch (err) {
                console.error("Code block upgrade failed", err);
            }
        });

        // 9. Mount the render container:
        //     - Never delete or move DeepSeek's original child nodes. The host app
        //       (React) holds references to them; removing them makes re-renders
        //       (e.g. editing) call removeChild on detached nodes, which throws
        //       NotFoundError and crashes the page. They are only hidden via styles.
        //     - Remove the previous container when the text changes to avoid
        //       duplicate renders
        for (const child of Array.from(msgNode.children)) {
            if (child.classList.contains("ds-markdown")) {
                child.remove();
            }
        }
        msgNode.classList.add("ds-md-rendered");
        msgNode.appendChild(markdownContainer);

        // Bare text nodes cannot be hidden with CSS; shrink them with font-size: 0
        // and give the render container its own font size
        const hasBareText = Array.from(msgNode.childNodes).some(
            (node) => node.nodeType === 3 && node.textContent?.trim(),
        );
        if (hasBareText) {
            msgNode.style.fontSize = "0px";
            markdownContainer.style.fontSize = "1rem";
        } else if (msgNode.style.fontSize === "0px") {
            msgNode.style.fontSize = "";
            markdownContainer.style.fontSize = "";
        }

        // Mark only after a successful render (the snapshot is the rendered text,
        // which prevents a second render); failed renders can retry next time
        msgNode.dataset.mdRendered = msgNode.textContent;
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
        // Only touch messages rendered by this script; leave DeepSeek's native
        // Markdown messages as they are
        if (!msgNode.classList.contains("ds-md-rendered") || !msgNode.isConnected) {
            return;
        }

        // Remove the render container (DeepSeek's original child nodes were never
        // modified, so they simply become visible again)
        for (const child of Array.from(msgNode.children)) {
            if (child.classList.contains("ds-markdown")) {
                child.remove();
            }
        }
        msgNode.classList.remove("ds-md-rendered");

        // Restore inline styles: remove the injected bubble styles and the
        // font-size hiding trick
        const originalStyle = originalInlineStyles.get(msgNode);
        if (originalStyle == null) {
            msgNode.removeAttribute("style");
        } else {
            msgNode.setAttribute("style", originalStyle);
        }
        originalInlineStyles.delete(msgNode);

        // Mark the node as already processed for the current text so the
        // MutationObserver does not re-render it and break the edit flow;
        // it will re-render automatically once the edited text changes.
        // A cooldown window also blocks re-renders while the editor is being set up.
        msgNode.dataset.mdRendered = msgNode.textContent;
        msgNode.dataset.mdRestoredAt = String(Date.now());

        // After the cooldown, re-check the message once: if the edit was submitted
        // and the text changed, render the new content; if the editor is still
        // active, the input-control guard skips it
        setTimeout(() => {
            delete msgNode.dataset.mdRestoredAt;
            try {
                renderUserMessage(msgNode);
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
        if (msgNode.classList.contains("ds-md-rendered") || msgNode.dataset.mdRendered == null) {
            return;
        }
        delete msgNode.dataset.mdRendered;
        delete msgNode.dataset.mdRestoredAt;
        setTimeout(() => {
            try {
                renderUserMessage(msgNode);
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
        // Select only ds-message nodes inside user message containers, excluding
        // status rows and AI message rows from the start
        const messages = document.querySelectorAll("._9663006 div.ds-message");
        messages.forEach((msgNode) => {
            try {
                renderUserMessage(msgNode);
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

        // DeepSeek's history-item highlight paints the native (now hidden)
        // message bubble with an inline background and clears it after ~1.5s.
        // Mirror those style changes onto the rendered bubble so the flash
        // stays visible and disappears in sync with the host app.
        const highlightMirrorObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                const target = mutation.target;
                if (!(target instanceof HTMLElement)) {
                    continue;
                }
                const msg = target.closest?.("._9663006 div.ds-message.ds-md-rendered");
                if (!msg || target === msg) {
                    continue;
                }
                const background = target.style.background;
                if (background) {
                    // A new highlight: drop any leftover fade transition first,
                    // because an active transition would stop Chromium from
                    // applying the inline var() background
                    msg.style.transition = "";
                    msg.style.background = background;
                } else if (msg.style.background) {
                    // DeepSeek cleared the highlight after ~1.5s: fade the
                    // background back over .3s like the native bubble, then
                    // remove the transition so the next highlight applies
                    msg.style.transition = "background .3s";
                    msg.style.background = "";
                    setTimeout(() => {
                        msg.style.transition = "";
                    }, 350);
                }
            }
        });
        highlightMirrorObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ["style"],
            subtree: true,
        });

        processMessages();
    }
})();
