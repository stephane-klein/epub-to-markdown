import assert from "node:assert/strict";
import { test } from "node:test";
import { collectFootnotes, createFootnoteTracker } from "../src/footnotes.js";
import { htmlToMarkdown } from "../src/markdown.js";

const b3 = [
    {
        href: "Text/chap.html",
        html: `<body>
<p>Hello <a class="apnb" href="../Text/chap.html#ntb-12" id="ap_ntb-12-1">12</a> world.</p>
<div class="ntb" id="ntb-12"><p><a href="../Text/chap.html#ap_ntb-12-1">12</a>. La note.</p></div>
</body>`,
    },
];

const b1 = [
    {
        href: "h-8.htm.xhtml",
        html: '<body><p>instructions<a id="FNanchor_47_47"/><a class="fnanchor" href="h-11.htm.xhtml#Footnote_47_47">[47]</a> which were given</p></body>',
    },
    {
        href: "h-11.htm.xhtml",
        html: '<body><div class="footnote"><p><a id="Footnote_47_47"/><a href="h-8.htm.xhtml#FNanchor_47_47">[47]</a> They are to be found in Tyrol.</p></div></body>',
    },
];

const b4 = [
    {
        href: "doc.xhtml",
        html: `<body>
<p>text <a class="note" href="#no1" id="re1no1">[1]</a> .</p>
<div class="notes"><hr/><h2>Notes</h2><p><a class="no_note" href="#re1no1" id="no1">[1] <span class="no_chr">↑</span></a><span>Note content.</span></p></div>
</body>`,
    },
];

const b5 = [
    { href: "h-6.xhtml", html: '<body><p>Soetbeer,<a href="h-12.xhtml#note_230" id="noteref_230">230</a></p></body>' },
    {
        href: "h-12.xhtml",
        html: '<body><dl class="tei-list-footnotes"><dt class="tei-notelabel"><a href="h-6.xhtml#noteref_230" id="note_230">230.</a></dt><dd class="tei-notetext">Note text.</dd></dl></body>',
    },
];

test("collectFootnotes extracts a same-document container note", () => {
    const { references, removals } = collectFootnotes({ documents: b3 });
    const note = references.get("../Text/chap.html#ntb-12");

    assert.equal(references.size, 1);
    assert.equal(note.label, "12");
    assert.match(note.definitionHtml, /La note\./);
    assert.ok(!note.definitionHtml.includes("ap_ntb-12-1"));
    assert.deepEqual(removals, [{ document: "Text/chap.html", id: "ntb-12", class: "ntb" }]);
});

test("collectFootnotes pairs an identifier anchor with its sibling link", () => {
    const { references, removals } = collectFootnotes({ documents: b1 });
    const note = references.get("h-11.htm.xhtml#Footnote_47_47");

    assert.equal(references.size, 1);
    assert.equal(note.label, "47");
    assert.match(note.definitionHtml, /They are to be found in Tyrol\./);
    assert.deepEqual(removals, [{ document: "h-11.htm.xhtml", id: null, class: "footnote" }]);
});

test("collectFootnotes extracts a note whose back-link carries the identifier", () => {
    const { references, removals } = collectFootnotes({ documents: b4 });
    const note = references.get("#no1");

    assert.equal(references.size, 1);
    assert.equal(note.label, "1");
    assert.match(note.definitionHtml, /Note content\./);
    assert.deepEqual(removals, [{ document: "doc.xhtml", id: null, class: "notes" }]);
});

test("collectFootnotes reads a definition list definition term", () => {
    const { references, removals } = collectFootnotes({ documents: b5 });
    const note = references.get("h-12.xhtml#note_230");

    assert.equal(references.size, 1);
    assert.equal(note.label, "230");
    assert.match(note.definitionHtml, /Note text\./);
    assert.deepEqual(removals, [{ document: "h-12.xhtml", id: null, class: "tei-list-footnotes" }]);
});

test("createFootnoteTracker replaces a reference with its footnote label", () => {
    const references = new Map([["#no1", { label: "1", definitionHtml: "Note." }]]);
    const footnotes = createFootnoteTracker(references);
    const markdown = htmlToMarkdown('<p>text <a class="note" href="#no1" id="re1no1">[1]</a>.</p>', { footnotes });

    assert.equal(markdown, "text [^1].");
    assert.deepEqual(footnotes.used, [{ label: "1", definitionHtml: "Note." }]);
});

test("createFootnoteTracker disambiguates labels reused in the same file", () => {
    const references = new Map([
        ["#no1", { label: "1", definitionHtml: "One." }],
        ["#no2", { label: "1", definitionHtml: "Two." }],
    ]);
    const footnotes = createFootnoteTracker(references);
    const markdown = htmlToMarkdown('<p><a href="#no1" id="re1">[1]</a> <a href="#no2" id="re2">[1]</a></p>', {
        footnotes,
    });

    assert.equal(markdown, "[^1] [^1-2]");
    assert.deepEqual(
        footnotes.used.map((note) => note.label),
        ["1", "1-2"],
    );
});

test("htmlToMarkdown drops footnote definition blocks through removeElements", () => {
    const html = '<p>body</p><div class="notes"><p>a note</p></div>';
    const markdown = htmlToMarkdown(html, {
        removeElements: (node) => node.getAttribute("class") === "notes",
    });

    assert.equal(markdown, "body");
});
