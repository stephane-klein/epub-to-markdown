import { posix } from "node:path";
import TurndownService from "turndown";

const NOTE_CONTAINER = /(note|ntb|ntf)/i;
const DEFINITION_TERMS = /^(DT|LI|TH|TD)$/;
const LABEL_CLEANUP = /(<p\b[^>]*>)\s*\.\s*/i;

const resolveReference = (document, href) => {
    if (!href) return null;
    const index = href.indexOf("#");
    if (index < 0) return null;
    const anchor = href.slice(index + 1);
    if (!anchor) return null;
    const file = href.slice(0, index);
    const target = file ? posix.normalize(posix.join(posix.dirname(document), decodeURIComponent(file))) : document;
    return { document: target, anchor };
};

const targetKey = (document, anchor) => `${document}#${anchor}`;

const linkOf = (element) => {
    if (element.href) return { href: element.href, node: element.node };
    let sibling = element.node.nextSibling;
    while (sibling) {
        if (sibling.nodeName === "A" && sibling.getAttribute("href")) {
            return { href: sibling.getAttribute("href"), node: sibling };
        }
        sibling = sibling.nextSibling;
    }
    return null;
};

const captureDocument = (document, html) => {
    const service = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
    });
    service.remove(["script", "style"]);

    const elements = [];
    service.addRule("captureIdentifiers", {
        filter: (node) => typeof node.getAttribute === "function" && Boolean(node.getAttribute("id")),
        replacement: (content, node) => {
            elements.push({
                id: node.getAttribute("id"),
                href: node.getAttribute("href"),
                node,
                document,
            });
            return content;
        },
    });

    service.turndown(html);
    return elements;
};

const escapeText = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const plainText = (html) =>
    html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const elementClass = (node) => (node.getAttribute ? node.getAttribute("class") : null) ?? "";

const backLinkMatches = (element, reference) => {
    const candidates = [];
    if (element.href) candidates.push(element.href);
    if (element.node.querySelectorAll) {
        for (const anchor of element.node.querySelectorAll("a[href]")) {
            candidates.push(anchor.getAttribute("href"));
        }
    }
    let sibling = element.node.nextSibling;
    while (sibling) {
        if (sibling.nodeName === "A" && sibling.getAttribute("href")) {
            candidates.push(sibling.getAttribute("href"));
        }
        sibling = sibling.nextSibling;
    }
    return candidates.some((href) => {
        const resolved = resolveReference(element.document, href);
        return resolved && targetKey(resolved.document, resolved.anchor) === reference;
    });
};

const followingSiblings = (node) => {
    const parts = [];
    let sibling = node.nextSibling;
    while (sibling) {
        if (sibling.nodeType === 1) parts.push(sibling.outerHTML);
        else if (sibling.nodeType === 3 && sibling.textContent.trim()) parts.push(escapeText(sibling.textContent));
        sibling = sibling.nextSibling;
    }
    return parts.join("");
};

const backLinkOf = (node) => {
    if (node.getAttribute("href")) return node;
    let sibling = node.nextSibling;
    while (sibling) {
        if (sibling.nodeName === "A" && sibling.getAttribute("href")) return sibling;
        sibling = sibling.nextSibling;
    }
    return null;
};

const noteContainer = (block) => {
    const parent = block?.parentNode;
    if (parent && parent.nodeType === 1 && NOTE_CONTAINER.test(elementClass(parent))) return parent;
    return null;
};

const blockOf = (node) => {
    const parent = node.parentNode;
    return parent && parent.nodeType === 1 ? parent : node;
};

const anchorDefinition = (element) => {
    const backLink = backLinkOf(element.node);
    let html = backLink ? followingSiblings(backLink) : "";
    if (plainText(html) === "" && !/<img\b/i.test(html)) {
        const parent = element.node.parentNode;
        const next = parent?.nextElementSibling;
        if (next && DEFINITION_TERMS.test(parent.nodeName)) html = next.outerHTML;
    }
    const block = blockOf(element.node);
    const container = noteContainer(block);
    return { html, removal: container ?? block };
};

const containerDefinition = (element) => {
    const outer = element.node.outerHTML;
    const backLink = element.node.querySelector ? element.node.querySelector("a[href]") : null;
    let html = outer;
    if (backLink) {
        html = outer.replace(backLink.outerHTML, "").replace(LABEL_CLEANUP, "$1");
    }
    return { html, removal: element.node };
};

const removalInfo = (document, node) => {
    const classes = elementClass(node) || null;
    return { document, id: node.getAttribute("id") ?? null, class: classes };
};

export const collectFootnotes = ({ documents }) => {
    const elements = [];
    for (const { href, html } of documents) {
        elements.push(...captureDocument(href, html));
    }
    for (const [order, element] of elements.entries()) {
        element.order = order;
    }

    const targets = new Map();
    for (const element of elements) {
        const key = targetKey(element.document, element.id);
        if (!targets.has(key)) targets.set(key, element);
    }

    const references = new Map();
    const removals = [];
    for (const element of elements) {
        if (element.node.nodeName !== "A" || !element.id) continue;
        const link = linkOf(element);
        if (!link) continue;
        const resolved = resolveReference(element.document, link.href);
        if (!resolved) continue;
        const target = targets.get(targetKey(resolved.document, resolved.anchor));
        if (!target) continue;
        if (!(element.order < target.order)) continue;
        if (!backLinkMatches(target, targetKey(element.document, element.id))) continue;

        const isContainer = target.node.nodeName !== "A";
        const { html, removal } = isContainer ? containerDefinition(target) : anchorDefinition(target);
        if (plainText(html) === "" && !/<img\b/i.test(html)) continue;

        const label = plainText(link.node.textContent).replace(/[[\]]/g, "").trim() || element.id;
        references.set(link.href, { label, definitionHtml: html });
        if (removal) removals.push(removalInfo(target.document, removal));
    }

    return { references, removals };
};

export const createFootnoteTracker = (references) => {
    const assigned = new Map();
    const taken = new Set();
    const used = [];

    const keyOf = (node) => (node.getAttribute ? node.getAttribute("href") : null);

    return {
        has: (node) => references.has(keyOf(node)),
        resolve: (node) => {
            const key = keyOf(node);
            const reference = references.get(key);
            if (!reference) return null;
            if (!assigned.has(key)) {
                const base = String(reference.label);
                let label = base;
                let suffix = 2;
                while (taken.has(label)) label = `${base}-${suffix++}`;
                taken.add(label);
                assigned.set(key, label);
                used.push({ label, definitionHtml: reference.definitionHtml });
            }
            return assigned.get(key);
        },
        used,
    };
};
