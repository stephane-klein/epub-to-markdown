import { createHash } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText } from "ai";

const PROVIDER_NAME = "opencode";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cachedInputTokens = (usage) => {
    const details = usage?.inputTokenDetails ?? {};
    return details.cacheReadTokens ?? usage?.cachedInputTokens ?? 0;
};

export const estimateCost = (price, usage) => {
    if (!price || !usage) return null;

    const details = usage.inputTokenDetails ?? {};
    const cached = cachedInputTokens(usage);
    const input = details.noCacheTokens ?? Math.max((usage.inputTokens ?? 0) - cached, 0);

    return (
        (input / 1e6) * price.input +
        (cached / 1e6) * (price.cachedInput ?? 0) +
        ((usage.outputTokens ?? 0) / 1e6) * price.output
    );
};

const isRetryable = (error) => APICallError.isInstance(error) && error.isRetryable;

const retryDelayMs = (error, fallbackMs) => {
    const headers = APICallError.isInstance(error) ? error.responseHeaders : undefined;
    let headerMs;
    if (headers?.["retry-after-ms"] !== undefined) {
        headerMs = Number.parseFloat(headers["retry-after-ms"]);
    } else if (headers?.["retry-after"] !== undefined) {
        const seconds = Number.parseFloat(headers["retry-after"]);
        headerMs = Number.isNaN(seconds) ? Date.parse(headers["retry-after"]) - Date.now() : seconds * 1000;
    }

    if (!Number.isFinite(headerMs) || headerMs <= 0) return fallbackMs;
    return Math.max(headerMs, fallbackMs);
};

export const describeError = (error, attempts) => {
    const suffix = ` after ${attempts} attempt(s)`;
    if (!APICallError.isInstance(error)) return `${error.message}${suffix}`;

    const status = error.statusCode ? `HTTP ${error.statusCode}` : "API error";
    const body = error.responseBody?.trim().replace(/\s+/g, " ").slice(0, 200);
    return `${status} ${error.message}${suffix}${body ? `: ${body}` : ""}`;
};

export const parseRetryDelays = (value) =>
    `${value}`
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => Number(item) * 1000)
        .filter((item) => Number.isFinite(item) && item >= 0);

const convertUsage = (usage) => {
    const prompt = usage?.prompt_tokens ?? 0;
    const completion = usage?.completion_tokens ?? 0;
    const cacheRead = usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    return {
        inputTokens: {
            total: prompt,
            noCache: Math.max(prompt - cacheRead, 0),
            cacheRead,
            cacheWrite: undefined,
        },
        outputTokens: {
            total: completion,
            text: Math.max(completion - reasoning, 0),
            reasoning,
        },
        raw: usage,
    };
};

export const createModel = ({ modelId, endpoint, apiKey, session }) => {
    const provider = createOpenAICompatible({
        name: PROVIDER_NAME,
        apiKey,
        baseURL: endpoint.replace(/\/chat\/completions\/?$/, ""),
        headers: session ? { "X-OpenCode-Session": session } : {},
        convertUsage,
    });
    return provider(modelId);
};

export const bookSession = (base, epubPath) => {
    const id = createHash("sha256").update(epubPath).digest("hex").slice(0, 16);
    return `${base || "epub-to-markdown"}-${id}`;
};

export const reasoningOptions = (reasoning, endpoint = "") => {
    if (reasoning === "none") {
        return /deepseek/i.test(endpoint)
            ? { providerOptions: { [PROVIDER_NAME]: { thinking: { type: "disabled" } } } }
            : { reasoning: "none" };
    }
    return reasoning ? { reasoning } : {};
};

export const metricsLine = (modelId, usage, elapsed, cost) => {
    const reasoning = usage?.outputTokenDetails?.reasoningTokens;
    return [
        modelId,
        `llm ${elapsed.toFixed(1)}s`,
        usage ? `${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out` : "usage ?",
        reasoning ? `${reasoning} reasoning` : null,
        cost === null ? null : `~$${cost.toFixed(6)}`,
    ]
        .filter(Boolean)
        .join("  ");
};

export const generateOnce = async (
    { model, retryDelays, session, reasoning, endpoint },
    { system, prompt, maxOutputTokens, onRetry },
) => {
    const totalAttempts = retryDelays.length + 1;

    for (let attempt = 1; ; attempt++) {
        const started = performance.now();
        try {
            const { text, usage, finishReason } = await generateText({
                model,
                system,
                prompt,
                temperature: 0.2,
                ...reasoningOptions(reasoning, endpoint),
                maxOutputTokens,
                maxRetries: 0,
                headers: session ? { "X-OpenCode-Session": session } : {},
            });
            const elapsed = (performance.now() - started) / 1000;
            return { text, usage, finishReason, elapsed };
        } catch (error) {
            if (!isRetryable(error) || attempt > retryDelays.length) {
                throw new Error(describeError(error, attempt), { cause: error });
            }
            const waitMs = retryDelayMs(error, retryDelays[attempt - 1]);
            onRetry?.(attempt + 1, totalAttempts, waitMs);
            await delay(waitMs);
        }
    }
};
