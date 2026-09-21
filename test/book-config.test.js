import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadBookConfig, loadProjectConfig } from "../src/book-config.js";

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
