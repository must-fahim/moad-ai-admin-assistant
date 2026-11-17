import { completeJson } from "@/lib/ai";
import { listActions } from "@/lib/actions/engine";
import { text } from "@/lib/labels";

const CATALOG = listActions()
  .map((action) => `${action.name} (${action.kind}): ${action.description} Args: ${action.args}.`)
  .join("\n");

const UNCLEAR = "I can look up campaigns, advertisers, cargo partners, settlements, Solo Pay, FAQs, and notices. Ask for a count or a name, or tell me the one record you want to change.";

type Turn = { role: "user" | "assistant"; content: string };

function stockClarification(value: string) {
  return (
    value === UNCLEAR ||
    /ask for a count or a name/i.test(value) ||
    /could not complete that/i.test(value) ||
    /not sure what you need/i.test(value) ||
    /provide more details/i.test(value)
  );
}

function refersToPrevious(message: string) {
  return /\b(that|those|this|same|again|it|them|one|previous|above)\b/i.test(message);
}

function modelHistory(history: Turn[]) {
  const kept: Turn[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const turn = history[index];
    const next = history[index + 1];
    if (turn.role === "user" && next?.role === "assistant" && stockClarification(next.content)) {
      index += 1;
      continue;
    }
    if (turn.role === "assistant" && stockClarification(turn.content)) continue;
    kept.push(turn);
  }
  return kept.slice(-4);
}

async function chooseAction(message: string, history: Turn[]) {
  const result = await completeJson([
    {
      role: "system",
      content: [
        "Choose one approved MOAD admin action. Never write SQL.",
        "Return JSON only: {\"action\":\"action_name\",\"args\":{}} or {\"action\":null,\"clarification\":\"short helpful reply\"}.",
        "Judge only the latest user message. Use null for greetings, small talk, or when the record or new value is missing.",
        "Driving partner, operating partner, and cargo partner are the same. Advertiser is a company.",
        "Remove from blacklist or unblock means change that person's status to approved. Put them on blacklist means status blacklist.",
        "Statuses: pending_approval, approved, rejected, blacklist, under_review, preparing, recruiting, operational, in_progress, paused, ended, before_settlement, settlement_confirmed, before_payment, payment_confirmed.",
        "Stop a campaign with stop_campaign.",
        "Actions:",
        CATALOG,
      ].join("\n"),
    },
    ...history,
    { role: "user", content: message },
  ]);

  const action = text(result.action);
  const args =
    result.args && typeof result.args === "object" && !Array.isArray(result.args)
      ? (result.args as Record<string, unknown>)
      : {};
  if (!action || action === "null" || action === "none") {
    return { action: null as string | null, args, clarification: text(result.clarification) || UNCLEAR };
  }
  return { action, args, clarification: text(result.clarification) };
}

async function attempt(message: string, history: Turn[]) {
  try {
    return await chooseAction(message, history);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    if (/rate limit/i.test(detail)) {
      return { action: null as string | null, args: {}, clarification: "The assistant is busy. Send that question again in a few seconds." };
    }
    return { action: null as string | null, args: {}, clarification: UNCLEAR };
  }
}

export async function interpret(message: string, history: Turn[]) {
  const context = refersToPrevious(message) ? modelHistory(history) : [];
  const decision = await attempt(message, context);
  const substantial = message.trim().split(/\s+/).length >= 3;
  if (decision.action || !substantial || context.length === 0) return decision;
  return attempt(message, []);
}
