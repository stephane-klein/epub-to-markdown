# epub-to-markdown

The *epub-to-markdown* CLI generates Markdown files from [EPUB](https://en.wikipedia.org/wiki/EPUB) book source files.

I use it to search through the content of books of all kinds. I also use it to feed that corpus into a RAG.

## AI usage in this project

This project was developed using:

- Harness: [OpenCode](https://opencode.ai)
- Models: [DeepSeek-V4.1-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) via [OpenCode Go](https://opencode.ai/go)
- I mostly vibe coded this project: I made the implementation, library and architecture choices, but I reviewed the code very little.

## Requirements

- Node.js 22 or later.

## Install

The package is published on npmjs as `@stephane-klein/epub-to-markdown`.
Install it globally to get the `epub-to-markdown` command on your `PATH`:

```sh
$ npm install -g @stephane-klein/epub-to-markdown
```

Or run it without installing it, with `npx`:

```sh
$ npx @stephane-klein/epub-to-markdown generate-toc contents/my-book/my-book.epub
```

Run `epub-to-markdown --help` to list the available commands:

```sh
$ epub-to-markdown --help
<command>

Commands:
  generate-toc <epub>       Generate a toc.yaml file with the table of contents
                            of an EPUB file
  generate-markdown <epub>  Split the EPUB content into Markdown files following
                            config.yaml
  migrate <book>            Upgrade a book Markdown corpus to the latest schema
  doctor                    Check the runtime and the LLM access
  completion                Generate a shell completion script for bash or zsh

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

## Getting started

**1. Create `epub-to-markdown.yaml`** with the LLM settings. The example below
uses [OpenCode Go](https://opencode.ai/en/go), an OpenAI-compatible API:

```yaml
model_id: "mimo-v2.5"
openaiapi_endpoint: "https://opencode.ai/zen/go/v1/chat/completions"
x_opencode_session: "epub-to-markdown/0.1"
reasoning: "low"
```

`model_id` and `openaiapi_endpoint` are not specific to OpenCode Go — point them
at any OpenAI-compatible provider. The other settings are documented below.

**2. Provide your API key** through the `OPENAI_API_KEY` environment variable, or
pass it with `--api-key`:

```sh
$ export OPENAI_API_KEY="sk-…"
```

**3. Check the setup** with `doctor` and fix every `error` (a `warn` is fine):

```sh
$ epub-to-markdown doctor
```

**4. Generate the table of contents** of your book:

```sh
$ epub-to-markdown generate-toc contents/my-book/my-book.epub
```

The command also creates `config.yaml` next to the EPUB when it is missing.

**5. Generate the Markdown files**:

```sh
$ epub-to-markdown generate-markdown contents/my-book/my-book.epub
```

The behaviour of each command is documented in the sections below.

## Generate the table of contents

```bash
$ epub-to-markdown generate-toc contents/my-book/my-book.epub
```

The command writes a `toc.yaml` file next to the EPUB file. It reads the EPUB 3
navigation document when present and falls back to the EPUB 2 NCX file, so it
works with both EPUB versions. When `config.yaml` is missing next to the EPUB,
the command creates it with the book title and `max_split_depth: 2` (with
`--llm`, the model proposes the depth; see below). When the file exists without
a `title`, the command writes the title into it.

Each entry has a `title`, a `slug` derived from the title, a `path` made of the
parent slugs and the entry slug, and the `href` to the source document:

```yaml
toc:
  - title: Book I. Production.
    slug: 04-book-i-production
    path: 04-book-i-production
    href: OEBPS/book-i.xhtml#pgepubid00006
    children:
      - title: Chapter I. Of The Requisites Of Production.
        slug: 01-chapter-i-of-the-requisites-of-production
        path: 04-book-i-production/01-chapter-i-of-the-requisites-of-production
        href: OEBPS/book-i.xhtml#pgepubid00007
```

## Review the table of contents with an LLM

Some EPUB navigation documents are messy: a single title is split across
several headings, entries are duplicated, or title-page artifacts show up as
sections. The optional `--llm` flag sends a compact dossier (the metadata, the
current table of contents and every heading in reading order — never the book
body) to an OpenAI-compatible model, which returns a corrected table of
contents. Headings are referenced by short ids, so no file path is sent. The
review also normalises the titles to a consistent, readable style (sentence
case, `Chap. I - Of the division of labour`).

```bash
$ epub-to-markdown generate-toc contents/my-book/my-book.epub --llm
```

The deterministic table of contents is always written to `toc.raw.yaml`, and the
reviewed one to `toc.yaml`. The reviewed tree is validated before being written:
every `id` must reference a known heading, entries cannot be duplicated and they
must follow the reading order. The reading order comes from the navigation
document, not from the spine, because some EPUBs declare a spine that differs
from the logical order. On failure `toc.yaml` is left untouched.

When `generate-toc --llm` creates `config.yaml`, the model also proposes
`max_split_depth`: the depth whose entries make coherent reading units, usually
the chapter level. The value is bounded by the depth of the reviewed tree. When
it is missing or invalid, the command uses `2`, also bounded by that depth. An
existing `max_split_depth` is never overwritten.

After the review, the command also promotes the bold lead of numbered sections.
When the reviewed title is only a number and the section starts with a bold
phrase, the phrase becomes the subtitle: `1 - Les deux XIXe siècles`. The lead
is kept verbatim, minus one trailing sentence period. Titles that already
contain text are left untouched, as are sections without a bold lead. Because
the subtitle is part of the title, the generated `slug` and `path` include it
(`1-introduction/01-1-les-deux-xixe-siecles`).

Some navigation documents list only the chapter files, while those files contain
numbered sections with their own anchors. After the review, the command also
discovers those sections and adds them as children of the matching chapter
entry. The discovery targets the `nivNN` anchors followed by a `div.niv1tit`
block, a structure found in some Hachette EPUBs. The sections then become their
own Markdown files at the depth chosen by `max_split_depth`.

The model, endpoint and API key come from the command line flags (`--model`,
`--endpoint`, `--api-key`, `--session`, `--retry-delays`,
`--max-output-tokens`), the environment, or the project configuration file
`epub-to-markdown.yaml` (override it with `--config` or `EPUB_TO_MD_CONFIG`):

```yaml
model_id: "mimo-v2.5"
openaiapi_endpoint: "https://opencode.ai/zen/go/v1/chat/completions"
x_opencode_session: "epub-to-markdown/0.1"
reasoning: "low"
```

`reasoning` (`--reasoning <level>`, default `low`) controls the reasoning
effort. Use `--no-reasoning` to turn it off: on DeepSeek it sends
`thinking: {"type": "disabled"}`, which removes the reasoning tokens and most of
the cost.

This file only holds the LLM settings. The per-book `config.yaml` next to the
EPUB keeps controlling the split granularity.

The API key stays a secret: pass it with `--api-key` or export
`OPENAI_API_KEY` (or `EPUB_TO_MD_API_KEY`).

`toc.yaml` records the model, the token usage and the estimated cost under an
`llm:` key.

## Check the setup

```bash
$ epub-to-markdown doctor
```

`doctor` checks Node.js, the configuration file, the model, the endpoint and the
API key, reports the pricing and runs a minimal LLM request (`--no-llm` to skip
it).

## Generate the Markdown files

`generate-toc` creates a `config.yaml` next to the EPUB when it is missing, with
the book title and `max_split_depth: 2`. With `--llm`, the model proposes the
split depth instead; see above. Edit the file to control the split granularity:

```yaml
title: Principles of Political Economy
max_split_depth: 2
max_line_length: 120
```

`title` is the book title at the root of the tree. `generate-markdown` copies it
from the `title` of `toc.yaml` when the key is missing or empty, and
`generate-toc` does the same when `config.yaml` already exists. A non-empty
value is never overwritten. The same rule applies to `max_split_depth`: later
runs never replace a value that is already present. Downstream tools use the
title as the first segment of every breadcrumb, so keep it unchanged once the
corpus is indexed.

`max_line_length` hard wraps paragraphs at the given column (default `120`). Set
it to `0` to keep each paragraph on a single line. Code blocks, tables and
headings are never wrapped.

Then run:

```bash
$ epub-to-markdown generate-markdown contents/my-book/my-book.epub
```

The command splits the book into one Markdown file per table of contents entry
at depth `max_split_depth`, plus the shallower entries that have no children.
Deeper entries are folded into their split ancestor.

An entry whose `href` has no anchor (for example `OEBPS/preface.xhtml`) points
to a whole document: it is always split into its own file, even when it has
children, and it owns the document content up to the first child anchor.

Every entry that has children owns a directory and writes its page inside it as
`00-index.md`; the other entries keep `<path>.md`. When the entry is split, its
page holds its preface. When it sits above `max_split_depth`, the split drops
its body, so the page holds only the title and the frontmatter. Either way the
title lives in a file of its own, and a tool can rebuild the tree from the
`path` field alone.

Some EPUBs spread a single title across several headings and expose each one as
a separate table of contents entry, producing a heading-only parent with a
single child (for example `LIFE AND WRITINGS` > `DR. ADAM SMITH`). When such a
parent sits above `max_split_depth` and its body holds nothing but headings, the
two entries are merged into one file: both headings are kept and the frontmatter
`title` is the concatenation of the heading text
(`LIFE AND WRITINGS OF DR. ADAM SMITH`).

Files are written to `markdown/`, next to the EPUB, mirroring the `path`
hierarchy; images are extracted to `markdown/images/`. A book folder therefore
contains:

```text
contents/my-book/
├── my-book.epub
├── config.yaml
├── toc.yaml
├── toc.raw.yaml        # only when generate-toc ran with --llm
└── markdown/
    ├── …
    └── images/
```

The `markdown/` directory mirrors the table of contents: one file per split
entry, a page named `00-index.md` inside the directory of each entry that has
children, and the extracted images under `images/`:

```sh
$ tree markdown
markdown/
├── 01-contents.md
├── 02-preface.md
├── 03-introductory/
│   ├── 00-index.md
│   ├── 1-a-sketch-of-the-history-of-political-economy.md
│   ├── 2-books-for-consultation-from-english-french-and-german-authors.md
│   └── 3-preliminary-remarks.md
├── 04-book-i-production/
│   ├── 00-index.md
│   ├── 01-chapter-i-of-the-requisites-of-production.md
│   ├── 02-chapter-ii-of-unproductive-labor.md
│   └── …
├── …
├── 13-footnotes/
│   ├── 00-index.md
│   └── 1-the-full-project-gutenbergtm-license.md
└── images/
    ├── 687523173863510570_capital-circle.png
    └── …
```

A section file holds its body:

```markdown
---
epub_to_markdown_schema: 1
title: Chapter I. Of The Requisites Of Production.
path: 04-book-i-production/01-chapter-i-of-the-requisites-of-production
href: OEBPS/book-i.xhtml#pgepubid00007
source: my-book.epub
---

# Chapter I. Of The Requisites Of Production.

## § 1. The Requisites of Production are Two: Labor, and Appropriate Natural Objects.

...
```

A parent that sits above `max_split_depth` has no body to render, so its
`00-index.md` holds the title only:

```markdown
---
epub_to_markdown_schema: 1
title: Book I. Production.
path: 04-book-i-production
href: OEBPS/book-i.xhtml#pgepubid00006
source: my-book.epub
---

# Book I. Production.
```

Every Markdown file starts with `# <title>`, taken from the `title` of its
table of contents entry, so the heading always matches the frontmatter. The
leading headings that form that title (for example `CHAP. I.` followed by
`OF THE DIVISION OF LABOUR.`) are dropped from the body. The descendants of the
entry are `##`, `###`, and so on; headings that do not belong to the table of
contents are rendered as plain text.

The same contract applies when the title comes from the navigation or from a
bold lead: the leading number, subtitle and closing punctuation are removed
from the body. The comparison ignores case, accents, punctuation and whitespace,
so a reviewed title such as `1 - Les deux XIXe siècles` still matches a bold lead
written `Les deux XIXe siècles.`. If the body does not start with the title, it
is left unchanged. At the end of the run, the command prints how many sections
were cleaned and how many had no matching title prefix.

Footnote references are replaced by Markdown footnotes (`[^12]`), and the note
text is written at the end of the same file (`[^12]: ...`), even when the note
is defined in another document. Note blocks that leaked into the body are
removed; a dedicated `Notes` or `Footnotes` section is kept as is.

## Schema version and migration

Every Markdown file starts with `epub_to_markdown_schema: 1`. The number
describes the frontmatter and tree contract, not the package version. A file
without the field is schema `0`.

`generate-markdown` always writes the latest schema. The tools that consume the
corpus support only the latest schema.

`migrate` upgrades an existing book in place when the change only touches files.
It reads `config.yaml`, `toc.yaml` and `markdown/`, never the EPUB, and never
re-renders the body:

```bash
$ epub-to-markdown migrate contents/my-book
$ epub-to-markdown migrate contents/my-book --dry-run
```

For schema `0` to `1`, it creates the missing `00-index.md` pages, removes the
`ancestors` frontmatter and adds the schema field. The body does not change, so
the content hashes and the embeddings stay valid.

A migration that changes the body is not supported in place. The command stops
and tells you to run `generate-markdown` from the EPUB instead.

## Set up the development environment

To work on this project, [mise](https://mise.jdx.dev/) installs Node.js and
pnpm for you:

```sh
$ mise install
$ pnpm install
```

When you enter the project from an interactive shell, mise defines an
`epub-to-markdown` function that runs the CLI directly with `node`, so it works
without going through `pnpm`. In scripts and CI, call `node src/cli.js <command>`
instead.

To avoid exporting `OPENAI_API_KEY` in your shell, copy `.secret.sh.example` to
`.secret.sh` and put your API key in it; mise sources that file automatically:

```sh
$ cp .secret.sh.example .secret.sh
$ $EDITOR .secret.sh
```

Run the tests and the checks with:

```sh
$ pnpm test
$ pnpm check
```

## Install the development version globally on your workstation

To run the CLI from other projects while working on its source, link the checkout
into `~/.local/bin` instead of installing the published package:

```sh
$ mise run install-cli-to-local-bin
```

Run `pnpm install` at the root of the repository first, because the linked script
resolves its dependencies from `node_modules` at that root.

The task symlinks `src/cli.js`, so the command runs the working tree and every edit
is active on the next call. It creates no global package state. Remove the link
with `mise run uninstall-cli-from-local-bin`.

Inside this repository, the `epub-to-markdown` function defined by the mise enter
hook keeps precedence over the link. The link is for the other projects.

## Publish the package to npmjs

I publish the package to npmjs from this repository with mise:

```sh
$ npm login
$ pnpm version patch
$ mise run publish-to-npmjs
```

`npm login` authenticates against npmjs, once per machine. `pnpm version patch`
bumps the version and creates the matching git tag (use `minor` or `major` for
larger changes). `mise run publish-to-npmjs` first checks the authentication with
`npm whoami`, then runs `npm publish`, which prompts for two-factor
authentication in the browser; it publishes the version written in
`package.json`, so bump it first. The package is scoped, so `publishConfig` in
`package.json` forces public access.
