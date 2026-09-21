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

const cleanText = (value) =>
    decodeEntities(value.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();

const attribute = (attrs, name) => {
    const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
    return match ? decodeEntities(match[1]) : null;
};

export const extractHeadings = (epub) => {
    const headings = [];
    let order = 0;

    for (const href of epub.spineHrefs) {
        const html = epub.readText(href);
        const pattern = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
        let match = pattern.exec(html);
        while (match) {
            headings.push({
                order: order++,
                href,
                anchor: attribute(match[2], "id"),
                level: Number(match[1]),
                text: cleanText(match[3]),
            });
            match = pattern.exec(html);
        }
    }

    return headings;
};

export const headingHref = (heading) => (heading.anchor ? `${heading.href}#${heading.anchor}` : heading.href);
