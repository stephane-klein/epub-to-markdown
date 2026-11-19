import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, posix, relative, resolve } from "node:path";
import { Listr, ListrLogger, ProcessOutput } from "listr2";
import { parse, stringify } from "yaml";
import { ensureBookTitle, loadBookConfig } from "./book-config.js";
import { readEpub } from "./epub.js";
import { collectFootnotes, createFootnoteTracker } from "./footnotes.js";
import { htmlToMarkdown } from "./markdown.js";
import { MARKDOWN_SCHEMA_VERSION } from "./schema.js";
import { splitIntoSections, stripLeadingTitle, stripRepeatedTitle } from "./split.js";

const clampHeadingLevel = (level) => Math.max(1, Math.min(6, level));

const sectionAnchor = (entry) => {
    const index = entry.href.indexOf("#");
    return index < 0 ? "" : entry.href.slice(index + 1);
};

const sectionTitle = (entry) => entry.title.replace(/\s+/g, " ").trim();

export const directoryPathsOf = (sections) => {
    const paths = sections.map((section) => section.entry.path);
    return new Set(paths.filter((path) => paths.some((other) => other.startsWith(`${path}/`))));
};

export const sectionOutputPath = (outputDir, entryPath, directoryPaths) =>
    directoryPaths.has(entryPath)
        ? resolve(outputDir, entryPath, "00-index.md")
        : resolve(outputDir, `${entryPath}.md`);

export const indexOutputPath = (outputDir, entryPath) => resolve(outputDir, entryPath, "00-index.md");

const headingLevelResolver = (entriesByAnchor, sectionDepth) => (node) => {
    let current = node;
    while (current?.nodeName) {
        const id = current.getAttribute ? current.getAttribute("id") : null;
        const entry = id ? entriesByAnchor.get(id) : null;
        if (entry) return clampHeadingLevel(1 + (entry.depth - sectionDepth));
        current = current.parentNode;
    }
    return null;
};

const imageResolver = (epub, images) => (src) => {
    const path = posix.join(epub.opfDir, decodeURIComponent(src));
    if (!epub.entries[path]) return null;
    if (!images.has(src)) {
        const name = posix.basename(src);
        const taken = new Set(images.values());
        images.set(src, taken.has(name) ? `${taken.size}-${name}` : name);
    }
    return `images/${images.get(src)}`;
};

export const frontmatterFor = (entry, source) => ({
    epub_to_markdown_schema: MARKDOWN_SCHEMA_VERSION,
    title: entry.title,
    path: entry.path,
    href: entry.href,
    source,
});

const writePage = async (outputPath, entry, markdown, source) => {
    const frontmatter = stringify(frontmatterFor(entry, source), { lineWidth: 0 });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `---\n${frontmatter}---\n\n${markdown}\n`);
};

const NOTES_TITLE = /^(notes?|footnotes?|endnotes?)$/i;

const documentOf = (href) => href.split("#")[0];

const indentContinuation = (text) =>
    text
        .split("\n")
        .map((line, index) => (index === 0 || line === "" ? line : `    ${line}`))
        .join("\n");

const footnoteRemover = (sections, removals) => {
    const notesDocuments = new Set(
        sections
            .filter((section) => NOTES_TITLE.test(sectionTitle(section.entry)))
            .map((section) => documentOf(section.entry.href)),
    );
    const ids = new Set();
    const classes = new Set();
    for (const removal of removals) {
        if (notesDocuments.has(removal.document)) continue;
        if (removal.id) ids.add(removal.id);
        if (removal.class) classes.add(removal.class);
    }
    if (ids.size === 0 && classes.size === 0) return undefined;
    return (node) => {
        const id = node.getAttribute("id");
        if (id && ids.has(id)) return true;
        const className = node.getAttribute("class");
        return Boolean(className) && classes.has(className);
    };
};

export const runGenerateMarkdown = async ({ epubPath }) => {
    const dir = dirname(epubPath);
    const source = basename(epubPath);
    const outputDir = resolve(dir, "markdown");
    const imagesDir = resolve(outputDir, "images");

    const configPath = resolve(dir, "config.yaml");
    const tocPath = resolve(dir, "toc.yaml");
    if (!existsSync(tocPath)) {
        throw new Error(`toc.yaml not found at ${tocPath}, run "epub-to-markdown generate-toc" first`);
    }
    if (!existsSync(configPath)) {
        throw new Error(`config.yaml not found at ${configPath}`);
    }

    const context = { images: new Map(), cleaned: 0, unmatched: 0 };

    const rendererOptions = {
        logger: new ListrLogger({ processOutput: new ProcessOutput(process.stderr, process.stderr) }),
        showErrorMessage: true,
        collapseErrors: false,
    };

    await new Listr(
        [
            {
                title: "Load config and table of contents",
                task: (_, task) => {
                    context.config = loadBookConfig(configPath);
                    const toc = parse(readFileSync(tocPath, "utf8"));
                    context.toc = toc.toc;
                    if (ensureBookTitle(configPath, toc.title)) {
                        task.output = "title written to config.yaml";
                    }
                    context.epub = readEpub(epubPath);
                },
            },
            {
                title: "Extract content sections",
                task: (_, task) => {
                    const documents = context.epub.spineHrefs.map((href) => ({
                        href,
                        html: context.epub.readText(href),
                    }));
                    const { sections, entriesByAnchor, indexEntries } = splitIntoSections({
                        toc: context.toc,
                        maxSplitDepth: context.config.maxSplitDepth,
                        documents,
                    });
                    context.footnotes = collectFootnotes({ documents });
                    context.removeElements = footnoteRemover(sections, context.footnotes.removals);
                    context.sections = sections;
                    context.indexEntries = indexEntries;
                    context.entriesByAnchor = entriesByAnchor;
                    task.title = `Extract content sections (${sections.length})`;
                },
            },
            {
                title: "Write markdown files",
                task: (_, task) => {
                    const directoryPaths = directoryPathsOf(context.sections);
                    const sectionTasks = context.sections.map((section) => ({
                        title: section.entry.path,
                        task: async (_, subtask) => {
                            const resolveImage = imageResolver(context.epub, context.images);
                            const footnotes = createFootnoteTracker(context.footnotes.references);
                            const stripped = stripRepeatedTitle(
                                stripLeadingTitle(section.html, sectionAnchor(section.entry), context.entriesByAnchor),
                                section.entry.title,
                            );
                            if (stripped.removed > 0) context.cleaned++;
                            else context.unmatched++;
                            const body = htmlToMarkdown(stripped.html, {
                                headingLevel: headingLevelResolver(context.entriesByAnchor, section.entry.depth),
                                imageResolver: resolveImage,
                                maxLineLength: context.config.maxLineLength,
                                footnotes,
                                removeElements: context.removeElements,
                            });
                            const definitions = footnotes.used.map(({ label, definitionHtml }) => {
                                const content = htmlToMarkdown(definitionHtml, {
                                    imageResolver: resolveImage,
                                    maxLineLength: 0,
                                });
                                return `[^${label}]: ${indentContinuation(content)}`;
                            });
                            let markdown = `# ${sectionTitle(section.entry)}\n\n${body}`.trimEnd();
                            if (definitions.length > 0) {
                                markdown += `\n\n${definitions.join("\n\n")}`;
                            }
                            const outputPath = sectionOutputPath(outputDir, section.entry.path, directoryPaths);
                            await writePage(outputPath, section.entry, markdown, source);
                            subtask.output = `written  ${relative(outputDir, outputPath)}`;
                        },
                    }));
                    const indexTasks = context.indexEntries.map((entry) => ({
                        title: entry.path,
                        task: async (_, subtask) => {
                            const outputPath = indexOutputPath(outputDir, entry.path);
                            await writePage(outputPath, entry, `# ${sectionTitle(entry)}`, source);
                            subtask.output = `written  ${relative(outputDir, outputPath)}`;
                        },
                    }));
                    return task.newListr([...sectionTasks, ...indexTasks], { concurrent: false });
                },
            },
            {
                title: "Extract images",
                task: async (_, task) => {
                    await Promise.all(
                        [...context.images].map(async ([src, name]) => {
                            await mkdir(imagesDir, { recursive: true });
                            await writeFile(resolve(imagesDir, name), context.epub.readBytes(src));
                        }),
                    );
                    task.title = `Extract images (${context.images.size})`;
                },
            },
        ],
        { exitOnError: false, rendererOptions },
    ).run();

    console.log(
        `Title cleanup: ${context.cleaned} sections cleaned, ${context.unmatched} sections without a matching title prefix`,
    );
};
