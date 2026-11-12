type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

function endpoint() {
  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  return `${base}/chat/completions`;
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

async function completeOnce(messages: ChatTurn[], jsonMode: boolean): Promise<Record<string, unknown>> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    const error = new Error("AI_API_KEY is not set on the server.");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }

  const body: Record<string, unknown> = {
    model: process.env.AI_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
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
    signal: AbortSignal.timeout(35000),
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

export async function completeJson(messages: ChatTurn[]): Promise<Record<string, unknown>> {
  const jsonMode = process.env.AI_JSON_MODE !== "false";
  try {
    return await completeOnce(messages, jsonMode);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? (error as { status?: number }).status : undefined;
    if (!jsonMode || status === 503) throw error;
    return completeOnce(messages, false);
  }
}
