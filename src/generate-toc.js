import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stringify } from "yaml";
import { DEFAULT_BOOK_MAX_SPLIT_DEPTH, ensureBookConfig, loadProjectConfig } from "./book-config.js";
import { readEpub } from "./epub.js";
import { extractHeadings } from "./headings.js";
import { bookSession, createModel, estimateCost, generateOnce, metricsLine, parseRetryDelays } from "./llm.js";
import { DEFAULT_REASONING, resolveApiKey, resolveConfigPath, resolveSettings } from "./llm-config.js";
import { loadPricing } from "./pricing.js";
import { discoverSections, expandToc } from "./sections.js";
import { enrichTitles, extractLeads } from "./title.js";
import { annotateToc, extractMetadata, extractToc } from "./toc.js";
import { buildDossier, parseTocYaml, resolveSplitDepth, toHrefToc, validateToc } from "./toc-dossier.js";

const DEFAULT_CEILING = 32768;

const writeRawToc = (outputPath, { title, toc }) => {
    writeFileSync(outputPath, stringify({ title, toc }, { lineWidth: 0 }));
};

const syncBookConfig = (bookConfigPath, title, maxSplitDepth) => {
    const status = ensureBookConfig(bookConfigPath, title, { maxSplitDepth });
    if (status === "created") {
        console.log(
            `config.yaml created at ${bookConfigPath} (title, max_split_depth: ${maxSplitDepth ?? DEFAULT_BOOK_MAX_SPLIT_DEPTH})`,
        );
    } else if (status === "updated") {
        console.log(`Title written to ${bookConfigPath}`);
    }
};

export const runGenerateToc = async ({ epubPath, llm = false, cli = {} }) => {
    const dir = dirname(epubPath);
    const epub = readEpub(epubPath);
    const { title, toc } = extractToc(epub);
    const outputPath = resolve(dir, "toc.yaml");
    const bookConfigPath = resolve(dir, "config.yaml");

    if (!llm) {
        writeRawToc(outputPath, { title, toc });
        syncBookConfig(bookConfigPath, title);
        console.log(`TOC written to ${outputPath}`);
        return;
    }

    const configPath = resolveConfigPath({ cli });
    const projectConfig = loadProjectConfig(configPath);
    const settings = resolveSettings({ cli, config: projectConfig });
    const { key, source } = resolveApiKey({ settings, config: projectConfig });
    if (!key) throw new Error("api key is not set (--api-key, EPUB_TO_MD_API_KEY or OPENAI_API_KEY)");
    if (!settings.model) throw new Error("model is not set (--model or EPUB_TO_MD_MODEL_ID)");
    if (!settings.endpoint) throw new Error("endpoint is not set (--endpoint or EPUB_TO_MD_OPENAIAPI_ENDPOINT)");

    const rawPath = resolve(dir, "toc.raw.yaml");
    writeRawToc(rawPath, { title, toc });

    const metadata = extractMetadata(epub);
    const headings = extractHeadings(epub);
    const { system, prompt, idToHref, orderOf } = buildDossier({
        title,
        toc,
        headings,
        metadata,
    });

    const session = bookSession(settings.session, resolve(epubPath));
    const model = createModel({ modelId: settings.model, endpoint: settings.endpoint, apiKey: key, session });
    const retryDelays = parseRetryDelays(settings.retryDelays ?? "10,30,60");
    const reasoning = settings.reasoning ?? DEFAULT_REASONING;

    const pricing = await loadPricing({ endpoint: settings.endpoint });
    const modelLimit = pricing?.outputLimitAt(settings.model) ?? null;
    const ceiling = settings.maxOutputTokens
        ? Number(settings.maxOutputTokens)
        : modelLimit !== null
          ? modelLimit
          : DEFAULT_CEILING;

    console.error(
        `Reviewing the table of contents with ${settings.model} (config: ${configPath}, key: ${source}, reasoning: ${reasoning})`,
    );

    const result = await generateOnce(
        { model, retryDelays, session, reasoning, endpoint: settings.endpoint },
        {
            system,
            prompt,
            maxOutputTokens: ceiling,
            onRetry: (nextAttempt, totalAttempts, waitMs) => {
                console.error(`retrying in ${Math.round(waitMs / 1000)}s (attempt ${nextAttempt}/${totalAttempts})`);
            },
        },
    );

    if (result.finishReason !== "stop") {
        throw new Error(
            `LLM stopped with finishReason=${result.finishReason} (raw table of contents kept in ${rawPath})`,
        );
    }

    const review = parseTocYaml(result.text);
    const errors = validateToc(review.toc, idToHref, orderOf);
    if (errors.length > 0) {
        throw new Error(
            `LLM table of contents is invalid:\n${errors.join("\n")}\nThe raw table of contents is kept in ${rawPath}`,
        );
    }

    const hrefToc = toHrefToc(review.toc, idToHref);
    const sections = discoverSections(epub);
    const expanded = expandToc(hrefToc, sections);
    const leads = extractLeads(epub, expanded.toc);
    const enriched = enrichTitles(expanded.toc, leads);
    const annotated = annotateToc(enriched.toc);
    const splitDepth = resolveSplitDepth(review.maxSplitDepth, annotated, DEFAULT_BOOK_MAX_SPLIT_DEPTH);

    const cost = estimateCost(pricing?.priceAt(settings.model), result.usage);
    const frontmatter = {
        title,
        llm: {
            model: settings.model,
            generated_at: new Date().toISOString(),
            input_tokens: result.usage?.inputTokens ?? null,
            output_tokens: result.usage?.outputTokens ?? null,
            reasoning_tokens: result.usage?.outputTokenDetails?.reasoningTokens ?? null,
            text_tokens: result.usage?.outputTokenDetails?.textTokens ?? null,
            estimated_cost_usd: cost === null ? null : Number(cost.toFixed(6)),
            finish_reason: result.finishReason,
        },
        toc: annotated,
    };
    writeFileSync(outputPath, stringify(frontmatter, { lineWidth: 0 }));
    syncBookConfig(bookConfigPath, title, splitDepth);

    if (expanded.added > 0) {
        console.log(`Sections added: ${expanded.added}`);
    }
    if (enriched.enriched > 0 || enriched.skipped > 0) {
        const skipped = enriched.skipped > 0 ? ` (${enriched.skipped} numeric titles left as is)` : "";
        console.log(`Titles enriched: ${enriched.enriched}${skipped}`);
    }

    console.log(`TOC reviewed written to ${outputPath}`);
    console.error(metricsLine(settings.model, result.usage, result.elapsed, cost));
};
