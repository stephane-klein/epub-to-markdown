import TurndownService from "turndown";

const DEFAULT_MAX_LINE_LENGTH = 120;

const LIST_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
const QUOTE_MARKER = /^(\s*(?:>\s?)+)/;
const FENCE = /^\s*(`{3,}|~{3,})/;

const escapeCell = (value) =>
    value
        .replace(/\s*\n+\s*/g, " ")
        .trim()
        .replace(/\|/g, "\\|");

const wrapLine = (line, width) => {
    const hardBreak = /(?:\s{2,}|\\)$/.test(line) ? "  " : "";
    const body = hardBreak ? line.replace(/(?:\s{2,}|\\)$/, "") : line;

    let firstPrefix = "";
    let restPrefix = "";
    const list = body.match(LIST_MARKER);
    if (list) {
        firstPrefix = list[1];
        restPrefix = " ".repeat(firstPrefix.length);
    } else {
        const quote = body.match(QUOTE_MARKER);
        if (quote) {
            firstPrefix = quote[1];
            restPrefix = quote[1];
        }
    }

    const words = body.slice(firstPrefix.length).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [line];

    const lines = [];
    let current = firstPrefix;
    for (const word of words) {
        if (current === firstPrefix || current === restPrefix) {
            current += word;
        } else if (current.length + word.length + 1 <= width) {
            current += ` ${word}`;
        } else {
            lines.push(current);
            current = restPrefix + word;
        }
    }
    lines.push(current);
    lines[lines.length - 1] += hardBreak;
    return lines;
};

const wrapMarkdown = (markdown, width) => {
    if (!Number.isInteger(width) || width <= 0) return markdown;

    const output = [];
    let fence = null;
    for (const line of markdown.split("\n")) {
        const match = line.match(FENCE);
        if (fence) {
            output.push(line);
            if (match && match[1][0] === fence) fence = null;
            continue;
        }
        if (match) {
            fence = match[1][0];
            output.push(line);
            continue;
        }
        if (line.length <= width || /^\s*\|/.test(line) || /^\s*#{1,6}\s/.test(line)) {
            output.push(line);
            continue;
        }
        output.push(...wrapLine(line, width));
    }
    return output.join("\n");
};

const createService = ({ headingLevel, imageResolver, footnotes, removeElements }) => {
    const service = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
    });
    service.remove(["script", "style"]);

    if (removeElements) {
        service.addRule("tocFootnoteDefinition", {
            filter: (node) => node.nodeType === 1 && removeElements(node),
            replacement: () => "",
        });
    }

    if (headingLevel) {
        service.addRule("tocHeading", {
            filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
            replacement: (content, node) => {
                const text = content.trim();
                if (!text) return "";
                const level = headingLevel(node);
                if (level === null || level === undefined) return `\n\n${text}\n\n`;
                return `\n\n${"#".repeat(level)} ${text}\n\n`;
            },
        });
    }

    if (footnotes) {
        service.addRule("tocFootnote", {
            filter: (node) => node.nodeName === "A" && footnotes.has(node),
            replacement: (_content, node) => `[^${footnotes.resolve(node)}]`,
        });
    }

    if (imageResolver) {
        service.addRule("tocImage", {
            filter: "img",
            replacement: (_content, node) => {
                const src = node.getAttribute("src");
                if (!src) return "";
                const resolved = imageResolver(src);
                if (!resolved) return "";
                const alt = (node.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim();
                const title = (node.getAttribute("title") ?? "").replace(/\s+/g, " ").replace(/"/g, '\\"');
                return `![${alt}](${resolved}${title ? ` "${title}"` : ""})`;
            },
        });
    }

    service.addRule("tocTable", {
        filter: (node) => node.nodeName === "TABLE",
        replacement: (_content, node) => {
            const rows = Array.from(node.querySelectorAll("tr"));
            if (rows.length === 0) return "";
            const grid = rows.map((row) =>
                Array.from(row.childNodes)
                    .filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH")
                    .map((cell) => escapeCell(service.turndown(cell.innerHTML))),
            );
            const width = Math.max(...grid.map((row) => row.length));
            const padded = grid.map((row) => [...row, ...Array(width - row.length).fill("")]);
            const [header, ...body] = padded;
            const lines = [
                `| ${header.join(" | ")} |`,
                `| ${header.map(() => "---").join(" | ")} |`,
                ...body.map((row) => `| ${row.join(" | ")} |`),
            ];
            return `\n\n${lines.join("\n")}\n\n`;
        },
    });

    return service;
};

export const htmlToMarkdown = (html, options = {}) => {
    const width = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    return wrapMarkdown(createService(options).turndown(html).trim(), width);
};
