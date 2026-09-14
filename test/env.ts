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
    /** ds-collapsible-text container when the collapsible variant is requested */
    collapsible: HTMLElement | null;
    /** ds-collapsible-text-toggle-button sibling when the collapsible variant is requested */
    toggle: HTMLElement | null;
}

/**
 * Build the message text element in DeepSeek's newer collapsible structure:
 * fbb737a4 > div.ds-collapsible-text (long messages are clipped with an inline
 * max-height and their measured height set inline) plus a sibling
 * div.ds-collapsible-text-toggle-button that expands/collapses it.
 */
function buildCollapsibleContent(
    document: Document,
    text: string,
): {
    content: HTMLElement;
    collapsible: HTMLElement;
    toggle: HTMLElement;
} {
    const content = document.createElement("div");
    content.className = "fbb737a4";

    const collapsible = document.createElement("div");
    collapsible.className = "ds-collapsible-text";
    collapsible.setAttribute("style", "max-height: 192px; height: 432px; transition: none;");
    const inner = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = text;
    inner.appendChild(span);
    collapsible.appendChild(inner);
    content.appendChild(collapsible);

    const toggle = document.createElement("div");
    toggle.className = "ds-collapsible-text-toggle-button _5b3c8cd";
    toggle.innerHTML =
        '<div class="d077096d"></div><div class="_08f18f6"><div class="ds-icon d630ec62"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.15137 8.5L2.57617 8.07617"></path></svg></div></div>';
    content.appendChild(toggle);

    return { content, collapsible, toggle };
}

/**
 * Append a user message in the newer collapsible structure and return the
 * message, text element, collapsible container, and toggle button.
 */
export function appendCollapsibleUserMessage(
    document: Document,
    text: string,
): {
    message: HTMLElement;
    content: HTMLElement;
    collapsible: HTMLElement;
    toggle: HTMLElement;
} {
    const group = document.createElement("div");
    group.className = "_9663006";
    const message = document.createElement("div");
    message.className = "ds-message";
    const { content, collapsible, toggle } = buildCollapsibleContent(document, text);
    message.appendChild(content);
    group.appendChild(message);
    document.body.appendChild(group);
    return { message, content, collapsible, toggle };
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
export function appendMessageWithActions(
    document: Document,
    text: string,
    options?: { collapsible?: boolean },
): MessageFixture {
    const group = document.createElement("div");
    group.className = "_9663006";

    const message = document.createElement("div");
    message.className = "ds-message";
    let content: HTMLElement;
    let collapsible: HTMLElement | null = null;
    let toggle: HTMLElement | null = null;
    if (options?.collapsible) {
        ({ content, collapsible, toggle } = buildCollapsibleContent(document, text));
    } else {
        content = document.createElement("div");
        content.className = "fbb737a4";
        content.appendChild(document.createTextNode(text));
    }
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

    return { group, message, content, editButton, copyButton, cancelButton, collapsible, toggle };
}

export interface AssistantFixture {
    group: HTMLElement;
    message: HTMLElement;
    /** The rendered Markdown column (carries the React fiber in real builds) */
    markdown: HTMLElement;
    /** The copy/reply action row our toggle button is injected into */
    actionRow: HTMLElement;
    copyButton: HTMLElement;
    /** The raw Markdown the fake React fiber exposes */
    raw: string;
}

/**
 * Append a DeepSeek assistant message with the action bar the raw/rendered
 * toggle is injected into. The rendered Markdown column carries a fake React
 * fiber (`__reactFiber$...`) whose memoizedProps hold the original source, which
 * is how the userscript reads the raw Markdown in production.
 *
 * Set `withFiber: false` to simulate a host build whose source cannot be read
 * (e.g. a different React version, or a hand-written/bot message).
 */
export function appendAssistantMessage(
    document: Document,
    raw: string,
    options?: { rendered?: string; withFiber?: boolean },
): AssistantFixture {
    const group = document.createElement("div");
    // Mirror the real assistant list item (_4f9bf79._43c05b5): the reply and its
    // action row are SIBLINGS, not nested. Deliberately NOT the user-message
    // group class (_9663006), which the toggle must stay excluded from.
    group.className = "_4f9bf79 _43c05b5";

    const message = document.createElement("div");
    message.className = "ds-message";

    const markdown = document.createElement("div");
    markdown.className = "ds-assistant-message-main-content ds-markdown";
    markdown.innerHTML = options?.rendered ?? `<p>${raw.replace(/\*\*/g, "")}</p>`;
    message.appendChild(markdown);
    group.appendChild(message);

    // The action row is a SIBLING of the reply message in the current build:
    // list item > [div.ds-message, div.ds-flex._0a3d93b]
    const actionRow = document.createElement("div");
    actionRow.className = "ds-flex _0a3d93b";
    actionRow.setAttribute("style", "align-items: center; gap: 10px; flex-wrap: wrap-reverse;");
    const innerRow = document.createElement("div");
    innerRow.className = "ds-flex _965abe9 _54866f7";
    const copyButton = document.createElement("div");
    copyButton.setAttribute("role", "button");
    copyButton.setAttribute("tabindex", "0");
    copyButton.className =
        "ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs db183363";
    copyButton.innerHTML = '<div class="ds-button__icon ds-button__icon--last-child"></div>';
    innerRow.appendChild(copyButton);
    actionRow.appendChild(innerRow);
    group.appendChild(actionRow);
    document.body.appendChild(group);

    if (options?.withFiber !== false) {
        // React assigns the fiber as a plain (enumerable) property on the node
        // The reply's source prop is `markdown` (the thinking chain uses
        // `content`), matching the live build
        const fiber = { memoizedProps: { markdown: raw }, return: null };
        Object.defineProperty(markdown, "__reactFiber$test", {
            value: fiber,
            enumerable: true,
            configurable: true,
        });
    }

    return { group, message, markdown, actionRow, copyButton, raw };
}

/**
 * Append an assistant message that carries a reasoning chain in front of the
 * reply. The thinking block also renders a `div.ds-markdown` (verified against
 * the live DOM), and its React prop is `content` — the toggle must pick the
 * reply column and the `markdown` prop, never the reasoning.
 */
export function appendAssistantMessageWithThinking(
    document: Document,
    thinking: string,
    answer: string,
    options?: { rendered?: string },
): AssistantFixture {
    const fixture = appendAssistantMessage(document, answer, options);
    const { markdown } = fixture;

    const thinkingWrap = document.createElement("div");
    thinkingWrap.className = "ds-think-content";
    const thinkingMd = document.createElement("div");
    thinkingMd.className = "ds-markdown";
    thinkingMd.innerHTML = "<p>已经思考过了</p>";
    thinkingWrap.appendChild(thinkingMd);
    markdown.parentElement?.insertBefore(thinkingWrap, markdown);

    // The thinking block's own fiber exposes `content` (the chain), which must
    // never be chosen for the reply
    Object.defineProperty(thinkingMd, "__reactFiber$think", {
        value: { memoizedProps: { content: thinking }, return: null },
        enumerable: true,
        configurable: true,
    });
    return fixture;
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
