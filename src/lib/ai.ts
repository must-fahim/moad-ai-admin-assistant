type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

function endpoint() {
  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  return `${base}/chat/completions`;
}

function apiKeys() {
  const listed = (process.env.AI_API_KEYS || "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const singles = [process.env.AI_API_KEY, process.env.AI_API_KEY_2, process.env.AI_API_KEY_3]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set([...singles, ...listed])];
}

export function parseModelJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("The model did not return JSON.");
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

async function completeOnce(
  messages: ChatTurn[],
  jsonMode: boolean,
  maxTokens: number,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: process.env.AI_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
    max_tokens: maxTokens,
    messages,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: { message?: { content?: string | null } }[];
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || "The AI request failed.");
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("The model returned an empty response.");
  return parseModelJson(content);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(error: unknown) {
  return /rate limit/i.test(error instanceof Error ? error.message : "");
}

function rateLimitDelay(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (!/rate limit/i.test(message)) return 0;
  const seconds = Number(message.match(/try again in ([\d.]+)s/i)?.[1] ?? 1.5);
  return Math.min(Math.max(seconds, 0.4), 12) * 1000;
}

async function completeWithKeys(messages: ChatTurn[], jsonMode: boolean, maxTokens: number) {
  const keys = apiKeys();
  if (!keys.length) {
    const error = new Error("AI_API_KEY is not set on the server.");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }

  let lastError: unknown;
  for (let index = 0; index < keys.length; index += 1) {
    try {
      return await completeOnce(messages, jsonMode, maxTokens, keys[index]);
    } catch (error) {
      lastError = error;
      if (!isRateLimit(error)) throw error;
    }
  }

  const delay = rateLimitDelay(lastError);
  if (delay) {
    await wait(delay);
    return completeOnce(messages, jsonMode, maxTokens, keys[0]);
  }
  throw lastError;
}

export async function completeJson(messages: ChatTurn[], maxTokens = 180): Promise<Record<string, unknown>> {
  const jsonMode = process.env.AI_JSON_MODE !== "false";
  try {
    return await completeWithKeys(messages, jsonMode, maxTokens);
  } catch (error) {
    if (isRateLimit(error)) throw error;
    const status = typeof error === "object" && error && "status" in error ? (error as { status?: number }).status : undefined;
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (!jsonMode || status === 503 || timedOut) throw error;
    return completeWithKeys(messages, false, maxTokens);
  }
}
