import { existsSync } from "node:fs";
import { generateText } from "ai";
import { loadProjectConfig } from "./book-config.js";
import { createModel, describeError } from "./llm.js";
import { DEFAULT_REASONING, resolveApiKey, resolveSettings, settingsFromConfig } from "./llm-config.js";
import { loadPricing } from "./pricing.js";

const MIN_NODE_MAJOR = 22;

const checkNode = () => {
    const version = process.versions.node;
    const major = Number(version.split(".")[0]);
    return major >= MIN_NODE_MAJOR
        ? { status: "ok", value: `v${version}`, note: null }
        : { status: "error", value: `v${version}`, note: `requires >= ${MIN_NODE_MAJOR}` };
};

const checkConfig = (configPath) => {
    if (!existsSync(configPath)) return { status: "warn", value: configPath, note: "not found" };
    try {
        const config = loadProjectConfig(configPath);
        const count = Object.keys(settingsFromConfig(config)).length;
        return { status: "ok", value: configPath, note: `${count} setting(s)` };
    } catch (error) {
        return { status: "error", value: configPath, note: error.message };
    }
};

const checkEndpoint = (endpoint) => {
    if (!endpoint) return { status: "error", value: "-", note: "not set" };
    try {
        new URL(endpoint);
        return { status: "ok", value: endpoint, note: null };
    } catch {
        return { status: "error", value: endpoint, note: "not a valid URL" };
    }
};

const checkLlm = async ({ llm, settings, key, timeoutMs }) => {
    if (!llm) return { status: "warn", value: "-", note: "skipped (--no-llm)" };
    if (!settings.model) return { status: "error", value: "-", note: "model not set" };
    if (!settings.endpoint) return { status: "error", value: "-", note: "endpoint not set" };
    if (!key) return { status: "error", value: "-", note: "api key not set" };

    try {
        const model = createModel({
            modelId: settings.model,
            endpoint: settings.endpoint,
            apiKey: key,
            session: settings.session,
        });
        const started = performance.now();
        const { usage } = await generateText({
            model,
            prompt: "ping",
            maxOutputTokens: 8,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(timeoutMs),
        });
        const elapsed = (performance.now() - started) / 1000;
        return {
            status: "ok",
            value: `${elapsed.toFixed(1)}s`,
            note: `${usage?.inputTokens ?? 0} in / ${usage?.outputTokens ?? 0} out`,
        };
    } catch (error) {
        return { status: "error", value: "-", note: describeError(error, 1) };
    }
};

const checkPricing = async ({ settings }) => {
    if (!settings.endpoint) return { status: "warn", value: "-", note: "endpoint not set" };
    if (!settings.model) return { status: "warn", value: "-", note: "model not set" };

    const pricing = await loadPricing({ endpoint: settings.endpoint });
    if (!pricing) return { status: "warn", value: "-", note: "no pricing source" };

    const price = pricing.priceAt(settings.model);
    if (!price) return { status: "warn", value: pricing.provider, note: "model not priced" };

    const peak = price.peak === null ? "" : price.peak ? " (peak)" : " (off-peak)";
    const usd = (value) => (typeof value === "number" ? `$${value}` : "-");
    return {
        status: "ok",
        value: `${price.source}${peak}`,
        note: `${usd(price.input)} in / ${usd(price.output)} out / ${usd(price.cachedInput)} cached per 1M`,
    };
};

const render = (rows) => {
    const labelWidth = Math.max(...rows.map((row) => row.label.length));
    const valueWidth = Math.max(...rows.map((row) => row.value.length));
    return rows.map((row) => {
        const note = row.note ? ` (${row.note})` : "";
        return `${row.label.padEnd(labelWidth)}  ${row.value.padEnd(valueWidth)}  ${row.status}${note}`;
    });
};

const loadProjectConfigSafe = (configPath) => {
    try {
        return loadProjectConfig(configPath);
    } catch {
        return {};
    }
};

export const runDoctor = async ({
    configPath = "epub-to-markdown.yaml",
    overrides = {},
    llm = true,
    timeoutMs = 30000,
} = {}) => {
    const projectConfig = loadProjectConfigSafe(configPath);
    const settings = resolveSettings({ cli: overrides, config: projectConfig });
    const { key, source } = resolveApiKey({ settings, config: projectConfig });

    const rows = [
        { label: "node", ...checkNode() },
        { label: "config", ...checkConfig(configPath) },
        {
            label: "model",
            value: settings.model ?? "-",
            status: settings.model ? "ok" : "error",
            note: settings.model ? null : "not set",
        },
        { label: "endpoint", ...checkEndpoint(settings.endpoint) },
        {
            label: "api key",
            value: source ?? "-",
            status: key ? "ok" : "error",
            note: key ? null : "not set",
        },
    ];
    if (settings.session) {
        rows.push({ label: "session", value: "set", status: "info", note: null });
    }
    rows.push({
        label: "reasoning",
        value: settings.reasoning ?? DEFAULT_REASONING,
        status: "info",
        note: null,
    });
    rows.push({ label: "pricing", ...(await checkPricing({ settings })) });
    rows.push({ label: "llm", ...(await checkLlm({ llm, settings, key, timeoutMs })) });

    const counts = { ok: 0, warn: 0, error: 0 };
    for (const row of rows) {
        if (row.status in counts) counts[row.status]++;
    }

    console.log("epub-to-markdown doctor");
    console.log(render(rows).join("\n"));
    console.log();
    console.log(`summary: ${counts.ok} ok, ${counts.warn} warning, ${counts.error} error`);

    if (counts.error > 0) process.exitCode = 1;
};
