# Agent Instructions

## Project Context

The epub-to-markdown CLI generates Markdown files from EPUB book source files. It turns the table of contents and the book content into a Markdown corpus, suitable for full-text search or feeding a RAG.

## Language Policy

- **All project content must be in English**: source code, comments, commit messages, and documentation.
- **Human conversations in OpenCode remain in French**.

## Package Manager Policy

- Always use `pnpm` for installing, adding, and removing packages.
- Never use `npm` or `yarn`.

## Code Quality

This project uses [Biome](https://biomejs.dev) for linting and formatting:

- `pnpm lint` — check for code issues
- `pnpm format` — auto-format code
- `pnpm check` — run both (format + lint + organize imports)

Configuration: `biome.jsonc`

## Version Control

This project uses **Jujutsu** for version control.
