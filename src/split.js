const anchorOffset = (html, anchor) => {
    const index = html.indexOf(`id="${anchor}"`);
    return index < 0 ? -1 : html.lastIndexOf("<", index);
};

const entryAnchor = (entry) => {
    const index = entry.href.indexOf("#");
    return index < 0 ? "" : entry.href.slice(index + 1);
};

const HEADING_ELEMENTS = /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi;

const normalize = (value) => value.replace(/\s+/g, " ").trim();

const isHeadingOnly = (slice) => {
    if (!/<h[1-6]\b/i.test(slice)) return false;
    return normalize(slice.replace(HEADING_ELEMENTS, " ").replace(/<[^>]+>/g, " ")) === "";
};

const plainText = (slice) => normalize(slice.replace(/<[^>]+>/g, " "));

const HEADING_ELEMENT = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;

const headingId = (attrs) => {
    const match = attrs.match(/\bid="([^"]*)"/i);
    return match ? match[1] : null;
};

const isForeignEntry = (attrs, anchor, entriesByAnchor) => {
    const id = headingId(attrs);
    return Boolean(id) && id !== anchor && entriesByAnchor.has(id);
};

export const stripLeadingTitle = (html, anchor, entriesByAnchor) => {
    const headings = [...html.matchAll(HEADING_ELEMENT)];
    if (headings.length === 0) return html;

    const [first] = headings;
    if (plainText(html.slice(0, first.index)) !== "") return html;
    if (isForeignEntry(first[2], anchor, entriesByAnchor)) return html;

    let end = first.index + first[0].length;
    for (let index = 1; index < headings.length; index++) {
        const previous = headings[index - 1];
        const heading = headings[index];
        const gap = html.slice(previous.index + previous[0].length, heading.index);
        if (plainText(gap) !== "") break;
        if (isForeignEntry(heading[2], anchor, entriesByAnchor)) break;
        end = heading.index + heading[0].length;
    }

    let tail = end;
    while (tail < html.length && /\s/.test(html[tail])) tail++;

    return html.slice(0, first.index) + html.slice(tail);
};

const flattenToc = (nodes, depth = 1) =>
    nodes.flatMap((node) => {
        const children = node.children ?? [];
        return [
            {
                title: node.title,
                href: node.href,
                path: node.path,
                depth,
                hasChildren: children.length > 0,
                childCount: children.length,
                onlyChildHref: children[0]?.href ?? null,
            },
            ...(children.length > 0 ? flattenToc(children, depth + 1) : []),
        ];
    });

// Returns the parent entries that own no file. Their title would otherwise be
// lost, because the split drops the body of a parent that sits above
// maxSplitDepth. The generator writes each one as <path>/00-index.md.
const missingParents = (sections, entries) => {
    const sectionPaths = new Set(sections.map((section) => section.entry.path));
    const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
    const order = new Map(entries.map((entry, index) => [entry.path, index]));
    const missing = new Map();

    for (const section of sections) {
        const segments = section.entry.path.split("/");
        for (let index = 1; index < segments.length; index++) {
            const path = segments.slice(0, index).join("/");
            if (sectionPaths.has(path) || missing.has(path)) continue;
            const entry = entriesByPath.get(path);
            if (entry) missing.set(path, entry);
        }
    }

    return [...missing.values()].sort((left, right) => order.get(left.path) - order.get(right.path));
};

const isSplitEntry = (entry, maxSplitDepth, documentLevel = false) =>
    documentLevel || entry.depth === maxSplitDepth || (entry.depth < maxSplitDepth && !entry.hasChildren);

export const splitIntoSections = ({ toc, maxSplitDepth, documents }) => {
    const entries = flattenToc(toc);
    const entriesByAnchor = new Map();
    for (const entry of entries) {
        const anchor = entryAnchor(entry);
        if (anchor) entriesByAnchor.set(anchor, entry);
    }
    const anchored = entries.filter((entry) => entryAnchor(entry));
    const documentEntries = new Map();
    for (const entry of entries) {
        if (!entryAnchor(entry) && !documentEntries.has(entry.href)) {
            documentEntries.set(entry.href, entry);
        }
    }

    const sections = [];
    let current = null;
    for (const { href, html } of documents) {
        const bodyMatch = html.match(/<body\b[^>]*>/i);
        const bodyStart = bodyMatch ? bodyMatch.index + bodyMatch[0].length : 0;

        const marks = anchored
            .map((entry) => {
                const [file, anchor] = entry.href.split("#");
                return file === href && anchor ? { entry, start: anchorOffset(html, anchor) } : null;
            })
            .filter((mark) => mark && mark.start >= 0);
        const documentEntry = documentEntries.get(href);
        if (documentEntry) {
            marks.push({ entry: documentEntry, start: bodyStart, documentLevel: true });
        }
        marks.sort((a, b) => a.start - b.start || Number(b.documentLevel ?? false) - Number(a.documentLevel ?? false));

        const firstStart = marks.length > 0 ? marks[0].start : html.length;
        const prefix = html.slice(Math.min(bodyStart, firstStart), firstStart);
        if (current && prefix.replace(/<[^>]+>/g, "").trim().length > 0) current.html += prefix;

        const collapsed = new Map();
        const folded = new Set();
        for (let index = 0; index + 1 < marks.length; index++) {
            const parent = marks[index].entry;
            const child = marks[index + 1].entry;
            if (
                parent.depth < maxSplitDepth &&
                parent.childCount === 1 &&
                parent.onlyChildHref === child.href &&
                !child.hasChildren &&
                isHeadingOnly(html.slice(marks[index].start, marks[index + 1].start))
            ) {
                collapsed.set(index, index + 1);
                folded.add(index + 1);
            }
        }

        for (let index = 0; index < marks.length; index++) {
            const end = index + 1 < marks.length ? marks[index + 1].start : html.length;
            const segment = html.slice(marks[index].start, end);
            const { entry, documentLevel } = marks[index];
            const childIndex = collapsed.get(index);
            if (childIndex !== undefined) {
                const child = marks[childIndex].entry;
                const heading = plainText(html.slice(marks[index].start, marks[childIndex].start));
                current = {
                    entry: {
                        title: normalize(`${heading} ${child.title}`),
                        path: entry.path,
                        href: entry.href,
                        depth: entry.depth,
                    },
                    html: segment,
                };
                sections.push(current);
            } else if (folded.has(index)) {
                if (current) current.html += segment;
            } else if (isSplitEntry(entry, maxSplitDepth, documentLevel)) {
                current = { entry, html: segment };
                sections.push(current);
            } else if (entry.depth < maxSplitDepth) {
                current = null;
            } else if (current) {
                current.html += segment;
            }
        }
    }

    return { sections, entriesByAnchor, indexEntries: missingParents(sections, entries) };
};
