import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

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
