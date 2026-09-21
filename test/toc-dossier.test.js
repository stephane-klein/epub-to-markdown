import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDossier, parseTocYaml, positionIndex, toHrefToc, validateToc } from "../src/toc-dossier.js";

const headings = [
    { order: 0, href: "a.xhtml", anchor: "one", level: 2, text: "Chapter One" },
    { order: 1, href: "a.xhtml", anchor: "two", level: 2, text: "Chapter Two" },
];
const toc = [
    { title: "Chapter One", href: "a.xhtml#one" },
    { title: "Chapter Two", href: "a.xhtml#two" },
];

const positions = { "a.xhtml": -1, "a.xhtml#one": 10, "a.xhtml#two": 20, "a.xhtml#cover": 5 };
const positionOf = (href) => positions[href] ?? null;

const { idToHref, orderOf, system, prompt } = buildDossier({
    title: "Book",
    toc,
    headings,
    metadata: { title: "Book", creator: "Someone" },
    positionOf,
});

test("buildDossier assigns short ids to anchored headings", () => {
    assert.equal(idToHref.get(1), "a.xhtml#one");
    assert.equal(idToHref.get(2), "a.xhtml#two");
});

test("buildDossier builds a prompt that uses ids and never leaks hrefs", () => {
    assert.match(system, /table of contents/i);
    assert.match(prompt, /Headings in reading order/);
    assert.match(prompt, /\[1\] h2 {2}Chapter One/);
    assert.match(prompt, /Author: Someone/);
    assert.doesNotMatch(prompt, /a\.xhtml#one/);
});

test("buildDossier adds an id for a toc anchor that is not a heading", () => {
    const dossier = buildDossier({
        title: "Book",
        toc: [{ title: "Cover", href: "a.xhtml#cover" }],
        headings,
        metadata: {},
    });
    assert.equal(dossier.idToHref.get(3), "a.xhtml#cover");
    assert.match(dossier.prompt, /\[3\] \(toc\) {2}Cover/);
});

test("validateToc accepts a valid tree", () => {
    assert.deepEqual(validateToc([{ id: 1, title: "One" }], idToHref, orderOf), []);
});

test("validateToc rejects an unknown id", () => {
    const errors = validateToc([{ id: 99, title: "Nope" }], idToHref, orderOf);
    assert.match(errors.join("\n"), /unknown id/);
});

test("validateToc rejects a duplicate id", () => {
    const errors = validateToc(
        [
            { id: 1, title: "One" },
            { id: 1, title: "Again" },
        ],
        idToHref,
        orderOf,
    );
    assert.match(errors.join("\n"), /duplicate id/);
});

test("validateToc rejects an id out of reading order", () => {
    const errors = validateToc(
        [
            { id: 2, title: "Two" },
            { id: 1, title: "One" },
        ],
        idToHref,
        orderOf,
    );
    assert.match(errors.join("\n"), /out of reading order/);
});

test("validateToc rejects a missing title and a non-list children value", () => {
    const errors = validateToc([{ id: 1, children: "nope" }], idToHref, orderOf);
    assert.match(errors.join("\n"), /missing title/);
    assert.match(errors.join("\n"), /expected a list/);
});

test("toHrefToc maps ids back to hrefs", () => {
    assert.deepEqual(toHrefToc([{ id: 1, title: "One", children: [{ id: 2, title: "Two" }] }], idToHref), [
        { title: "One", href: "a.xhtml#one", children: [{ title: "Two", href: "a.xhtml#two" }] },
    ]);
});

test("toHrefToc throws on an unknown id", () => {
    assert.throws(() => toHrefToc([{ id: 99, title: "Nope" }], idToHref), /unknown id/);
});

test("positionIndex orders anchors by document and byte offset", () => {
    const epub = {
        spineHrefs: ["a.xhtml", "b.xhtml"],
        readText: (href) =>
            ({
                "a.xhtml": '<h2 id="one">One</h2><h2 id="two">Two</h2>',
                "b.xhtml": '<h1 id="three">Three</h1>',
            })[href],
    };
    const positionOf = positionIndex(epub);

    assert.ok(positionOf("a.xhtml") < positionOf("a.xhtml#one"));
    assert.ok(positionOf("a.xhtml#one") < positionOf("a.xhtml#two"));
    assert.ok(positionOf("a.xhtml#two") < positionOf("b.xhtml#three"));
    assert.equal(positionOf("missing.xhtml#x"), null);
});

test("validateToc accepts a document-level parent placed before its anchored child", () => {
    const docToc = [
        {
            title: "Introduction",
            href: "a.xhtml",
            children: [{ title: "Section", href: "a.xhtml#one" }],
        },
    ];
    const dossier = buildDossier({ title: "Book", toc: docToc, headings, metadata: {}, positionOf });

    assert.equal(dossier.idToHref.get(3), "a.xhtml");
    const nodes = [{ id: 3, title: "Introduction", children: [{ id: 1, title: "Section" }] }];
    assert.deepEqual(validateToc(nodes, dossier.idToHref, dossier.orderOf), []);
});

test("parseTocYaml strips code fences and reads the toc key", () => {
    assert.deepEqual(parseTocYaml("```yaml\ntoc:\n  - id: 1\n    title: One\n```"), [{ id: 1, title: "One" }]);
});

test("parseTocYaml repairs unquoted titles containing a colon", () => {
    assert.deepEqual(parseTocYaml("toc:\n  - id: 1\n    title: FOOTNOTES:\n"), [{ id: 1, title: "FOOTNOTES:" }]);
});

test("parseTocYaml throws when the output has no toc list", () => {
    assert.throws(() => parseTocYaml("title: Book"), /does not contain a `toc` list/);
});
