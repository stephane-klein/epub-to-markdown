import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverSections, expandToc } from "../src/sections.js";
import { enrichTitles, extractLeads } from "../src/title.js";

const epub = {
    spineHrefs: ["a.xhtml", "b.xhtml"],
    readText: (href) =>
        ({
            "a.xhtml":
                '<div><a id="niv01"/></div><div class="niv1"><div class="niv1tit">1</div></div>' +
                '<div><a id="niv02"/></div><div class="niv1"><div class="niv1tit">\n2\n</div></div>',
            "b.xhtml": "<p>No sections.</p>",
        })[href],
};

test("discoverSections pairs numbered blocks with their preceding anchors", () => {
    const sections = discoverSections(epub);

    assert.deepEqual(sections.get("a.xhtml"), [
        { anchor: "niv01", number: "1" },
        { anchor: "niv02", number: "2" },
    ]);
    assert.equal(sections.has("b.xhtml"), false);
});

test("discoverSections ignores anchors that are not section anchors", () => {
    const fake = {
        spineHrefs: ["a.xhtml"],
        readText: () => '<a id="ch01"></a><div class="niv1"><div class="niv1tit">1</div></div>',
    };

    assert.equal(discoverSections(fake).size, 0);
});

test("discoverSections pairs anchors placed inside the numbered block", () => {
    const fake = {
        spineHrefs: ["a.xhtml"],
        readText: () =>
            '<div class="niv1tit"><a id="n1"></a>1</div><div class="fmp-j"><b>One.</b> Body.</div>' +
            '<div class="niv1tit"><a id="n2"></a>2</div><div class="fmp-j"><b>Two.</b> Body.</div>' +
            '<div class="niv1tit"><a id="n3"></a>CENSURE</div><div class="fmp-j">index</div>',
    };

    assert.deepEqual(discoverSections(fake).get("a.xhtml"), [
        { anchor: "n1", number: "1" },
        { anchor: "n2", number: "2" },
    ]);
});

test("expandToc adds the sections under a childless document entry", () => {
    const toc = [
        {
            title: "Part",
            href: "part.xhtml",
            children: [{ title: "Chapter", href: "a.xhtml" }],
        },
    ];
    const result = expandToc(toc, new Map([["a.xhtml", [{ anchor: "niv01", number: "1" }]]]));

    assert.equal(result.added, 1);
    assert.deepEqual(result.toc[0].children[0].children, [{ title: "1", href: "a.xhtml#niv01" }]);
});

test("expandToc leaves a document entry that already has children alone", () => {
    const toc = [
        {
            title: "Chapter",
            href: "a.xhtml",
            children: [{ title: "Section", href: "a.xhtml#niv01" }],
        },
    ];
    const result = expandToc(toc, new Map([["a.xhtml", [{ anchor: "niv01", number: "1" }]]]));

    assert.equal(result.added, 0);
    assert.deepEqual(result.toc[0].children, [{ title: "Section", href: "a.xhtml#niv01" }]);
});

test("expandToc leaves an anchored entry alone", () => {
    const toc = [{ title: "Chapter", href: "a.xhtml#ch01" }];
    const result = expandToc(toc, new Map([["a.xhtml", [{ anchor: "niv01", number: "1" }]]]));

    assert.equal(result.added, 0);
    assert.equal(result.toc[0].children, undefined);
});

test("expanded sections are enriched from their bold lead", () => {
    const fake = {
        spineHrefs: ["a.xhtml"],
        readText: () =>
            '<a id="niv01"></a><div class="niv1tit">1</div><div class="niv1p"><span class="bold">One.</span> Body.</div>',
    };
    const sections = discoverSections(fake);
    const expanded = expandToc([{ title: "Chapter", href: "a.xhtml" }], sections);
    const leads = extractLeads(fake, expanded.toc);
    const enriched = enrichTitles(expanded.toc, leads);

    assert.equal(enriched.toc[0].children[0].title, "1 - One");
});

test("sections with an inside anchor are enriched from their bold lead", () => {
    const fake = {
        spineHrefs: ["a.xhtml"],
        readText: () =>
            '<div class="niv1tit"><a id="n1"></a>1</div><div class="fmp-j"><b>Une éducation.</b> Body.</div>',
    };
    const sections = discoverSections(fake);
    const expanded = expandToc([{ title: "Chapter", href: "a.xhtml" }], sections);
    const enriched = enrichTitles(expanded.toc, extractLeads(fake, expanded.toc));

    assert.equal(enriched.toc[0].children[0].title, "1 - Une éducation");
});
