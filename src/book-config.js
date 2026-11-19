import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isMap, parse, parseDocument, stringify } from "yaml";

export const loadProjectConfig = (configPath) => {
    if (!existsSync(configPath)) return {};
    return parse(readFileSync(configPath, "utf8")) ?? {};
};

export const loadBookConfig = (configPath) => {
    const config = parse(readFileSync(configPath, "utf8")) ?? {};
    const maxSplitDepth = config.max_split_depth;
    if (!Number.isInteger(maxSplitDepth) || maxSplitDepth < 1) {
        throw new Error(`max_split_depth must be a positive integer in ${configPath}`);
    }
    const maxLineLength = config.max_line_length ?? 120;
    if (!Number.isInteger(maxLineLength) || maxLineLength < 0) {
        throw new Error(`max_line_length must be a non-negative integer in ${configPath}`);
    }
    return { maxSplitDepth, maxLineLength };
};

export const ensureBookTitle = (configPath, title) => {
    if (!existsSync(configPath)) return false;
    if (typeof title !== "string" || title.trim() === "") return false;

    const document = parseDocument(readFileSync(configPath, "utf8"));
    const current = document.get("title");
    if (current !== undefined && current !== null) {
        if (typeof current !== "string") {
            throw new Error(`title must be a string in ${configPath}`);
        }
        if (current.trim() !== "") return false;
    }

    if (document.has("title")) {
        document.set("title", title);
    } else if (document.contents === null) {
        document.set("title", title);
    } else if (isMap(document.contents)) {
        document.contents.items.unshift(document.createPair("title", title));
    } else {
        throw new Error(`config.yaml must contain a YAML mapping: ${configPath}`);
    }

    writeFileSync(configPath, document.toString({ lineWidth: 0 }));
    return true;
};

export const DEFAULT_BOOK_MAX_SPLIT_DEPTH = 2;

export const ensureBookConfig = (configPath, title, { maxSplitDepth = DEFAULT_BOOK_MAX_SPLIT_DEPTH } = {}) => {
    if (typeof title !== "string" || title.trim() === "") return false;
    if (existsSync(configPath)) {
        return ensureBookTitle(configPath, title) ? "updated" : false;
    }

    const depth = Number.isInteger(maxSplitDepth) && maxSplitDepth >= 1 ? maxSplitDepth : DEFAULT_BOOK_MAX_SPLIT_DEPTH;
    writeFileSync(configPath, stringify({ title, max_split_depth: depth }, { lineWidth: 0 }));
    return "created";
};
