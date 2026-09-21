import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToMarkdown } from "../src/markdown.js";

test("htmlToMarkdown keeps the original heading levels by default", () => {
    assert.equal(htmlToMarkdown("<h2>Title</h2><p>Body</p>"), "## Title\n\nBody");
});

test("htmlToMarkdown uses the headingLevel callback", () => {
    const html = '<h2 data-level="1">A</h2><h3 data-level="2">B</h3>';
    const markdown = htmlToMarkdown(html, { headingLevel: (node) => Number(node.getAttribute("data-level")) });
    assert.equal(markdown, "# A\n\n## B");
});

test("htmlToMarkdown renders unmapped headings as plain text", () => {
    const html = '<h2 data-level="1">Real</h2><h5>Decorative</h5>';
    const markdown = htmlToMarkdown(html, {
        headingLevel: (node) => (node.getAttribute("data-level") ? Number(node.getAttribute("data-level")) : null),
    });
    assert.equal(markdown, "# Real\n\nDecorative");
});

test("htmlToMarkdown converts tables to GFM using the first row as header", () => {
    const html = "<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>";
    assert.equal(htmlToMarkdown(html), "| A | B |\n| --- | --- |\n| C | D |");
});

test("htmlToMarkdown escapes pipes inside table cells", () => {
    const html = "<table><tr><td>a|b</td></tr><tr><td>c</td></tr></table>";
    assert.equal(htmlToMarkdown(html), "| a\\|b |\n| --- |\n| c |");
});

test("htmlToMarkdown rewrites images through the resolver", () => {
    const html = '<p><img src="cover.png" alt="Cover" title="A title"></p>';
    const markdown = htmlToMarkdown(html, {
        imageResolver: (src) => (src === "cover.png" ? "images/cover.png" : null),
    });
    assert.equal(markdown, '![Cover](images/cover.png "A title")');
});

test("htmlToMarkdown drops images the resolver rejects", () => {
    const html = '<p><img src="missing.png" alt="Missing"></p>';
    assert.equal(htmlToMarkdown(html, { imageResolver: () => null }), "");
});

test("htmlToMarkdown hard wraps long paragraphs at 120 characters", () => {
    const paragraph = Array.from({ length: 60 }, () => "lorem").join(" ");
    const lines = htmlToMarkdown(`<p>${paragraph}</p>`).split("\n");
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(line.length <= 120, `line too long: ${line.length}`);
    assert.equal(lines.join(" "), paragraph);
});

test("htmlToMarkdown honours a custom maxLineLength", () => {
    const markdown = htmlToMarkdown("<p>alpha beta gamma delta epsilon</p>", { maxLineLength: 20 });
    for (const line of markdown.split("\n")) assert.ok(line.length <= 20, line);
});

test("htmlToMarkdown does not wrap when maxLineLength is 0", () => {
    const paragraph = Array.from({ length: 60 }, () => "word").join(" ");
    assert.equal(htmlToMarkdown(`<p>${paragraph}</p>`, { maxLineLength: 0 }), paragraph);
});

test("htmlToMarkdown leaves table rows on a single line", () => {
    const long = "x".repeat(200);
    const html = `<table><tr><td>${long}</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>`;
    const rows = htmlToMarkdown(html).split("\n");
    assert.equal(rows.length, 3);
    assert.ok(rows[0].length > 120);
});

test("htmlToMarkdown leaves fenced code blocks untouched", () => {
    const code = "a".repeat(200);
    const markdown = htmlToMarkdown(`<pre><code>${code}</code></pre>`);
    assert.ok(markdown.includes(code));
});

test("htmlToMarkdown indents wrapped list continuation lines", () => {
    const items = Array.from({ length: 40 }, () => "item").join(" ");
    const lines = htmlToMarkdown(`<ul><li>${items}</li></ul>`).split("\n");
    assert.ok(lines.length > 1);
    assert.ok(lines[0].startsWith("-"));
    for (const line of lines.slice(1)) assert.ok(line.startsWith("    "), `missing indent: ${line}`);
});
