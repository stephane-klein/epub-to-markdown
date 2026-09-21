import assert from "node:assert/strict";
import { test } from "node:test";
import { annotateToc, extractToc, parseNav, parseNcx, resolveHref, slugify } from "../src/toc.js";

const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
<nav epub:type="landmarks"><ol><li><a href="a.xhtml">Start</a></li></ol></nav>
<nav epub:type="toc">
<ol>
<li><a href="a.xhtml#one">Chapter One</a></li>
<li><a href="a.xhtml#two">Chapter Two</a>
<ol>
<li><a href="a.xhtml#two-one">Section Two One</a></li>
</ol>
</li>
<li><a href="a.xhtml#three">Chapter
    Three</a></li>
</ol>
</nav>
</body>
</html>`;

const ncxXml = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<navMap>
<navPoint><navLabel><text>Chapter One</text></navLabel><content src="a.xhtml#one"/></navPoint>
<navPoint><navLabel><text>Chapter Two</text></navLabel><content src="a.xhtml#two"/>
<navPoint><navLabel><text>Section Two One</text></navLabel><content src="a.xhtml#two-one"/></navPoint>
</navPoint>
<navPoint><navLabel><text>Chapter
    Three</text></navLabel><content src="a.xhtml#three"/></navPoint>
</navMap>
</ncx>`;

const expected = [
    { title: "Chapter One", href: "a.xhtml#one" },
    {
        title: "Chapter Two",
        href: "a.xhtml#two",
        children: [{ title: "Section Two One", href: "a.xhtml#two-one" }],
    },
    { title: "Chapter Three", href: "a.xhtml#three" },
];

const expectedAnnotated = [
    { title: "Chapter One", slug: "1-chapter-one", path: "1-chapter-one", href: "a.xhtml#one" },
    {
        title: "Chapter Two",
        slug: "2-chapter-two",
        path: "2-chapter-two",
        href: "a.xhtml#two",
        children: [
            {
                title: "Section Two One",
                slug: "1-section-two-one",
                path: "2-chapter-two/1-section-two-one",
                href: "a.xhtml#two-one",
            },
        ],
    },
    { title: "Chapter Three", slug: "3-chapter-three", path: "3-chapter-three", href: "a.xhtml#three" },
];

test("parseNav extracts the toc nav and ignores other navs", () => {
    assert.deepEqual(parseNav(navXhtml), expected);
});

test("parseNcx extracts the nested navPoints", () => {
    assert.deepEqual(parseNcx(ncxXml), expected);
});

test("parseNav and parseNcx produce the same tree", () => {
    assert.deepEqual(parseNav(navXhtml), parseNcx(ncxXml));
});

test("parseNav throws when there is no nav element", () => {
    assert.throws(() => parseNav("<html><body></body></html>"), /No nav element/);
});

test("parseNcx throws when there is no navPoint element", () => {
    assert.throws(() => parseNcx("<ncx><navMap/></ncx>"), /No navPoint element/);
});

const fakeEpub = ({ metadata, manifest, spine }, files) => ({
    opf: { package: { metadata, manifest: { item: manifest }, spine } },
    readText: (href) => files[href],
});

test("extractToc falls back to the NCX document when there is no nav", () => {
    const epub = fakeEpub(
        {
            metadata: { "dc:title": { "#text": "  My\n  Book " } },
            manifest: [{ "@_id": "ncx", "@_href": "toc.ncx", "@_media-type": "application/x-dtbncx+xml" }],
            spine: { "@_toc": "ncx" },
        },
        { "toc.ncx": ncxXml },
    );

    assert.deepEqual(extractToc(epub), { title: "My Book", toc: expectedAnnotated });
});

test("extractToc prefers the EPUB 3 nav document over the NCX", () => {
    const read = [];
    const epub = fakeEpub(
        {
            metadata: { "dc:title": "My Book" },
            manifest: [
                {
                    "@_id": "nav",
                    "@_href": "toc.xhtml",
                    "@_properties": "nav",
                    "@_media-type": "application/xhtml+xml",
                },
                { "@_id": "ncx", "@_href": "toc.ncx", "@_media-type": "application/x-dtbncx+xml" },
            ],
            spine: { "@_toc": "ncx" },
        },
        {
            get "toc.xhtml"() {
                read.push("toc.xhtml");
                return navXhtml;
            },
            get "toc.ncx"() {
                read.push("toc.ncx");
                return ncxXml;
            },
        },
    );

    assert.deepEqual(extractToc(epub).toc, expectedAnnotated);
    assert.deepEqual(read, ["toc.xhtml"]);
});

test("extractToc throws when there is neither a nav nor an NCX document", () => {
    const epub = fakeEpub({ metadata: {}, manifest: [], spine: {} }, {});
    assert.throws(() => extractToc(epub), /No EPUB navigation document/);
});

test("resolveHref resolves a nav-relative href against the nav directory", () => {
    assert.equal(resolveHref("XHTML", "DEC_0001.xhtml#s1n2"), "XHTML/DEC_0001.xhtml#s1n2");
    assert.equal(resolveHref(".", "Text/pre5.html"), "Text/pre5.html");
    assert.equal(resolveHref("XHTML", "../Text/a.xhtml"), "Text/a.xhtml");
    assert.equal(resolveHref("XHTML", "https://example.com/x"), "https://example.com/x");
    assert.equal(resolveHref("XHTML", "/abs/x"), "/abs/x");
});

test("slugify lowercases, strips diacritics and punctuation", () => {
    assert.equal(slugify("Éléments de Théorie — § 1. Coût:"), "elements-de-theorie-1-cout");
    assert.equal(slugify("  Multiple   spaces  "), "multiple-spaces");
    assert.equal(slugify("???"), "");
});

test("annotateToc adds slug and path to a parsed tree", () => {
    assert.deepEqual(annotateToc(parseNav(navXhtml)), expectedAnnotated);
});

test("annotateToc prefixes slugs with a zero-padded ordinal", () => {
    const tree = annotateToc(
        Array.from({ length: 10 }, (_, index) => ({ title: `Chapter ${index + 1}`, href: `a#${index + 1}` })),
    );

    assert.deepEqual(
        tree.map((node) => node.slug),
        [
            "01-chapter-1",
            "02-chapter-2",
            "03-chapter-3",
            "04-chapter-4",
            "05-chapter-5",
            "06-chapter-6",
            "07-chapter-7",
            "08-chapter-8",
            "09-chapter-9",
            "10-chapter-10",
        ],
    );
});

test("annotateToc strips a leading section marker before slugifying", () => {
    const tree = annotateToc([
        { title: "§ 1. The Requisites of Production.", href: "a#1" },
        { title: "§ 2. Antagonist Principle.", href: "a#2" },
    ]);

    assert.deepEqual(
        tree.map((node) => node.slug),
        ["1-the-requisites-of-production", "2-antagonist-principle"],
    );
});

test("annotateToc caps long slugs and cuts at a word boundary", () => {
    const title = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
    const [node] = annotateToc([{ title, href: "a#1" }]);

    assert.ok(node.slug.length <= 101, `slug too long: ${node.slug.length}`);
    assert.ok(!node.slug.endsWith("-"));
    assert.match(node.slug, /^1-[a-z0-9-]+$/);
});

test("annotateToc falls back to a section slug when the title has no usable characters", () => {
    const tree = annotateToc([
        { title: "???", href: "a.xhtml#pgepubid00045" },
        { title: "!!!", href: "a.xhtml" },
    ]);

    assert.deepEqual(
        tree.map((node) => node.slug),
        ["1-section", "2-section"],
    );
});
