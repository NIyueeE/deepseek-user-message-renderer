import { type Document, type HTMLElement, Window } from "happy-dom";
import { marked } from "marked";

export interface UserscriptEnv {
    window: Window;
    document: Document;
    gmAddStyleCalls: string[];
    gmResourceTextCalls: string[];
    highlightCalls: HTMLElement[];
    mathCalls: HTMLElement[];
}

export interface MessageFixture {
    group: HTMLElement;
    message: HTMLElement;
    content: HTMLElement;
    editButton: HTMLElement;
    copyButton: HTMLElement;
    cancelButton: HTMLElement;
}

/**
 * Set up a simulated browser + Tampermonkey environment and expose the globals
 * the userscript depends on via globalThis. Must be called before loading the
 * userscript.
 */
export function setupTampermonkeyEnv(): UserscriptEnv {
    const window = new Window({ url: "https://chat.deepseek.com/" });
    const g = globalThis as unknown as Record<string, unknown>;

    // Browser globals
    g.window = window;
    g.document = window.document;
    g.MutationObserver = window.MutationObserver;
    g.HTMLUnknownElement = window.HTMLUnknownElement;
    g.HTMLElement = window.HTMLElement;
    g.getComputedStyle = window.getComputedStyle.bind(window);

    // Tampermonkey API stubs
    const gmAddStyleCalls: string[] = [];
    const gmResourceTextCalls: string[] = [];
    g.GM_addStyle = (css: string) => {
        gmAddStyleCalls.push(css);
    };
    g.GM_getResourceText = (name: string) => {
        gmResourceTextCalls.push(name);
        return `/* ${name} */`;
    };

    // The userscript loads the same marked version from a CDN (jsdelivr UMD
    // build) via @require in production
    g.marked = marked;

    // KaTeX / highlight.js stubs that record calls for assertions
    const highlightCalls: HTMLElement[] = [];
    g.hljs = {
        highlightElement: (el: HTMLElement) => {
            highlightCalls.push(el);
        },
        // Mirrors highlight.js: languages like "text" or "mermaid" are unknown
        getLanguage: (name: string) => (["python", "javascript", "js", "bash"].includes(name) ? {} : undefined),
    };
    const mathCalls: HTMLElement[] = [];
    g.renderMathInElement = (el: HTMLElement) => {
        mathCalls.push(el);
    };

    return {
        window,
        document: window.document,
        gmAddStyleCalls,
        gmResourceTextCalls,
        highlightCalls,
        mathCalls,
    };
}

/**
 * Append a user message inside a _9663006 container and return the message
 * node. The message holds a text element with the hashed classes DeepSeek
 * currently uses (fbb737a4), which the userscript renders in place. The
 * companion class _8271fc3 only marks messages with an attachment.
 */
export function appendUserMessage(document: Document, text: string): HTMLElement {
    const group = document.createElement("div");
    group.className = "_9663006";

    const message = document.createElement("div");
    message.className = "ds-message";
    const textEl = document.createElement("div");
    textEl.className = "fbb737a4";
    textEl.appendChild(document.createTextNode(text));
    message.appendChild(textEl);

    group.appendChild(message);
    document.body.appendChild(group);
    return message;
}

/** Mirror DeepSeek's real structure: the message text lives in its own element */
export function appendWrappedUserMessage(
    document: Document,
    text: string,
): { message: HTMLElement; content: HTMLElement } {
    const group = document.createElement("div");
    group.className = "_9663006";

    const message = document.createElement("div");
    message.className = "ds-message";
    const content = document.createElement("div");
    content.className = "fbb737a4";
    content.appendChild(document.createTextNode(text));
    message.appendChild(content);

    group.appendChild(message);
    document.body.appendChild(group);
    return { message, content };
}

/** Build a message group with action buttons (edit/copy) and return node references */
export function appendMessageWithActions(document: Document, text: string): MessageFixture {
    const group = document.createElement("div");
    group.className = "_9663006";

    const message = document.createElement("div");
    message.className = "ds-message";
    const content = document.createElement("div");
    content.className = "fbb737a4";
    content.appendChild(document.createTextNode(text));
    message.appendChild(content);
    group.appendChild(message);

    const actions = document.createElement("div");
    actions.className = "message-actions";

    // Pencil (edit) icon path prefix matching DeepSeek's current build
    const editButton = document.createElement("div");
    editButton.setAttribute("role", "button");
    editButton.className = "ds-button";
    editButton.innerHTML =
        '<svg><path d="M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942"></path></svg>';

    const copyButton = document.createElement("div");
    copyButton.setAttribute("role", "button");
    copyButton.className = "ds-button";
    copyButton.innerHTML = '<svg><path d="M0 0 copy icon"></path></svg>';

    // Cancel button shown in the edit UI
    const cancelButton = document.createElement("div");
    cancelButton.setAttribute("role", "button");
    cancelButton.className = "ds-button ds-button--outlinedNeutral";
    cancelButton.innerHTML = '<span class="ds-button__content">取消</span>';

    actions.append(editButton, copyButton, cancelButton);
    group.appendChild(actions);
    document.body.appendChild(group);

    return { group, message, content, editButton, copyButton, cancelButton };
}

let loadUserscriptCalls = 0;

/**
 * Load the userscript (call setupTampermonkeyEnv and build the DOM first).
 *
 * Each call imports the userscript with a unique query string. Without this,
 * `bun test` (no --parallel) shares one module cache across all test files, so
 * the userscript would be evaluated only once, against the first file's
 * globals, and every other file would silently test an environment the script
 * never ran in. A fresh evaluation per call makes each file self-contained.
 */
export async function loadUserscript(): Promise<void> {
    loadUserscriptCalls += 1;
    await import(`../src/deepseek-user-message-renderer.user.js?test-run=${loadUserscriptCalls}`);
}

/** Flush microtasks and a few macrotasks so MutationObserver callbacks can run */
export async function settle(ms = 0): Promise<void> {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, ms));
    await Promise.resolve();
}
