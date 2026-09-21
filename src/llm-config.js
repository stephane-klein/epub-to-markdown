export const SETTING_KEYS = ["model", "endpoint", "apiKey", "session", "retryDelays", "maxOutputTokens", "reasoning"];

export const DEFAULT_CONFIG_PATH = "epub-to-markdown.yaml";

export const DEFAULT_REASONING = "low";

export const resolveConfigPath = ({ cli = {}, env = process.env } = {}) =>
    cli.config ?? env.EPUB_TO_MD_CONFIG ?? DEFAULT_CONFIG_PATH;

const YAML_KEYS = {
    model: "model_id",
    endpoint: "openaiapi_endpoint",
    apiKey: "api_key",
    session: "x_opencode_session",
    retryDelays: "retry_delays",
    maxOutputTokens: "max_output_tokens",
    reasoning: "reasoning",
};

export const settingsFromConfig = (config = {}) =>
    Object.fromEntries(
        Object.entries(YAML_KEYS)
            .map(([key, yamlKey]) => [key, config?.[yamlKey]])
            .filter(([, value]) => value !== undefined),
    );

const ENV = {
    config: "EPUB_TO_MD_CONFIG",
    model: "EPUB_TO_MD_MODEL_ID",
    endpoint: "EPUB_TO_MD_OPENAIAPI_ENDPOINT",
    apiKey: "EPUB_TO_MD_API_KEY",
    session: "EPUB_TO_MD_X_OPENCODE_SESSION",
    retryDelays: "EPUB_TO_MD_RETRY_DELAYS",
    maxOutputTokens: "EPUB_TO_MD_MAX_OUTPUT_TOKENS",
    reasoning: "EPUB_TO_MD_REASONING",
};

export const loadEnv = (env = process.env) =>
    Object.fromEntries(
        Object.entries(ENV)
            .map(([key, name]) => [key, env[name]])
            .filter(([, value]) => value !== undefined),
    );

export const resolveSettings = ({ cli = {}, config = {}, env = process.env } = {}) => {
    const fromCli = Object.fromEntries(
        SETTING_KEYS.filter((key) => cli[key] !== undefined).map((key) => [key, cli[key]]),
    );
    return { ...settingsFromConfig(config), ...loadEnv(env), ...fromCli };
};

export const resolveApiKey = ({ settings, config = {}, env = process.env } = {}) => {
    if (settings?.apiKey !== undefined) {
        const source =
            env.EPUB_TO_MD_API_KEY !== undefined && env.EPUB_TO_MD_API_KEY === settings.apiKey
                ? "EPUB_TO_MD_API_KEY"
                : config?.api_key === settings.apiKey
                  ? "api_key (config)"
                  : "--api-key";
        return { key: settings.apiKey, source };
    }
    if (env.OPENAI_API_KEY) return { key: env.OPENAI_API_KEY, source: "OPENAI_API_KEY" };
    return { key: undefined, source: null };
};
