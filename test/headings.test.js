import assert from "node:assert/strict";
import { test } from "node:test";
import { extractHeadings, headingHref } from "../src/headings.js";

const epub = {
    spineHrefs: ["a.xhtml", "b.xhtml"],
    readText: (href) =>
        ({
            "a.xhtml": '<h2 id="one">Chapter One</h2><p>x</p><h5>OF THE</h5><h3 id="two">Chapter <em>Two</em></h3>',
            "b.xhtml": '<h1 id="three">Chapter &amp; Three</h1>',
        })[href],
};

test("extractHeadings walks the spine in order and captures ids", () => {
    assert.deepEqual(extractHeadings(epub), [
        { order: 0, href: "a.xhtml", anchor: "one", level: 2, text: "Chapter One" },
        { order: 1, href: "a.xhtml", anchor: null, level: 5, text: "OF THE" },
        { order: 2, href: "a.xhtml", anchor: "two", level: 3, text: "Chapter Two" },
        { order: 3, href: "b.xhtml", anchor: "three", level: 1, text: "Chapter & Three" },
    ]);
});

test("headingHref builds the anchor href or falls back to the document", () => {
    assert.equal(headingHref({ href: "a.xhtml", anchor: "one" }), "a.xhtml#one");
    assert.equal(headingHref({ href: "a.xhtml", anchor: null }), "a.xhtml");
});
