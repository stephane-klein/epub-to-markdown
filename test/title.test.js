import assert from "node:assert/strict";
import { test } from "node:test";
import {
    closingQuoteOf,
    composeTitle,
    enrichTitles,
    extractLead,
    extractLeads,
    isNumericTitle,
    stripTrailingPeriod,
    titleFragments,
    titleKey,
} from "../src/title.js";
import { annotateToc } from "../src/toc.js";

test("titleKey ignores case, accents, punctuation and spaces", () => {
    assert.equal(titleKey("Les deux XIXe siècles."), "lesdeuxxixesiecles");
    assert.equal(titleKey("Égotisme, individualisme"), "egotismeindividualisme");
    assert.equal(titleKey("L’homme"), "lhomme");
});

test("titleKey expands ligatures", () => {
    assert.equal(titleKey("Œuvre"), "oeuvre");
});

test("stripTrailingPeriod removes one sentence period", () => {
    assert.equal(stripTrailingPeriod("Les deux XIXe siècles."), "Les deux XIXe siècles");
    assert.equal(stripTrailingPeriod("Qu'est-ce qu'un transcendantaliste?"), "Qu'est-ce qu'un transcendantaliste?");
    assert.equal(stripTrailingPeriod("Thoreau, philosophe proustien..."), "Thoreau, philosophe proustien...");
    assert.equal(stripTrailingPeriod("« Un monde à la fois. »"), "« Un monde à la fois. »");
    assert.equal(stripTrailingPeriod("« Un monde à la fois »."), "« Un monde à la fois »");
});

test("isNumericTitle matches bare section numbers", () => {
    assert.equal(isNumericTitle("1"), true);
    assert.equal(isNumericTitle("12."), true);
    assert.equal(isNumericTitle("§ 3"), true);
    assert.equal(isNumericTitle("I"), false);
    assert.equal(isNumericTitle("1 - Title"), false);
});

test("titleFragments splits on the first separator only", () => {
    assert.deepEqual(titleFragments("1 - Les deux XIXe siècles"), ["1", "Les deux XIXe siècles"]);
    assert.deepEqual(titleFragments("1 - La vie - une œuvre"), ["1", "La vie - une œuvre"]);
    assert.deepEqual(titleFragments("Introduction"), ["Introduction"]);
});

test("closingQuoteOf reports an unmatched opening quote", () => {
    assert.equal(closingQuoteOf("« L'homme est ce qu'il mange"), "»");
    assert.equal(closingQuoteOf("Les « trois salopes »"), null);
});

test("composeTitle joins a bare number and its lead", () => {
    assert.equal(composeTitle("1", "Les deux XIXe siècles."), "1 - Les deux XIXe siècles");
    assert.equal(
        composeTitle("1.", "Se changer, changer l'ordre du monde."),
        "1 - Se changer, changer l'ordre du monde",
    );
    assert.equal(composeTitle("1", "Thoreau, philosophe proustien..."), "1 - Thoreau, philosophe proustien...");
});

test("composeTitle rejects titles that are not bare numbers", () => {
    assert.equal(composeTitle("Introduction", "Lead"), null);
    assert.equal(composeTitle("I - Henry David Thoreau", "Lead"), null);
});

test("composeTitle rejects unusable leads", () => {
    assert.equal(composeTitle("1", ""), null);
    assert.equal(composeTitle("1", "1"), null);
    assert.equal(composeTitle("1", "123"), null);
    assert.equal(composeTitle("1", "word ".repeat(16)), null);
    assert.equal(composeTitle("1", "a".repeat(121)), null);
});

const section = (lead) =>
    `<a id="niv01"></a><div class="niv1tit">1</div><div class="niv1p">${lead} Le siècle commence.</div>`;

test("extractLead reads the bold run at the start of the first paragraph", () => {
    const html = section(
        '<span class="bold">Les deux XIX</span><sup><span class="bold">e</span></sup> <span class="bold">siècles.</span>',
    );
    assert.equal(extractLead(html, "1"), "Les deux XIXe siècles.");
});

test("extractLead reads strong and b elements", () => {
    assert.equal(extractLead(section("<strong>Titre.</strong>"), "1"), "Titre.");
    assert.equal(extractLead(section("<b>Titre.</b>"), "1"), "Titre.");
});

test("extractLead includes a closing quote placed after the bold run", () => {
    assert.equal(
        extractLead(section("<span class=\"bold\">« L'homme est ce qu'il mange</span> »."), "1"),
        "« L'homme est ce qu'il mange »",
    );
});

test("extractLead rejects a bold run placed after body text", () => {
    assert.equal(extractLead(section('Un préambule. <span class="bold">Titre.</span>'), "1"), null);
});

test("extractLead rejects a section without a lead", () => {
    assert.equal(extractLead(section("Pas de gras."), "1"), null);
    assert.equal(extractLead(section('<span class="notbold">Titre.</span>'), "1"), null);
});

test("extractLeads bounds each lead by the next anchor", () => {
    const epub = {
        spineHrefs: ["a.xhtml"],
        readText: () =>
            '<a id="one"></a><div class="niv1tit">1</div><div class="niv1p"><span class="bold">First.</span> Body.</div>' +
            '<a id="two"></a><div class="niv1tit">2</div><div class="niv1p"><span class="bold">Second.</span> Body.</div>',
    };
    const toc = [
        { title: "1", href: "a.xhtml#one" },
        { title: "2", href: "a.xhtml#two" },
    ];
    const leads = extractLeads(epub, toc);

    assert.equal(leads.get("a.xhtml#one"), "First.");
    assert.equal(leads.get("a.xhtml#two"), "Second.");
});

test("extractLeads ignores entries without an anchor", () => {
    const epub = {
        spineHrefs: ["a.xhtml"],
        readText: () => '<div class="niv1p"><span class="bold">Lead.</span> Body.</div>',
    };
    const toc = [{ title: "Introduction", href: "a.xhtml" }];

    assert.equal(extractLeads(epub, toc).size, 0);
});

test("enrichTitles only rewrites bare numeric titles", () => {
    const toc = [
        {
            title: "1",
            href: "a.xhtml#one",
            children: [{ title: "Introduction", href: "a.xhtml#intro" }],
        },
        { title: "2", href: "a.xhtml#two" },
    ];
    const leads = new Map([
        ["a.xhtml#one", "First."],
        ["a.xhtml#two", "2"],
    ]);
    const result = enrichTitles(toc, leads);

    assert.equal(result.toc[0].title, "1 - First");
    assert.equal(result.toc[0].children[0].title, "Introduction");
    assert.equal(result.toc[1].title, "2");
    assert.equal(result.enriched, 1);
    assert.equal(result.skipped, 1);
});

test("enriched titles drive the slug and path", () => {
    const toc = [
        { title: "1", href: "PL3.xhtml#niv01" },
        { title: "2", href: "PL3.xhtml#niv02" },
    ];
    const result = enrichTitles(toc, new Map([["PL3.xhtml#niv01", "Les deux XIXe siècles."]]));
    const annotated = annotateToc(result.toc);

    assert.equal(annotated[0].title, "1 - Les deux XIXe siècles");
    assert.equal(annotated[0].path, "1-1-les-deux-xixe-siecles");
});
