import assert from "node:assert/strict";
import { test } from "node:test";
import { directoryPathsOf, frontmatterFor, indexOutputPath, sectionOutputPath } from "../src/generate-markdown.js";
import { MARKDOWN_SCHEMA_VERSION } from "../src/schema.js";

const sections = (...paths) => paths.map((path) => ({ entry: { path } }));

test("directoryPathsOf finds the entries that own a directory", () => {
    const dirs = directoryPathsOf(
        sections("1-preface", "2-intro", "2-intro/1-sec", "3-part", "3-part/1-chap", "3-part/1-chap/01-sec"),
    );

    assert.deepEqual([...dirs].sort(), ["2-intro", "3-part", "3-part/1-chap"]);
});

test("directoryPathsOf does not confuse a prefix with a sibling", () => {
    assert.deepEqual([...directoryPathsOf(sections("foo", "foobar/x"))], []);
});

test("sectionOutputPath writes a leaf entry next to its siblings", () => {
    assert.equal(sectionOutputPath("/out", "1-preface", new Set()), "/out/1-preface.md");
});

test("sectionOutputPath writes a directory entry as 00-index.md", () => {
    assert.equal(sectionOutputPath("/out", "2-intro", new Set(["2-intro"])), "/out/2-intro/00-index.md");
});

test("indexOutputPath writes a parent entry as 00-index.md", () => {
    assert.equal(indexOutputPath("/out", "2-intro"), "/out/2-intro/00-index.md");
});

test("frontmatterFor puts the schema version first", () => {
    const frontmatter = frontmatterFor(
        { title: "Chapter One", path: "02-book-one/01-chapter-one", href: "book.xhtml#ch1" },
        "book.epub",
    );

    assert.equal(MARKDOWN_SCHEMA_VERSION, 1);
    assert.deepEqual(Object.keys(frontmatter), ["epub_to_markdown_schema", "title", "path", "href", "source"]);
    assert.equal(frontmatter.epub_to_markdown_schema, MARKDOWN_SCHEMA_VERSION);
});
