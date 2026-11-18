import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { ensureBookTitle, loadBookConfig, loadProjectConfig } from "../src/book-config.js";

const writeConfig = (content) => {
    const path = join(mkdtempSync(join(tmpdir(), "epub-to-markdown-")), "config.yaml");
    writeFileSync(path, content);
    return path;
};

test("loadBookConfig reads max_split_depth and defaults max_line_length to 120", () => {
    assert.deepEqual(loadBookConfig(writeConfig("max_split_depth: 3\n")), { maxSplitDepth: 3, maxLineLength: 120 });
});

test("loadBookConfig reads max_line_length", () => {
    assert.deepEqual(loadBookConfig(writeConfig("max_split_depth: 2\nmax_line_length: 80\n")), {
        maxSplitDepth: 2,
        maxLineLength: 80,
    });
});

test("loadBookConfig accepts max_line_length: 0 to disable wrapping", () => {
    assert.deepEqual(loadBookConfig(writeConfig("max_split_depth: 2\nmax_line_length: 0\n")), {
        maxSplitDepth: 2,
        maxLineLength: 0,
    });
});

test("loadBookConfig rejects a missing max_split_depth", () => {
    assert.throws(() => loadBookConfig(writeConfig("foo: 1\n")), /max_split_depth/);
});

test("loadBookConfig rejects an invalid max_split_depth", () => {
    assert.throws(() => loadBookConfig(writeConfig("max_split_depth: two\n")), /max_split_depth/);
    assert.throws(() => loadBookConfig(writeConfig("max_split_depth: 0\n")), /max_split_depth/);
});

test("loadBookConfig rejects an invalid max_line_length", () => {
    assert.throws(() => loadBookConfig(writeConfig("max_split_depth: 2\nmax_line_length: many\n")), /max_line_length/);
    assert.throws(() => loadBookConfig(writeConfig("max_split_depth: 2\nmax_line_length: -1\n")), /max_line_length/);
});

test("loadProjectConfig returns an empty object when the file is missing", () => {
    assert.deepEqual(loadProjectConfig(join(tmpdir(), "epub-to-markdown-missing.yaml")), {});
});

test("loadProjectConfig reads the top-level LLM settings", () => {
    assert.deepEqual(loadProjectConfig(writeConfig("model_id: deepseek-flash\nopenaiapi_endpoint: https://x\n")), {
        model_id: "deepseek-flash",
        openaiapi_endpoint: "https://x",
    });
});

test("ensureBookTitle inserts the title at the top when it is missing", () => {
    const path = writeConfig("max_split_depth: 2\nmax_line_length: 120\n");
    assert.equal(ensureBookTitle(path, "A Book"), true);
    assert.equal(readFileSync(path, "utf8"), "title: A Book\nmax_split_depth: 2\nmax_line_length: 120\n");
});

test("ensureBookTitle writes the title into an empty file", () => {
    const path = writeConfig("");
    assert.equal(ensureBookTitle(path, "A Book"), true);
    assert.equal(readFileSync(path, "utf8"), "title: A Book\n");
});

test("ensureBookTitle replaces an empty title", () => {
    const path = writeConfig('slug: mill\ntitle: ""\nmax_split_depth: 2\n');
    assert.equal(ensureBookTitle(path, "A Book"), true);
    const content = readFileSync(path, "utf8");
    assert.equal(parse(content).title, "A Book");
    assert.equal(parse(content).slug, "mill");
    assert.equal(content.match(/^title:/gm).length, 1);
});

test("ensureBookTitle replaces a null title", () => {
    const path = writeConfig("title:\nmax_split_depth: 2\n");
    assert.equal(ensureBookTitle(path, "A Book"), true);
    assert.equal(parse(readFileSync(path, "utf8")).title, "A Book");
});

test("ensureBookTitle replaces a whitespace-only title", () => {
    const path = writeConfig('title: "   "\nmax_split_depth: 2\n');
    assert.equal(ensureBookTitle(path, "A Book"), true);
    assert.equal(parse(readFileSync(path, "utf8")).title, "A Book");
});

test("ensureBookTitle keeps an existing non-empty title", () => {
    const original = "title: Keep me\nmax_split_depth: 2\n";
    const path = writeConfig(original);
    assert.equal(ensureBookTitle(path, "A Book"), false);
    assert.equal(readFileSync(path, "utf8"), original);
});

test("ensureBookTitle preserves comments and other keys", () => {
    const path = writeConfig("# Book settings\nslug: mill\nexclude:\n  - 01-contents.md\nmax_split_depth: 2 # split\n");
    assert.equal(ensureBookTitle(path, "A Book"), true);
    const content = readFileSync(path, "utf8");
    assert.match(content, /^title: A Book\n/);
    assert.match(content, /# Book settings/);
    assert.match(content, /exclude:\n {2}- 01-contents\.md/);
    assert.match(content, /max_split_depth: 2 # split/);
});

test("ensureBookTitle keeps a long title on one line", () => {
    const title =
        "Principles of Political Economy / Abridged with Critical, Bibliographical, and Explanatory Notes, and a Sketch of the History of Political Economy";
    const path = writeConfig("max_split_depth: 2\n");
    assert.equal(ensureBookTitle(path, title), true);
    assert.ok(readFileSync(path, "utf8").startsWith(`title: ${title}\n`));
});

test("ensureBookTitle does nothing when config.yaml is missing", () => {
    const path = join(mkdtempSync(join(tmpdir(), "epub-to-markdown-")), "config.yaml");
    assert.equal(ensureBookTitle(path, "A Book"), false);
    assert.equal(existsSync(path), false);
});

test("ensureBookTitle does nothing when the source title is empty", () => {
    const original = "max_split_depth: 2\n";
    const path = writeConfig(original);
    assert.equal(ensureBookTitle(path, ""), false);
    assert.equal(ensureBookTitle(path, "   "), false);
    assert.equal(readFileSync(path, "utf8"), original);
});

test("ensureBookTitle rejects a non-string title", () => {
    const path = writeConfig("title: 1984\nmax_split_depth: 2\n");
    assert.throws(() => ensureBookTitle(path, "A Book"), /title must be a string/);
});

test("ensureBookTitle rejects a config that is not a YAML mapping", () => {
    const path = writeConfig("- one\n- two\n");
    assert.throws(() => ensureBookTitle(path, "A Book"), /must contain a YAML mapping/);
});
