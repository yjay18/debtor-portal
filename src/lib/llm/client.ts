import { z } from "zod";

const providerResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable(),
      refusal: z.string().nullable().optional(),
    }),
  })).min(1),
});

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmJsonSchema = {
  name: string;
  schema: Record<string, unknown>;
};

export type LlmClientConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  supportsJsonSchema: boolean;
  reasoningEffort?: "minimal" | "none";
  timeoutMs?: number;
};

export class LlmClientError extends Error {
  constructor(
    message: string,
    public readonly kind: "provider_failure" | "invalid_output" = "provider_failure",
  ) {
    super(message);
  }
}
//configuring for OpenAI
export class OpenAiCompatibleClient {
  constructor(
    private readonly config: LlmClientConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
//we set stream to false for ollama compatibility, as we need to parse the entire response at once
  async completeJson(messages: LlmMessage[], jsonSchema?: LlmJsonSchema) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000);
    const body = {
      model: this.config.model,
      messages,
      ...(this.config.reasoningEffort
        ? { reasoning_effort: this.config.reasoningEffort }
        : { temperature: 0 }),
      stream: false,
      n: 1,
      ...(jsonSchema && this.config.supportsJsonSchema ? {
        response_format: {
          type: "json_schema",
          json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema },
        },
      } : {}),
    };

    try {
      const response = await this.fetcher(
        `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new LlmClientError(`LLM provider returned HTTP ${response.status}.`);
      }

      const rawResponse = await response.json().catch(() => {
        throw new LlmClientError("LLM provider returned invalid JSON.", "invalid_output");
      });
      const parsedResult = providerResponseSchema.safeParse(rawResponse);
      if (!parsedResult.success) {
        throw new LlmClientError("LLM provider returned an invalid response.", "invalid_output");
      }
      const parsed = parsedResult.data;
      const message = parsed.choices[0].message;
      if (message.refusal) throw new LlmClientError("LLM provider refused the request.");
      if (!message.content) {
        throw new LlmClientError("LLM provider returned no content.", "invalid_output");
      }

      try {
        return JSON.parse(message.content) as unknown;
      } catch {
        throw new LlmClientError("LLM provider returned invalid JSON.", "invalid_output");
      }
    } catch (error) {
      if (controller.signal.aborted) throw new LlmClientError("LLM request timed out.");
      if (error instanceof LlmClientError) throw error;
      throw new LlmClientError("LLM request failed.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLlmClient(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
) {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const model = env.LLM_MODEL?.trim();
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!baseUrl || !model) throw new LlmClientError("Missing LLM_BASE_URL or LLM_MODEL.");

  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new LlmClientError("Invalid LLM_BASE_URL.");
  }
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!isLocal && !apiKey) throw new LlmClientError("Missing OPENAI_API_KEY.");
  const reasoningEffort = hostname !== "api.openai.com"
    ? undefined
    : /^gpt-5\.\d+(?:-|$)/.test(model)
      ? "none" as const
      : /^gpt-5(?:-|$)/.test(model)
        ? "minimal" as const
        : undefined;

  return new OpenAiCompatibleClient({
    baseUrl,
    model,
    apiKey,
    supportsJsonSchema: env.LLM_SUPPORTS_JSON_SCHEMA !== "false",
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }, fetcher);
}
