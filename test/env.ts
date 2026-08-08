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

    // The userscript loads the same marked version from a CDN via @require in
    // production
    g.marked = marked;

    // KaTeX / highlight.js stubs that record calls for assertions
    const highlightCalls: HTMLElement[] = [];
    g.hljs = {
        highlightElement: (el: HTMLElement) => {
            highlightCalls.push(el);
        },
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

/** Append a plain-text user message inside a _9663006 container and return the message node */
export function appendUserMessage(document: Document, text: string): HTMLElement {
    const group = document.createElement("div");
    group.className = "_9663006";

    const message = document.createElement("div");
    message.className = "ds-message";
    message.appendChild(document.createTextNode(text));

    group.appendChild(message);
    document.body.appendChild(group);
    return message;
}

/** Mirror DeepSeek's real structure: message content wrapped in a child element */
export function appendWrappedUserMessage(
    document: Document,
    text: string,
): { message: HTMLElement; content: HTMLElement } {
    const group = document.createElement("div");
    group.className = "_9663006";

    const message = document.createElement("div");
    message.className = "ds-message";
    const content = document.createElement("div");
    content.className = "ds-message-content";
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
    content.className = "ds-message-content";
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

    actions.append(editButton, copyButton);
    group.appendChild(actions);
    document.body.appendChild(group);

    return { group, message, content, editButton, copyButton };
}

/** Load the userscript (call setupTampermonkeyEnv and build the DOM first) */
export async function loadUserscript(): Promise<void> {
    await import("../src/deepseek-user-message-renderer.user.js");
}

/** Flush microtasks and a few macrotasks so MutationObserver callbacks can run */
export async function settle(): Promise<void> {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
}
