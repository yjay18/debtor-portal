import { expect, it, vi } from "vitest";

import { createLlmClient, LlmClientError, OpenAiCompatibleClient } from "./client";

const config = {
  baseUrl: "https://api.openai.test/v1/",
  model: "test-small-model",
  apiKey: "test-api-key",
  supportsJsonSchema: true,
};
const messages = [{ role: "user" as const, content: "Return JSON" }];
const jsonSchema = {
  name: "intent",
  schema: { type: "object", properties: { action: { type: "string" } } },
};

function providerResponse(content: string | null, refusal: string | null = null) {
  return new Response(JSON.stringify({
    choices: [{ message: { content, refusal } }],
  }));
}

it("sends a deterministic structured-output request", async () => {
  const fetcher = vi.fn().mockResolvedValue(providerResponse('{"action":"read_account"}'));
  const client = new OpenAiCompatibleClient(config, fetcher);

  await expect(client.completeJson(messages, jsonSchema))
    .resolves.toEqual({ action: "read_account" });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.openai.test/v1/chat/completions");
  expect(init.headers).toEqual({
    "Content-Type": "application/json",
    Authorization: "Bearer test-api-key",
  });
  expect(JSON.parse(init.body)).toMatchObject({
    model: "test-small-model",
    temperature: 0,
    stream: false,
    n: 1,
    response_format: {
      type: "json_schema",
      json_schema: { name: "intent", strict: true, schema: jsonSchema.schema },
    },
  });
});

it("omits structured output and authorization when disabled locally", async () => {
  const fetcher = vi.fn().mockResolvedValue(providerResponse("{}"));
  const client = createLlmClient({
    LLM_BASE_URL: "http://localhost:11434/v1",
    LLM_MODEL: "local-model",
    LLM_SUPPORTS_JSON_SCHEMA: "false",
  }, fetcher);

  await client.completeJson(messages, jsonSchema);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).not.toHaveProperty("response_format");
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
});

it("uses minimal reasoning instead of unsupported temperature for OpenAI GPT-5", async () => {
  const fetcher = vi.fn().mockResolvedValue(providerResponse("{}"));
  const client = createLlmClient({
    LLM_BASE_URL: "https://api.openai.com/v1",
    LLM_MODEL: "gpt-5-nano-2025-08-07",
    OPENAI_API_KEY: "test-api-key",
  }, fetcher);

  await client.completeJson(messages);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).toMatchObject({ reasoning_effort: "minimal" });
  expect(body).not.toHaveProperty("temperature");
});

it.each([
  { name: "missing base URL", env: { LLM_MODEL: "model" }, message: "Missing LLM_BASE_URL or LLM_MODEL." },
  { name: "missing model", env: { LLM_BASE_URL: "https://api.openai.test/v1" }, message: "Missing LLM_BASE_URL or LLM_MODEL." },
  {
    name: "missing remote API key",
    env: { LLM_BASE_URL: "https://api.openai.test/v1", LLM_MODEL: "model" },
    message: "Missing OPENAI_API_KEY.",
  },
  {
    name: "invalid base URL",
    env: { LLM_BASE_URL: "not-a-url", LLM_MODEL: "model" },
    message: "Invalid LLM_BASE_URL.",
  },
])("rejects $name configuration", ({ env, message }) => {
  expect(() => createLlmClient(env)).toThrow(message);
});

it.each([
  { name: "HTTP failure", response: new Response(null, { status: 429 }), message: "LLM provider returned HTTP 429.", kind: "provider_failure" },
  { name: "refusal", response: providerResponse(null, "Cannot comply"), message: "LLM provider refused the request.", kind: "provider_failure" },
  { name: "empty content", response: providerResponse(null), message: "LLM provider returned no content.", kind: "invalid_output" },
  { name: "invalid content JSON", response: providerResponse("not-json"), message: "LLM provider returned invalid JSON.", kind: "invalid_output" },
  { name: "invalid response JSON", response: new Response("not-json"), message: "LLM provider returned invalid JSON.", kind: "invalid_output" },
  {
    name: "malformed response",
    response: new Response(JSON.stringify({ choices: [] })),
    message: "LLM provider returned an invalid response.",
    kind: "invalid_output",
  },
])("handles $name safely", async ({ response, message, kind }) => {
  const fetcher = vi.fn().mockResolvedValue(response);
  const error = await new OpenAiCompatibleClient(config, fetcher)
    .completeJson(messages).catch((caught) => caught);
  expect(error).toBeInstanceOf(LlmClientError);
  expect(error).toMatchObject({ message, kind });
});

it("times out a slow provider request", async () => {
  const fetcher = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  const client = new OpenAiCompatibleClient({ ...config, timeoutMs: 1 }, fetcher as typeof fetch);

  await expect(client.completeJson(messages)).rejects.toThrow("LLM request timed out.");
});

it("hides low-level network errors", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("network detail"));

  await expect(new OpenAiCompatibleClient(config, fetcher).completeJson(messages))
    .rejects.toThrow("LLM request failed.");
});

it("uses a dedicated safe error type", () => {
  const error = new LlmClientError("safe", "invalid_output");
  expect(error).toBeInstanceOf(Error);
  expect(error.kind).toBe("invalid_output");
});
