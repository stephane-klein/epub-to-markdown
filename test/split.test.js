import assert from "node:assert/strict";
import { test } from "node:test";
import { splitIntoSections, stripLeadingTitle } from "../src/split.js";

const toc = [
    { title: "Contents", path: "01-contents", href: "book.xhtml#c" },
    {
        title: "Book One",
        path: "02-book-one",
        href: "book.xhtml#b1",
        children: [
            {
                title: "Chapter One",
                path: "02-book-one/01-chapter-one",
                href: "book.xhtml#ch1",
                children: [
                    { title: "Section A", path: "02-book-one/01-chapter-one/1-section-a", href: "book.xhtml#sa" },
                ],
            },
            { title: "Chapter Two", path: "02-book-one/02-chapter-two", href: "book.xhtml#ch2" },
        ],
    },
    { title: "Appendix", path: "03-appendix", href: "book.xhtml#app" },
];

const documents = [
    {
        href: "book.xhtml",
        html: [
            '<div id="c"><h1>Contents</h1><p>contents body</p></div>',
            '<div id="b1"><h1>Book One</h1><p>book intro</p>',
            '<div id="ch1"><h2>Chapter One</h2><p>chapter one body</p>',
            '<div id="sa"><h3>Section A</h3><p>section a body</p></div></div>',
            '<div id="ch2"><h2>Chapter Two</h2><p>chapter two body</p></div></div>',
            '<div id="app"><h1>Appendix</h1><p>appendix body</p></div>',
        ].join(""),
    },
];

const paths = (sections) => sections.map((section) => section.entry.path);

test("splitIntoSections splits at depth == max and at shallower leaves", () => {
    const { sections } = splitIntoSections({ toc, maxSplitDepth: 2, documents });
    assert.deepEqual(paths(sections), [
        "01-contents",
        "02-book-one/01-chapter-one",
        "02-book-one/02-chapter-two",
        "03-appendix",
    ]);
});

test("splitIntoSections folds deeper entries into their split ancestor", () => {
    const { sections } = splitIntoSections({ toc, maxSplitDepth: 2, documents });
    const chapter = sections.find((section) => section.entry.path === "02-book-one/01-chapter-one");
    assert.match(chapter.html, /id="ch1"/);
    assert.match(chapter.html, /id="sa"/);
});

test("splitIntoSections drops the body of a parent entry", () => {
    const { sections } = splitIntoSections({ toc, maxSplitDepth: 2, documents });
    assert.ok(!sections.some((section) => section.html.includes('id="b1"')));
    assert.ok(!sections.some((section) => section.html.includes("book intro")));
});

test("splitIntoSections records ancestor titles", () => {
    const { sections } = splitIntoSections({ toc, maxSplitDepth: 2, documents });
    const chapter = sections.find((section) => section.entry.path === "02-book-one/01-chapter-one");
    assert.deepEqual(chapter.entry.ancestors, ["Book One"]);
    const contents = sections.find((section) => section.entry.path === "01-contents");
    assert.deepEqual(contents.entry.ancestors, []);
});

test("splitIntoSections with maxSplitDepth 1 folds everything under the top level", () => {
    const { sections } = splitIntoSections({ toc, maxSplitDepth: 1, documents });
    assert.deepEqual(paths(sections), ["01-contents", "02-book-one", "03-appendix"]);
    const book = sections.find((section) => section.entry.path === "02-book-one");
    assert.match(book.html, /id="ch1"/);
    assert.match(book.html, /id="sa"/);
});

test("splitIntoSections with maxSplitDepth 3 drops intermediate parents", () => {
    const { sections } = splitIntoSections({ toc, maxSplitDepth: 3, documents });
    assert.deepEqual(paths(sections), [
        "01-contents",
        "02-book-one/01-chapter-one/1-section-a",
        "02-book-one/02-chapter-two",
        "03-appendix",
    ]);
    const section = sections.find((s) => s.entry.path.endsWith("1-section-a"));
    assert.deepEqual(section.entry.ancestors, ["Book One", "Chapter One"]);
});

test("splitIntoSections appends a file prefix to the previous section", () => {
    const continuation = [{ href: "book2.xhtml", html: "<p>continued appendix</p>" }];
    const { sections } = splitIntoSections({ toc, maxSplitDepth: 2, documents: [...documents, ...continuation] });
    const appendix = sections.find((section) => section.entry.path === "03-appendix");
    assert.match(appendix.html, /continued appendix/);
});

test("splitIntoSections indexes entries by anchor", () => {
    const { entriesByAnchor } = splitIntoSections({ toc, maxSplitDepth: 2, documents });
    assert.equal(entriesByAnchor.get("ch1").path, "02-book-one/01-chapter-one");
    assert.equal(entriesByAnchor.get("sa").depth, 3);
});

test("stripLeadingTitle removes the section heading and its non-entry fragments", () => {
    const html = '<h3 id="chap">CHAP. I.</h3>\n<h4 id="div">OF THE DIVISION OF LABOUR.</h4>\n<p>body</p>';
    const entriesByAnchor = new Map([["chap", { depth: 2 }]]);

    assert.equal(stripLeadingTitle(html, "chap", entriesByAnchor), "<p>body</p>");
});

test("stripLeadingTitle stops at the first subsection entry", () => {
    const html = '<h2 id="book">BOOK I.</h2>\n<h3 id="chap">CHAP. I.</h3>\n<p>body</p>';
    const entriesByAnchor = new Map([
        ["book", { depth: 1 }],
        ["chap", { depth: 2 }],
    ]);

    assert.equal(stripLeadingTitle(html, "book", entriesByAnchor), '<h3 id="chap">CHAP. I.</h3>\n<p>body</p>');
});

test("stripLeadingTitle skips hr elements between title fragments", () => {
    const html = '<h2 id="a">WEALTH OF NATIONS.</h2>\n<hr/>\n<h4 id="b">INTRODUCTION.</h4>\n<p>body</p>';
    const entriesByAnchor = new Map([["a", { depth: 1 }]]);

    assert.equal(stripLeadingTitle(html, "a", entriesByAnchor), "<p>body</p>");
});

test("stripLeadingTitle leaves the html untouched when it does not start with a heading", () => {
    const html = "<p>body</p>";
    assert.equal(stripLeadingTitle(html, "x", new Map()), html);
});

test("stripLeadingTitle removes a heading wrapped in the section element", () => {
    const html = '<div class="niv1" id="sec">\n  <h2>Les modes</h2>\n  <p>body</p>\n</div>';
    const entriesByAnchor = new Map([["sec", { depth: 1 }]]);

    assert.equal(stripLeadingTitle(html, "sec", entriesByAnchor), '<div class="niv1" id="sec">\n  <p>body</p>\n</div>');
});

test("stripLeadingTitle removes a heading placed after an empty anchor", () => {
    const html = '<a id="sec"></a>\n<h2>Title</h2>\n<p>body</p>';
    const entriesByAnchor = new Map([["sec", { depth: 1 }]]);

    assert.equal(stripLeadingTitle(html, "sec", entriesByAnchor), '<a id="sec"></a>\n<p>body</p>');
});

test("stripLeadingTitle keeps the html when body text precedes the first heading", () => {
    const html = "<p>intro</p>\n<h2>Title</h2>\n<p>body</p>";
    assert.equal(stripLeadingTitle(html, "x", new Map()), html);
});

test("splitIntoSections splits a document-level leaf entry", () => {
    const documentToc = [{ title: "Préface", path: "1-preface", href: "a.xhtml" }];
    const documentDocuments = [{ href: "a.xhtml", html: "<h1>Préface</h1><p>preface body</p>" }];

    const { sections } = splitIntoSections({ toc: documentToc, maxSplitDepth: 2, documents: documentDocuments });

    assert.deepEqual(paths(sections), ["1-preface"]);
    assert.match(sections[0].html, /preface body/);
});

test("splitIntoSections gives a document-level parent its preamble and keeps the child separate", () => {
    const documentToc = [
        {
            title: "Introduction",
            path: "2-introduction",
            href: "a.xhtml",
            children: [{ title: "Section One", path: "2-introduction/1-section-one", href: "a.xhtml#s1" }],
        },
    ];
    const documentDocuments = [
        {
            href: "a.xhtml",
            html: '<h1>Introduction</h1><p>intro preamble</p><div id="s1"><h2>Section One</h2><p>section body</p></div>',
        },
    ];

    const { sections } = splitIntoSections({ toc: documentToc, maxSplitDepth: 2, documents: documentDocuments });

    assert.deepEqual(paths(sections), ["2-introduction", "2-introduction/1-section-one"]);
    assert.match(sections[0].html, /intro preamble/);
    assert.doesNotMatch(sections[0].html, /section body/);
    assert.match(sections[1].html, /section body/);
});

test("splitIntoSections splits a title-only document-level parent", () => {
    const documentToc = [
        {
            title: "Part One",
            path: "3-part-one",
            href: "part.xhtml",
            children: [{ title: "Chapter One", path: "3-part-one/1-chapter-one", href: "chapter.xhtml#c1" }],
        },
    ];
    const documentDocuments = [
        { href: "part.xhtml", html: "<h1>Part One</h1>" },
        { href: "chapter.xhtml", html: '<h2 id="c1">Chapter One</h2><p>chapter body</p>' },
    ];

    const { sections } = splitIntoSections({ toc: documentToc, maxSplitDepth: 2, documents: documentDocuments });

    assert.deepEqual(paths(sections), ["3-part-one", "3-part-one/1-chapter-one"]);
    assert.match(sections[0].html, /Part One/);
});

test("splitIntoSections merges a heading-only parent into its only child", () => {
    const fragmentToc = [
        {
            title: "LIFE AND WRITINGS",
            path: "06-life-and-writings",
            href: "book.xhtml#life",
            children: [
                {
                    title: "DR. ADAM SMITH",
                    path: "06-life-and-writings/1-dr-adam-smith",
                    href: "book.xhtml#smith",
                },
            ],
        },
        { title: "Next", path: "07-next", href: "book.xhtml#next" },
    ];
    const fragmentDocuments = [
        {
            href: "book.xhtml",
            html: [
                '<div id="life"><h2>LIFE AND WRITINGS</h2><h5>OF</h5>',
                '<div id="smith"><h3>DR. ADAM SMITH</h3><p>biography</p></div></div>',
                '<div id="next"><h1>Next</h1><p>next body</p></div>',
            ].join(""),
        },
    ];

    const { sections } = splitIntoSections({ toc: fragmentToc, maxSplitDepth: 2, documents: fragmentDocuments });

    assert.deepEqual(paths(sections), ["06-life-and-writings", "07-next"]);
    const [merged] = sections;
    assert.equal(merged.entry.title, "LIFE AND WRITINGS OF DR. ADAM SMITH");
    assert.equal(merged.entry.path, "06-life-and-writings");
    assert.deepEqual(merged.entry.ancestors, []);
    assert.match(merged.html, /id="life"/);
    assert.match(merged.html, /id="smith"/);
    assert.match(merged.html, /biography/);
});

test("splitIntoSections keeps a parent with content as its own dropped section", () => {
    const contentParentToc = [
        {
            title: "CONTENTS",
            path: "01-contents",
            href: "book.xhtml#contents",
            children: [
                {
                    title: "SHORT ACCOUNT",
                    path: "01-contents/1-short-account",
                    href: "book.xhtml#short",
                },
            ],
        },
    ];
    const contentParentDocuments = [
        {
            href: "book.xhtml",
            html: [
                '<div id="contents"><h2>CONTENTS</h2><table><tr><td>Life of the Author</td></tr></table></div>',
                '<div id="short"><h3>SHORT ACCOUNT</h3><p>body</p></div>',
            ].join(""),
        },
    ];

    const { sections } = splitIntoSections({
        toc: contentParentToc,
        maxSplitDepth: 2,
        documents: contentParentDocuments,
    });

    assert.deepEqual(paths(sections), ["01-contents/1-short-account"]);
    assert.equal(sections[0].entry.title, "SHORT ACCOUNT");
    assert.deepEqual(sections[0].entry.ancestors, ["CONTENTS"]);
});

test("splitIntoSections does not merge a parent with several children", () => {
    const twoChildrenToc = [
        {
            title: "LIFE AND WRITINGS",
            path: "06-life-and-writings",
            href: "book.xhtml#life",
            children: [
                { title: "ONE", path: "06-life-and-writings/1-one", href: "book.xhtml#one" },
                { title: "TWO", path: "06-life-and-writings/2-two", href: "book.xhtml#two" },
            ],
        },
    ];
    const twoChildrenDocuments = [
        {
            href: "book.xhtml",
            html: [
                '<div id="life"><h2>LIFE AND WRITINGS</h2></div>',
                '<div id="one"><h3>ONE</h3><p>one</p></div>',
                '<div id="two"><h3>TWO</h3><p>two</p></div>',
            ].join(""),
        },
    ];

    const { sections } = splitIntoSections({
        toc: twoChildrenToc,
        maxSplitDepth: 2,
        documents: twoChildrenDocuments,
    });

    assert.deepEqual(paths(sections), ["06-life-and-writings/1-one", "06-life-and-writings/2-two"]);
    assert.deepEqual(
        sections.map((section) => section.entry.title),
        ["ONE", "TWO"],
    );
});
