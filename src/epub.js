import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
});

const decoder = new TextDecoder("utf-8");

const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

export const readEpub = (epubPath) => {
    const entries = unzipSync(readFileSync(epubPath));
    const container = parser.parse(decoder.decode(entries["META-INF/container.xml"]));
    const opfPath = asArray(container.container.rootfiles.rootfile)[0]["@_full-path"];
    const opfDir = posix.dirname(opfPath);
    const opf = parser.parse(decoder.decode(entries[opfPath]));

    const manifestItems = asArray(opf.package?.manifest?.item);
    const itemById = new Map(manifestItems.map((item) => [item["@_id"], item]));
    const spineHrefs = asArray(opf.package?.spine?.itemref)
        .map((itemref) => itemById.get(itemref["@_idref"]))
        .filter((item) => item && item["@_media-type"] === "application/xhtml+xml")
        .filter((item) => !(item["@_properties"] ?? "").split(/\s+/).includes("nav"))
        .map((item) => item["@_href"]);

    const entryPath = (href) => posix.join(opfDir, decodeURIComponent(href));

    return {
        opf,
        opfDir,
        entries,
        spineHrefs,
        readText: (href) => decoder.decode(entries[entryPath(href)]),
        readBytes: (href) => entries[entryPath(href)],
    };
};
