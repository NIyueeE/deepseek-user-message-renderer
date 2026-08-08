// ==UserScript==
// @name         DeepSeek User Message Markdown Renderer
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Render user messages on DeepSeek web with native-style Markdown, math, and code highlighting; automatically restore the original content when the message is edited.
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
        GM_addStyle("._9663006 div.ds-message.ds-md-rendered > :not(.ds-markdown) { display: none !important; }");
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

    function renderUserMessage(msgNode) {
        // Only handle user messages: status rows (e.g. "Stopped") and AI message
        // rows live outside the user message container _9663006
        if (!msgNode.closest("._9663006")) {
            return;
        }

        // Edit-state guard: skip rendering while the message box contains an input
        // control (textarea / contenteditable) so DeepSeek's editor is not clobbered
        if (msgNode.querySelector('textarea, [contenteditable="true"]')) {
            return;
        }

        const rawText = msgNode.innerText;
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

        // 3. Dynamic width and right-aligned bubble layout
        msgNode.style.background = "var(--dsw-specific-bubble, #edf3fe)";
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
                    hljs.highlightElement(block);
                });
            } catch (err) {
                console.error("Highlight.js rendering failed", err);
            }
        }

        // 9. Remember the original inline styles (first render only) so they can
        //    be restored when the message is edited
        if (!originalInlineStyles.has(msgNode)) {
            originalInlineStyles.set(msgNode, msgNode.getAttribute("style"));
        }

        // 10. Mount the render container:
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
        msgNode.dataset.mdRendered = msgNode.innerText;
    }

    // 11. Edit-button restore: when DeepSeek's "edit" is clicked it reads/takes
    //     over the message box content. If the box still holds the script's
    //     ds-markdown structure, the host app errors out. So the message box is
    //     restored to its original content before the event reaches the app
    //     (capture phase).
    //     The edit button is identified by its pencil icon: its SVG path starts
    //     with a fixed d value (from DeepSeek's current build; update if it changes).
    const EDIT_ICON_PATH_PREFIX = "M9.94076 1.34942";

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
        // it will re-render automatically once the edited text changes
        msgNode.dataset.mdRendered = msgNode.innerText;
    }

    function handleEditButtonEvent(e) {
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
        const path = btn.querySelector?.("svg path");
        if (!path) {
            return;
        }
        const d = path.getAttribute("d");
        if (!d?.startsWith(EDIT_ICON_PATH_PREFIX)) {
            return;
        }
        const msg = findMessageForButton(btn);
        if (msg) {
            restoreUserMessage(msg);
        }
    }

    // Capture-phase listeners on window/document run before DeepSeek's own
    // (bubble-phase) handlers; covers pointerdown/mousedown/click and keyboard
    for (const scope of [window, document]) {
        scope.addEventListener("pointerdown", handleEditButtonEvent, true);
        scope.addEventListener("mousedown", handleEditButtonEvent, true);
        scope.addEventListener("click", handleEditButtonEvent, true);
        scope.addEventListener("keydown", handleEditButtonEvent, true);
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

        processMessages();
    }
})();
