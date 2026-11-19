const ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
};

const decodeEntities = (value) =>
    value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
        if (ENTITIES[code.toLowerCase()]) return ENTITIES[code.toLowerCase()];
        if (code[0] === "#") {
            const radix = code[1] === "x" || code[1] === "X" ? 16 : 10;
            const digits = radix === 16 ? code.slice(2) : code.slice(1);
            const point = Number.parseInt(digits, radix);
            return Number.isFinite(point) ? String.fromCodePoint(point) : match;
        }
        return match;
    });

const normalizeWhitespace = (value) => value.replace(/\s+/g, " ").trim();

const normalizeChar = (value) => {
    const expanded = value.replace(/œ/gi, "oe").replace(/æ/gi, "ae");
    return expanded
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
};

export const titleKey = (value) => [...decodeEntities(value)].map(normalizeChar).join("");

const NUMERIC_TITLE = /^\s*§?\s*\d+\s*[.:]?\s*$/;

export const isNumericTitle = (value) => NUMERIC_TITLE.test(value);

const numericBase = (value) => value.replace(/\s*[.:]\s*$/, "").trim();

const MAX_LEAD_LENGTH = 120;
const MAX_LEAD_WORDS = 15;

const hasLetter = (value) => /\p{L}/u.test(value);

export const stripTrailingPeriod = (value) => {
    const text = normalizeWhitespace(value);
    if (!text.endsWith(".") || text.endsWith("...") || text.endsWith("…")) return text;
    return text.slice(0, -1).trimEnd();
};

const isValidLead = (lead, title) => {
    if (!lead) return false;
    if (lead.length > MAX_LEAD_LENGTH) return false;
    if (lead.split(/\s+/).filter(Boolean).length > MAX_LEAD_WORDS) return false;
    if (!hasLetter(lead)) return false;
    const key = titleKey(lead);
    return key !== "" && key !== titleKey(title);
};

export const composeTitle = (title, lead) => {
    if (!isNumericTitle(title)) return null;
    const cleaned = stripTrailingPeriod(lead);
    if (!isValidLead(cleaned, title)) return null;
    return `${numericBase(title)} - ${cleaned}`;
};

export const titleFragments = (title) => {
    const trimmed = normalizeWhitespace(title);
    if (!trimmed) return [];
    const index = trimmed.indexOf(" - ");
    if (index < 0) return [trimmed];
    return [trimmed.slice(0, index).trim(), trimmed.slice(index + 3).trim()].filter(Boolean);
};

const plainText = (html) => normalizeWhitespace(decodeEntities(html.replace(/<[^>]*>/g, " ")));

const BLOCK_TAGS = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
]);

const BOLD_CLASS = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const isBold = (tag, attributes) => {
    if (tag === "strong" || tag === "b") return true;
    if (tag !== "span") return false;
    const match = attributes.match(BOLD_CLASS);
    const classes = (match?.[1] ?? match?.[2] ?? "").split(/\s+/).filter(Boolean);
    return classes.some((name) => /^bold/i.test(name) || /[-_]bold$/i.test(name));
};

const readBoldRun = (html) => {
    const stack = [];
    let started = false;
    let text = "";
    let consumed = 0;

    for (const match of html.matchAll(/<[^>]*>|[^<]+/g)) {
        const end = match.index + match[0].length;
        const token = match[0];
        if (token.startsWith("<")) {
            const name = token.match(/^<\s*\/?\s*([a-z0-9]+)/i);
            if (!name) continue;
            const tag = name[1].toLowerCase();
            const closing = /^<\s*\//.test(token);
            if (closing) {
                for (let index = stack.length - 1; index >= 0; index--) {
                    if (stack[index].tag === tag) {
                        stack.splice(index);
                        break;
                    }
                }
                consumed = end;
                continue;
            }
            if (BLOCK_TAGS.has(tag)) {
                if (started) break;
                continue;
            }
            const attributes = token.slice(name[0].length);
            stack.push({ tag, bold: isBold(tag, attributes) });
            consumed = end;
            continue;
        }

        const value = decodeEntities(token);
        if (stack.some((element) => element.bold)) {
            text += value;
            if (normalizeWhitespace(value) !== "") started = true;
            consumed = end;
        } else if (normalizeWhitespace(value) === "") {
            if (started) {
                text += value;
                consumed = end;
            }
        } else {
            break;
        }
    }

    return { text, end: consumed };
};

const QUOTE_PAIRS = [
    ["«", "»"],
    ["“", "”"],
];

export const closingQuoteOf = (value) => {
    for (const [open, close] of QUOTE_PAIRS) {
        const opens = value.split(open).length - 1;
        const closes = value.split(close).length - 1;
        if (opens > closes) return close;
    }
    return null;
};

export const extractLead = (html, title) => {
    let start = -1;
    for (const match of html.matchAll(/<([a-z0-9]+)\b([^>]*)>/gi)) {
        const tag = match[1].toLowerCase();
        if (isBold(tag, match[2])) {
            start = match.index;
            break;
        }
    }
    if (start < 0) return null;

    const prefix = plainText(html.slice(0, start));
    const prefixKey = titleKey(prefix);
    const titleK = titleKey(title);
    const numericPrefix = NUMERIC_TITLE.test(prefix);
    if (!(prefixKey === "" || prefixKey === titleK || numericPrefix)) return null;

    const run = readBoldRun(html.slice(start));
    const lead = normalizeWhitespace(run.text);
    if (!lead) return null;

    const closing = closingQuoteOf(lead);
    if (closing) {
        const rest = html.slice(start + run.end).replace(/^\s+/, "");
        if (rest.startsWith(closing)) return normalizeWhitespace(`${lead} ${closing}`);
    }

    return lead;
};

const flatten = (nodes) => (nodes ?? []).flatMap((node) => [node, ...flatten(node.children)]);

const anchorStart = (html, anchor) => {
    let index = html.indexOf(`id="${anchor}"`);
    if (index < 0) index = html.indexOf(`id='${anchor}'`);
    return index < 0 ? -1 : html.lastIndexOf("<", index);
};

export const extractLeads = (epub, toc) => {
    const entries = flatten(toc).filter((node) => typeof node?.href === "string" && node.href.includes("#"));
    const byDocument = new Map();

    for (const entry of entries) {
        const [document, anchor] = entry.href.split("#");
        if (!document || !anchor) continue;
        if (!byDocument.has(document)) byDocument.set(document, []);
        byDocument.get(document).push({ href: entry.href, title: entry.title, anchor });
    }

    const leads = new Map();
    for (const [document, list] of byDocument) {
        const html = epub.readText(document);
        for (let index = 0; index < list.length; index++) {
            const entry = list[index];
            const start = anchorStart(html, entry.anchor);
            if (start < 0) continue;
            const next = index + 1 < list.length ? anchorStart(html, list[index + 1].anchor) : -1;
            const end = next > start ? next : html.length;
            const lead = extractLead(html.slice(start, end), entry.title);
            if (lead) leads.set(entry.href, lead);
        }
    }

    return leads;
};

const walkTitles = (nodes, leads, stats) =>
    nodes.map((node) => {
        let title = node.title;
        if (typeof title === "string" && isNumericTitle(title)) {
            const lead = node.href ? leads.get(node.href) : null;
            const composed = lead ? composeTitle(title, lead) : null;
            if (composed) {
                title = composed;
                stats.enriched++;
            } else {
                stats.skipped++;
            }
        }
        const children = node.children ? walkTitles(node.children, leads, stats) : [];
        return { ...node, title, ...(children.length > 0 ? { children } : {}) };
    });

export const enrichTitles = (nodes, leads) => {
    const stats = { enriched: 0, skipped: 0 };
    const toc = walkTitles(nodes, leads, stats);
    return { toc, ...stats };
};
