import assert from "node:assert/strict";
import { test } from "node:test";
import { directoryPathsOf, sectionOutputPath } from "../src/generate-markdown.js";

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
