import assert from "node:assert/strict";
import { test } from "node:test";
import {
    DEFAULT_CONFIG_PATH,
    loadEnv,
    resolveApiKey,
    resolveConfigPath,
    resolveSettings,
    settingsFromConfig,
} from "../src/llm-config.js";

test("settingsFromConfig maps the top-level config keys", () => {
    assert.deepEqual(
        settingsFromConfig({
            model_id: "m",
            openaiapi_endpoint: "u",
            x_opencode_session: "s",
            max_output_tokens: 42,
            reasoning: "none",
        }),
        { model: "m", endpoint: "u", session: "s", maxOutputTokens: 42, reasoning: "none" },
    );
});

test("resolveConfigPath follows CLI > env > default", () => {
    assert.equal(resolveConfigPath({ cli: { config: "a.yaml" }, env: { EPUB_TO_MD_CONFIG: "b.yaml" } }), "a.yaml");
    assert.equal(resolveConfigPath({ cli: {}, env: { EPUB_TO_MD_CONFIG: "b.yaml" } }), "b.yaml");
    assert.equal(resolveConfigPath({ cli: {}, env: {} }), DEFAULT_CONFIG_PATH);
});

test("resolveSettings resolves the reasoning level with CLI > env > config", () => {
    assert.equal(
        resolveSettings({ cli: {}, config: { reasoning: "high" }, env: { EPUB_TO_MD_REASONING: "none" } }).reasoning,
        "none",
    );
    assert.equal(
        resolveSettings({ cli: { reasoning: "low" }, config: { reasoning: "high" }, env: {} }).reasoning,
        "low",
    );
});

test("resolveSettings follows CLI > env > config", () => {
    const settings = resolveSettings({
        cli: { model: "cli" },
        config: { model_id: "config", openaiapi_endpoint: "https://config" },
        env: { EPUB_TO_MD_MODEL_ID: "env", EPUB_TO_MD_OPENAIAPI_ENDPOINT: "https://env" },
    });
    assert.equal(settings.model, "cli");
    assert.equal(settings.endpoint, "https://env");
});

test("loadEnv ignores unset variables", () => {
    assert.deepEqual(loadEnv({}), {});
});

test("resolveApiKey prefers the resolved setting then OPENAI_API_KEY", () => {
    assert.deepEqual(resolveApiKey({ settings: { apiKey: "k" }, env: {} }), { key: "k", source: "--api-key" });
    assert.deepEqual(resolveApiKey({ settings: {}, env: { OPENAI_API_KEY: "o" } }), {
        key: "o",
        source: "OPENAI_API_KEY",
    });
    assert.deepEqual(resolveApiKey({ settings: {}, env: {} }), { key: undefined, source: null });
});
