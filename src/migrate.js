import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { parse, stringify } from "yaml";
import { MARKDOWN_SCHEMA_VERSION } from "./schema.js";
import { flattenToc } from "./split.js";

const LEGACY_SCHEMA_VERSION = 0;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n\n?/;

const normalizeTitle = (value) => value.replace(/\s+/g, " ").trim();

const pathOf = (file) => {
    const path = file.frontmatter?.path;
    if (typeof path === "string" && path.trim() !== "") return path.trim();
    return file.relativePath.replace(/\.md$/, "");
};

const versionOf = (frontmatter) => frontmatter?.epub_to_markdown_schema ?? LEGACY_SCHEMA_VERSION;

const serializePage = (file) => {
    const frontmatter = stringify(file.frontmatter, { lineWidth: 0 });
    const body = file.body.endsWith("\n") ? file.body : `${file.body}\n`;
    return `---\n${frontmatter}---\n\n${body}`;
};

const readPage = async (markdownDir, relativePath) => {
    const raw = await readFile(join(markdownDir, relativePath), "utf8");
    const match = raw.match(FRONTMATTER);
    if (!match) throw new Error(`missing frontmatter in markdown/${relativePath}`);

    const frontmatter = parse(match[1]) ?? {};
    if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
        throw new Error(`frontmatter must be a mapping in markdown/${relativePath}`);
    }

    return { relativePath, raw, frontmatter, body: raw.slice(match[0].length) };
};

const readPages = async (markdownDir) => {
    const fileNames = (await readdir(markdownDir, { recursive: true }))
        .filter((fileName) => fileName.endsWith(".md"))
        .sort();

    return await Promise.all(
        fileNames.map(async (fileName) => await readPage(markdownDir, fileName.split(sep).join("/"))),
    );
};

const assertSupportedSchema = (files) => {
    for (const file of files) {
        const version = versionOf(file.frontmatter);
        if (!Number.isInteger(version) || version < 0) {
            throw new Error(`invalid epub_to_markdown_schema in markdown/${file.relativePath}`);
        }
        if (version > MARKDOWN_SCHEMA_VERSION) {
            throw new Error(
                `markdown/${file.relativePath} uses schema ${version}, but this version of epub-to-markdown supports ${MARKDOWN_SCHEMA_VERSION}; upgrade epub-to-markdown`,
            );
        }
    }
};

const verifyAncestors = (file, entriesByPath) => {
    const ancestors = file.frontmatter.ancestors;
    if (ancestors === undefined) return;
    if (!Array.isArray(ancestors)) {
        throw new Error(`ancestors must be a list in markdown/${file.relativePath}`);
    }

    const segments = pathOf(file).split("/");
    if (ancestors.length > segments.length - 1) {
        throw new Error(
            `markdown/${file.relativePath} has ${ancestors.length} ancestors for ${segments.length - 1} parent directories`,
        );
    }

    ancestors.forEach((title, index) => {
        const path = segments.slice(0, index + 1).join("/");
        const entry = entriesByPath.get(path);
        if (!entry) {
            throw new Error(`no toc.yaml entry for "${path}" needed by markdown/${file.relativePath}`);
        }
        if (normalizeTitle(entry.title) !== normalizeTitle(title)) {
            throw new Error(
                `ancestors of markdown/${file.relativePath} say "${title}" for "${path}", but toc.yaml says "${entry.title}"; fix toc.yaml or regenerate the book`,
            );
        }
    });
};

const withSchemaFirst = (frontmatter) => {
    const rest = { ...frontmatter };
    delete rest.ancestors;
    delete rest.epub_to_markdown_schema;
    return { epub_to_markdown_schema: MARKDOWN_SCHEMA_VERSION, ...rest };
};

const bookSource = (files) =>
    files.map((file) => file.frontmatter.source).find((source) => typeof source === "string" && source.trim() !== "");

const indexPage = (entry, source) => ({
    relativePath: `${entry.path}/00-index.md`,
    raw: null,
    frontmatter: {
        epub_to_markdown_schema: MARKDOWN_SCHEMA_VERSION,
        title: entry.title,
        path: entry.path,
        href: entry.href,
        ...(source ? { source } : {}),
    },
    body: `# ${normalizeTitle(entry.title)}\n`,
});

const ensureIndexPages = (state) => {
    const files = state.files.map((file) => ({ ...file, frontmatter: withSchemaFirst(file.frontmatter) }));
    const existingPaths = new Set(files.map((file) => pathOf(file)));
    const source = bookSource(files);
    const created = new Map();

    for (const file of files) {
        const segments = pathOf(file).split("/");
        for (let index = 1; index < segments.length; index++) {
            const path = segments.slice(0, index).join("/");
            if (existingPaths.has(path) || created.has(path)) continue;
            const entry = state.entriesByPath.get(path);
            if (!entry) {
                throw new Error(`no toc.yaml entry for "${path}" needed by markdown/${file.relativePath}`);
            }
            if (!entry.hasChildren) {
                throw new Error(
                    `toc.yaml entry "${path}" has no children but markdown/${file.relativePath} uses it as a parent`,
                );
            }
            if (typeof entry.href !== "string" || entry.href.trim() === "") {
                throw new Error(`toc.yaml entry "${path}" has no href`);
            }
            created.set(path, indexPage(entry, source));
        }
    }

    return { ...state, files: [...files, ...created.values()] };
};

const migrateV0ToV1 = (state) => ensureIndexPages(state);

export const MIGRATIONS = [
    {
        from: 0,
        to: 1,
        kind: "files",
        description: "Replace the ancestors frontmatter with 00-index.md pages",
        apply: migrateV0ToV1,
    },
];

// Applies the file-only migration chain from the version of the book to the
// latest one. A step that changes the Markdown body cannot run here: it would
// need the EPUB and a full re-render, so the command stops and points to
// generate-markdown.
export const applyMigrations = (state, migrations = MIGRATIONS, target = MARKDOWN_SCHEMA_VERSION) => {
    let version = Math.min(...state.files.map((file) => versionOf(file.frontmatter)));
    let current = state;

    while (version < target) {
        const step = migrations.find((migration) => migration.from === version);
        if (!step) throw new Error(`no migration from schema ${version} to ${version + 1}`);
        if (step.kind !== "files") {
            throw new Error(
                `schema ${step.from} -> ${step.to} changes the Markdown body and cannot be migrated in place (${step.description}); run "epub-to-markdown generate-markdown" on the book EPUB instead`,
            );
        }
        current = step.apply(current);
        version = step.to;
    }

    return current;
};

const ensureLatest = (state) => {
    if (MARKDOWN_SCHEMA_VERSION === 1) return ensureIndexPages(state);
    return state;
};

const resolveBookDir = (path) => {
    const absolute = resolve(path);
    return absolute.endsWith(".epub") ? dirname(absolute) : absolute;
};

export const runMigrate = async ({ bookDir: path, dryRun = false, quiet = false }) => {
    const bookDir = resolveBookDir(path);
    const configPath = join(bookDir, "config.yaml");
    const tocPath = join(bookDir, "toc.yaml");
    const markdownDir = join(bookDir, "markdown");

    if (!existsSync(configPath)) throw new Error(`config.yaml not found at ${configPath}`);
    if (!existsSync(tocPath)) throw new Error(`toc.yaml not found at ${tocPath}`);
    if (!existsSync(markdownDir)) throw new Error(`markdown/ not found at ${markdownDir}`);

    const toc = parse(readFileSync(tocPath, "utf8"))?.toc;
    if (!Array.isArray(toc)) throw new Error(`toc must be a list in ${tocPath}`);

    const entries = flattenToc(toc);
    const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
    const files = await readPages(markdownDir);
    if (files.length === 0) throw new Error(`no Markdown file found under ${markdownDir}`);

    assertSupportedSchema(files);
    for (const file of files) verifyAncestors(file, entriesByPath);

    const from = Math.min(...files.map((file) => versionOf(file.frontmatter)));
    const state = { entriesByPath, files };
    const nextState = from < MARKDOWN_SCHEMA_VERSION ? applyMigrations(state) : ensureLatest(state);

    const initialByPath = new Map(files.map((file) => [file.relativePath, file.raw]));
    let changed = 0;
    let created = 0;

    for (const file of nextState.files) {
        const content = serializePage(file);
        const previous = initialByPath.get(file.relativePath);

        if (previous === undefined) {
            created += 1;
        } else if (previous === content) {
            continue;
        } else {
            changed += 1;
        }

        if (!dryRun) {
            const outputPath = join(markdownDir, ...file.relativePath.split("/"));
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, content);
        }
    }

    const summary = {
        from,
        to: MARKDOWN_SCHEMA_VERSION,
        migrated: changed,
        created,
        already: files.length - changed,
    };

    if (!quiet) {
        const prefix = dryRun ? "would " : "";
        console.log(`schema ${summary.from} -> ${summary.to}${dryRun ? " (dry run)" : ""}`);
        console.log(`  ${prefix}migrate ${summary.migrated} file(s)`);
        console.log(`  ${prefix}create ${summary.created} 00-index.md page(s)`);
        console.log(`  ${summary.already} file(s) already up to date`);
    }

    return summary;
};
