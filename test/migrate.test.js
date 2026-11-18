import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyMigrations, runMigrate } from "../src/migrate.js";

const toc = `toc:
  - title: Contents
    path: 01-contents
    href: book.xhtml#c
  - title: Book One
    path: 02-book-one
    href: book.xhtml#b1
    children:
      - title: Chapter One
        path: 02-book-one/01-chapter-one
        href: book.xhtml#ch1
`;

const page = ({ title, path, ancestors, href, source = "book.epub" }, body) =>
    [
        "---",
        `title: ${title}`,
        `path: ${path}`,
        ...(ancestors ? ["ancestors:", ...ancestors.map((ancestor) => `  - ${ancestor}`)] : []),
        `href: ${href}`,
        `source: ${source}`,
        "---",
        "",
        body,
        "",
    ].join("\n");

const withSchema = (content, title, schema) =>
    schema ? content.replace(`title: ${title}`, `epub_to_markdown_schema: ${schema}\ntitle: ${title}`) : content;

const createBook = async ({ chapterAncestors = ["Book One"], schema } = {}) => {
    const bookDir = await mkdtemp(join(tmpdir(), "epub-to-markdown-migrate-"));
    await mkdir(join(bookDir, "markdown/02-book-one"), { recursive: true });
    await writeFile(join(bookDir, "config.yaml"), "title: Test Book\nmax_split_depth: 2\n");
    await writeFile(join(bookDir, "toc.yaml"), toc);
    await writeFile(
        join(bookDir, "markdown/01-contents.md"),
        withSchema(
            page({ title: "Contents", path: "01-contents", href: "book.xhtml#c" }, "# Contents\n\ncontents body"),
            "Contents",
            schema,
        ),
    );
    await writeFile(
        join(bookDir, "markdown/02-book-one/01-chapter-one.md"),
        withSchema(
            page(
                {
                    title: "Chapter One",
                    path: "02-book-one/01-chapter-one",
                    ancestors: chapterAncestors,
                    href: "book.xhtml#ch1",
                },
                "# Chapter One\n\nchapter body",
            ),
            "Chapter One",
            schema,
        ),
    );
    return bookDir;
};

const read = async (bookDir, path) => await readFile(join(bookDir, "markdown", path), "utf8");

test("runMigrate replaces ancestors with 00-index.md pages", async (t) => {
    const bookDir = await createBook();
    t.after(() => rm(bookDir, { recursive: true, force: true }));

    const summary = await runMigrate({ bookDir, quiet: true });

    assert.deepEqual(summary, { from: 0, to: 1, migrated: 2, created: 1, already: 0 });

    assert.equal(
        await read(bookDir, "02-book-one/00-index.md"),
        [
            "---",
            "epub_to_markdown_schema: 1",
            "title: Book One",
            "path: 02-book-one",
            "href: book.xhtml#b1",
            "source: book.epub",
            "---",
            "",
            "# Book One",
            "",
        ].join("\n"),
    );

    const chapter = await read(bookDir, "02-book-one/01-chapter-one.md");
    assert.match(chapter, /^---\nepub_to_markdown_schema: 1\ntitle: Chapter One\npath: /);
    assert.doesNotMatch(chapter, /ancestors/);
    assert.match(chapter, /# Chapter One\n\nchapter body\n$/);
});

test("runMigrate is idempotent", async (t) => {
    const bookDir = await createBook();
    t.after(() => rm(bookDir, { recursive: true, force: true }));

    await runMigrate({ bookDir, quiet: true });
    const before = await read(bookDir, "02-book-one/01-chapter-one.md");
    const summary = await runMigrate({ bookDir, quiet: true });

    assert.deepEqual(summary, { from: 1, to: 1, migrated: 0, created: 0, already: 3 });
    assert.equal(await read(bookDir, "02-book-one/01-chapter-one.md"), before);
});

test("runMigrate does not write with --dry-run", async (t) => {
    const bookDir = await createBook();
    t.after(() => rm(bookDir, { recursive: true, force: true }));

    const summary = await runMigrate({ bookDir, dryRun: true, quiet: true });

    assert.deepEqual(summary, { from: 0, to: 1, migrated: 2, created: 1, already: 0 });
    assert.equal(existsSync(join(bookDir, "markdown/02-book-one/00-index.md")), false);
    assert.match(await read(bookDir, "02-book-one/01-chapter-one.md"), /ancestors:/);
});

test("runMigrate repairs a v1 book with a missing index page", async (t) => {
    const bookDir = await createBook({ schema: 1, chapterAncestors: null });
    t.after(() => rm(bookDir, { recursive: true, force: true }));

    const summary = await runMigrate({ bookDir, quiet: true });

    assert.deepEqual(summary, { from: 1, to: 1, migrated: 0, created: 1, already: 2 });
    assert.match(await read(bookDir, "02-book-one/00-index.md"), /^---\nepub_to_markdown_schema: 1\n/);
});

test("runMigrate refuses an unknown newer schema", async (t) => {
    const bookDir = await createBook({ schema: 99 });
    t.after(() => rm(bookDir, { recursive: true, force: true }));

    await assert.rejects(() => runMigrate({ bookDir, quiet: true }), /supports 1/);
});

test("runMigrate refuses ancestors that disagree with toc.yaml", async (t) => {
    const bookDir = await createBook({ chapterAncestors: ["Wrong title"] });
    t.after(() => rm(bookDir, { recursive: true, force: true }));

    await assert.rejects(() => runMigrate({ bookDir, quiet: true }), /toc\.yaml says "Book One"/);
});

test("applyMigrations refuses a step that needs a re-render", () => {
    const state = {
        entriesByPath: new Map(),
        files: [{ relativePath: "01-contents.md", frontmatter: { epub_to_markdown_schema: 0 }, body: "" }],
    };

    assert.throws(
        () => applyMigrations(state, [{ from: 0, to: 1, kind: "regenerate", description: "New footnote rendering" }]),
        /changes the Markdown body/,
    );
});
