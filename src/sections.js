const SECTION_ANCHOR = /<a\b[^>]*\bid="(niv\d+)"[^>]*>/gi;
const SECTION_TITLE = /<div class="[^"]*\bniv1tit\b[^"]*">\s*(\d+)\s*<\/div>/gi;

// Some EPUBs list only the chapter files in their navigation document, while
// each chapter contains numbered sections with their own anchors. This finds
// those sections so the table of contents can expose the missing level.
export const discoverSections = (epub) => {
    const sections = new Map();

    for (const href of epub.spineHrefs) {
        const html = epub.readText(href);
        const anchors = [...html.matchAll(SECTION_ANCHOR)].map((match) => ({
            id: match[1],
            index: match.index,
        }));
        if (anchors.length === 0) continue;

        const blocks = [...html.matchAll(SECTION_TITLE)].map((match) => ({
            number: match[1],
            index: match.index,
        }));
        if (blocks.length === 0) continue;

        const found = [];
        const used = new Set();
        for (const block of blocks) {
            const anchor = anchors.findLast((candidate) => candidate.index < block.index && !used.has(candidate.id));
            if (!anchor) continue;
            used.add(anchor.id);
            found.push({ anchor: anchor.id, number: block.number });
        }
        if (found.length > 0) sections.set(href, found);
    }

    return sections;
};

export const expandToc = (nodes, sections) => {
    let added = 0;

    const walk = (list) =>
        list.map((node) => {
            const children = node.children ? walk(node.children) : [];
            const hasChildren = (node.children?.length ?? 0) > 0;
            if (!hasChildren && typeof node.href === "string" && !node.href.includes("#")) {
                const discovered = sections.get(node.href);
                if (discovered) {
                    const entries = discovered.map((section) => ({
                        title: section.number,
                        href: `${node.href}#${section.anchor}`,
                    }));
                    added += entries.length;
                    return { ...node, children: entries };
                }
            }
            return { ...node, ...(children.length > 0 ? { children } : {}) };
        });

    const toc = walk(nodes);
    return { toc, added };
};
