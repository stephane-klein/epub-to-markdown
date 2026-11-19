import { parse, stringify } from "yaml";
import { headingHref } from "./headings.js";

const SYSTEM = [
    "You repair the table of contents (TOC) of an EPUB book so it can drive a clean Markdown split.",
    "",
    "You receive:",
    "- the book metadata;",
    "- the current TOC parsed from the EPUB navigation document, as a nested list of entries with an `id` and optional `children` (ids only, no titles);",
    "- every heading of the book in reading order, each shown with an `[id]` when it can start a section, or `-` otherwise, followed by its level and its text.",
    "",
    "Return a corrected TOC and the split depth.",
    "",
    "Rules:",
    "- Output YAML only, with two top-level keys: `max_split_depth` (an integer) and `toc` (a list of entries).",
    "- An entry is a mapping with an integer `id`, a `title` and, when needed, a `children` list of entries.",
    "- Always wrap every `title` in double quotes.",
    "- Use only ids that appear in the input (current TOC or headings). Never invent, translate or reformat an id.",
    "- Only headings shown with an `[id]` can become entries; build each `title` from the heading text.",
    "- Keep the reading order: each entry must come before its children, and entries at the same level must follow the heading order.",
    '- Merge headings that form a single title into one entry (for example "LIFE AND WRITINGS" + "OF" + "DR. ADAM SMITH").',
    '- Write every `title` in sentence case, but keep proper nouns, acronyms and the book language, and start every word of a proper noun with a capital letter; join a numbered label and its heading with " - " (for example "CHAP. I." + "OF THE DIVISION OF LABOUR." becomes "Chap. I - Of the division of labour"); drop trailing periods.',
    "- Drop navigation artifacts such as title pages, bookplates, printing notices and duplicated entries.",
    "- Do not drop a nested entry that points to a distinct anchor; drop only title pages, printing notices and entries that duplicate another href.",
    "- Keep the hierarchy meaningful for a reader.",
    "- Set `max_split_depth` to the depth whose entries make coherent reading units, usually the chapter level rather than the part or the section level; keep the deeper entries even when the split stops above them; depth 1 is the top level.",
    "- Do not set `max_split_depth` deeper than the returned TOC, and use 2 when the structure is unclear.",
    "- Never return an empty `toc`.",
    "- Do not add any commentary, explanation or code fence around the YAML.",
].join("\n");

const POSITION_SCALE = 1e7;

export const positionIndex = (epub) => {
    const documentIndex = new Map(epub.spineHrefs.map((href, index) => [href, index]));
    const htmlByHref = new Map(epub.spineHrefs.map((href) => [href, epub.readText(href)]));

    return (href) => {
        const hash = href.indexOf("#");
        const file = hash < 0 ? href : href.slice(0, hash);
        const anchor = hash < 0 ? "" : href.slice(hash + 1);
        const index = documentIndex.get(file);
        if (index === undefined) return null;
        const offset = anchor ? (htmlByHref.get(file)?.indexOf(`id="${anchor}"`) ?? -1) : -1;
        return index * POSITION_SCALE + (offset < 0 ? -1 : offset);
    };
};

const buildAnchors = ({ toc, headings }) => {
    const idToHref = new Map();
    const hrefToId = new Map();
    const titleByHref = new Map();

    const add = (href) => {
        if (hrefToId.has(href)) return hrefToId.get(href);
        const id = idToHref.size + 1;
        idToHref.set(id, href);
        hrefToId.set(href, id);
        return id;
    };

    for (const heading of headings) {
        if (heading.anchor) add(headingHref(heading));
    }

    const visit = (nodes) => {
        for (const node of nodes ?? []) {
            if (typeof node?.href === "string") {
                if (!titleByHref.has(node.href)) titleByHref.set(node.href, node.title);
                add(node.href);
            }
            visit(node?.children);
        }
    };
    visit(toc);

    return { idToHref, hrefToId, titleByHref };
};

const tocToIds = (nodes, hrefToId) =>
    nodes.map((node) => {
        const entry = { id: hrefToId.get(node.href) };
        const children = tocToIds(node.children ?? [], hrefToId);
        if (children.length > 0) entry.children = children;
        return entry;
    });

const formatHeadings = ({ headings, hrefToId, idToHref, titleByHref }) => {
    const lines = [];
    const represented = new Set();

    for (const heading of headings) {
        if (heading.anchor) {
            const id = hrefToId.get(headingHref(heading));
            represented.add(id);
            lines.push(`[${id}] h${heading.level}  ${heading.text}`);
        } else {
            lines.push(`  -   h${heading.level}  ${heading.text}`);
        }
    }

    for (const [id, href] of idToHref) {
        if (represented.has(id)) continue;
        lines.push(`[${id}] (toc)  ${titleByHref.get(href) ?? ""}`);
    }

    return lines.join("\n");
};

const buildPrompt = ({ title, toc, headings, metadata, hrefToId, idToHref, titleByHref }) => {
    const lines = [`Book title: ${metadata.title || title || ""}`];
    if (metadata.creator) lines.push(`Author: ${metadata.creator}`);
    if (metadata.language) lines.push(`Language: ${metadata.language}`);
    lines.push(
        "",
        "Current TOC (ids only):",
        stringify({ toc: tocToIds(toc, hrefToId) }, { lineWidth: 0 }).trimEnd(),
        "",
        "Headings in reading order ([id] = can start a section, - = cannot):",
        formatHeadings({ headings, hrefToId, idToHref, titleByHref }),
        "",
        "Return the corrected TOC as YAML.",
    );
    return lines.join("\n");
};

const orderOfHref = (nodes) => {
    const order = new Map();
    const visit = (list) => {
        for (const node of list ?? []) {
            if (typeof node?.href === "string" && !order.has(node.href)) {
                order.set(node.href, order.size);
            }
            visit(node?.children);
        }
    };
    visit(nodes);
    return order;
};

export const buildDossier = ({ title, toc, headings, metadata = {} }) => {
    const { idToHref, hrefToId, titleByHref } = buildAnchors({ toc, headings });
    const orderByHref = orderOfHref(toc);

    return {
        idToHref,
        orderOf: (id) => {
            const href = idToHref.get(id);
            if (href === undefined) return null;
            const order = orderByHref.get(href);
            return order === undefined ? null : order;
        },
        system: SYSTEM,
        prompt: buildPrompt({ title, toc, headings, metadata, hrefToId, idToHref, titleByHref }),
    };
};

const quoteTitles = (text) =>
    text.replace(/^(\s*(?:-\s*)?title:\s*)(?!["'])(.*)$/gm, (match, prefix, value) => {
        const trimmed = value.trim();
        if (trimmed === "" || trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.startsWith("|")) {
            return match;
        }
        return `${prefix}"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    });

export const parseTocYaml = (text) => {
    const cleaned = text
        .trim()
        .replace(/^```[a-z]*\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
    let parsed;
    try {
        parsed = parse(cleaned);
    } catch {
        parsed = parse(quoteTitles(cleaned));
    }
    const toc = Array.isArray(parsed) ? parsed : parsed?.toc;
    if (!Array.isArray(toc)) throw new Error("LLM output does not contain a `toc` list");
    return { toc, maxSplitDepth: Array.isArray(parsed) ? undefined : parsed?.max_split_depth };
};

export const tocDepth = (nodes = []) =>
    nodes.reduce((max, node) => Math.max(max, 1 + tocDepth(Array.isArray(node?.children) ? node.children : [])), 0);

export const resolveSplitDepth = (value, toc, fallback) => {
    const depth = tocDepth(toc);
    if (depth < 1) return fallback;
    const candidate = Number.isInteger(value) && value >= 1 ? value : fallback;
    return Math.max(1, Math.min(candidate, depth));
};

export const validateToc = (nodes, idToHref, orderOf) => {
    const errors = [];
    const seen = new Set();
    let previous = -1;

    const walk = (list, path) => {
        if (!Array.isArray(list)) {
            errors.push(`${path}: expected a list of entries`);
            return;
        }
        for (let index = 0; index < list.length; index++) {
            const node = list[index];
            const where = `${path}[${index}]`;
            if (!node || typeof node !== "object") {
                errors.push(`${where}: expected an object`);
                continue;
            }

            const title = typeof node.title === "string" ? node.title.trim() : "";
            const { id } = node;
            if (!title) errors.push(`${where}: missing title`);
            if (!Number.isInteger(id) || !idToHref.has(id)) {
                errors.push(`${where}: unknown id ${JSON.stringify(id)}`);
            } else if (seen.has(id)) {
                errors.push(`${where}: duplicate id ${id}`);
            } else {
                seen.add(id);
                const order = orderOf(id);
                if (order !== null) {
                    if (order < previous) errors.push(`${where}: id ${id} is out of reading order`);
                    previous = order;
                }
            }

            walk(node.children ?? [], `${where}.children`);
        }
    };

    walk(nodes, "toc");
    return errors;
};

export const toHrefToc = (nodes, idToHref) =>
    nodes.map((node) => {
        const href = idToHref.get(node.id);
        if (href === undefined) throw new Error(`unknown id ${node.id}`);
        const entry = { title: node.title, href };
        const children = toHrefToc(node.children ?? [], idToHref);
        if (children.length > 0) entry.children = children;
        return entry;
    });
