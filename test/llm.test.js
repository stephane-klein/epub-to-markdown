import assert from "node:assert/strict";
import { test } from "node:test";
import { reasoningOptions } from "../src/llm.js";

test("reasoningOptions disables DeepSeek thinking with the thinking switch", () => {
    assert.deepEqual(reasoningOptions("none", "https://api.deepseek.com/chat/completions"), {
        providerOptions: { opencode: { thinking: { type: "disabled" } } },
    });
});

test("reasoningOptions uses the normalized option for non-DeepSeek providers", () => {
    assert.deepEqual(reasoningOptions("none", "https://opencode.ai/zen/go/v1/chat/completions"), {
        reasoning: "none",
    });
});

test("reasoningOptions forwards a reasoning level", () => {
    assert.deepEqual(reasoningOptions("low", "https://api.deepseek.com/chat/completions"), { reasoning: "low" });
});

test("reasoningOptions is empty when reasoning is undefined", () => {
    assert.deepEqual(reasoningOptions(undefined, "https://api.deepseek.com/chat/completions"), {});
});
