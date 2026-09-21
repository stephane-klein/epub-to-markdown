import { posix } from "node:path";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    trimValues: true,
});

const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

const normalize = (value) => value.replace(/\s+/g, " ").trim();

const textOf = (node) => {
    if (node === undefined || node === null) return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map((child) => textOf(child)).join(" ");
    if (typeof node === "object") {
        return Object.entries(node)
            .filter(([key]) => !key.startsWith("@_"))
            .map(([, value]) => textOf(value))
            .join(" ");
    }
    return "";
};

const parseOrderedList = (ol) =>
    asArray(ol).flatMap((list) =>
        asArray(list.li).map((li) => {
            const link = asArray(li.a)[0] ?? asArray(li.span)[0] ?? {};
            const entry = { title: normalize(textOf(link)), href: link["@_href"] ?? "" };
            const children = parseOrderedList(li.ol);
            return children.length > 0 ? { ...entry, children } : entry;
        }),
    );

const parseNavPoints = (navPoints) =>
    asArray(navPoints).map((navPoint) => {
        const entry = {
            title: normalize(textOf(navPoint.navLabel?.text)),
            href: navPoint.content?.["@_src"] ?? "",
        };
        const children = parseNavPoints(navPoint.navPoint);
        return children.length > 0 ? { ...entry, children } : entry;
    });

const isTocNav = (nav) => nav["@_epub:type"] === "toc" || nav["@_role"] === "doc-toc";

export const parseNav = (xml) => {
    const { html } = parser.parse(xml);
    const navs = asArray(html?.body?.nav);
    const nav = navs.find((item) => isTocNav(item)) ?? navs[0];
    if (!nav) {
        throw new Error("No nav element found in the EPUB navigation document");
    }
    return parseOrderedList(nav.ol);
};

export const parseNcx = (xml) => {
    const { ncx } = parser.parse(xml);
    const navPoints = ncx?.navMap?.navPoint;
    if (!navPoints) {
        throw new Error("No navPoint element found in the EPUB NCX document");
    }
    return parseNavPoints(navPoints);
};

const findNavItem = (manifest) =>
    asArray(manifest?.item).find((item) => (item["@_properties"] ?? "").split(/\s+/).includes("nav"));

const findNcxItem = (manifest, spine) =>
    asArray(manifest?.item).find((item) => item["@_media-type"] === "application/x-dtbncx+xml") ??
    asArray(manifest?.item).find((item) => item["@_id"] === spine?.["@_toc"]);

const metadataTitle = (metadata) => {
    const title = asArray(metadata?.["dc:title"])[0];
    if (title === undefined) return "";
    return normalize(typeof title === "object" ? (title["#text"] ?? "") : String(title));
};

const metadataValue = (metadata, key) => {
    const value = asArray(metadata?.[key])[0];
    if (value === undefined) return "";
    return normalize(typeof value === "object" ? (value["#text"] ?? "") : String(value));
};

export const extractMetadata = (epub) => {
    const { metadata } = epub.opf.package;
    return {
        title: metadataTitle(metadata),
        creator: metadataValue(metadata, "dc:creator"),
        language: metadataValue(metadata, "dc:language"),
    };
};

export const slugify = (value) =>
    value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

const ordinal = (index, total) => String(index + 1).padStart(String(total).length, "0");

const SECTION_PREFIX = /^§\s*\d+[.:]?\s*/;

const MAX_SLUG_LENGTH = 100;

const truncateSlug = (value, max) => {
    if (value.length <= max) return value;
    const cut = value.slice(0, max);
    const lastDash = cut.lastIndexOf("-");
    return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
};

const slugBase = (title) => truncateSlug(slugify(title.replace(SECTION_PREFIX, "")), MAX_SLUG_LENGTH) || "section";

export const annotateToc = (nodes, parentPath = "") =>
    nodes.map((node, index) => {
        const slug = `${ordinal(index, nodes.length)}-${slugBase(node.title)}`;
        const path = parentPath ? `${parentPath}/${slug}` : slug;
        const children = annotateToc(node.children ?? [], path);
        return children.length > 0
            ? { title: node.title, slug, path, href: node.href, children }
            : { title: node.title, slug, path, href: node.href };
    });

const EXTERNAL_HREF = /^[a-z][a-z0-9+.-]*:/i;

export const resolveHref = (base, href) => {
    if (!href || EXTERNAL_HREF.test(href) || href.startsWith("//") || href.startsWith("/")) return href;
    return posix.normalize(posix.join(base, href));
};

const resolveTocHrefs = (nodes, base) =>
    nodes.map((node) => ({
        ...node,
        href: resolveHref(base, node.href),
        ...(node.children ? { children: resolveTocHrefs(node.children, base) } : {}),
    }));

export const extractToc = (epub) => {
    const { metadata, manifest, spine } = epub.opf.package;
    const navItem = findNavItem(manifest);
    const item = navItem ?? findNcxItem(manifest, spine);
    if (!item) {
        throw new Error("No EPUB navigation document (nav or NCX) found");
    }
    const xml = epub.readText(item["@_href"]);
    const base = posix.dirname(item["@_href"]);
    const parsed = item === navItem ? parseNav(xml) : parseNcx(xml);
    return { title: metadataTitle(metadata), toc: annotateToc(resolveTocHrefs(parsed, base)) };
};
