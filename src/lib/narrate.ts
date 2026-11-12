import { completeJson } from "@/lib/ai";
import { listActions } from "@/lib/actions/engine";
import { text } from "@/lib/labels";
import type { ActionOutcome } from "@/lib/actions/types";

const CATALOG = listActions()
  .map((action) => `- ${action.name} (${action.kind}): ${action.description} Args: ${action.args}.`)
  .join("\n");

const UNCLEAR = "I can look up campaigns, advertisers, cargo partners, settlements, Solo Pay, FAQs, and notices. Ask for a count or a name, or tell me the one record you want to change.";

export async function interpret(message: string, history: { role: "user" | "assistant"; content: string }[]) {
  try {
  const result = await completeJson([
    {
      role: "system",
      content: [
        "You choose one approved MOAD admin action. You never write SQL and you never claim a record was changed.",
        "Return JSON: {\"action\":\"action_name\",\"args\":{}} or {\"action\":null,\"clarification\":\"what you need\"}.",
        "Use null when the request is a greeting, thanks, small talk, or missing the record or the new value.",
        "For those, put a short helpful reply in clarification. Do not invent an action.",
        "Status values use snake case: pending_approval, approved, rejected, blacklist, under_review, preparing, recruiting, operational, in_progress, paused, ended, before_settlement, settlement_confirmed, before_payment, payment_confirmed.",
        "Stop a campaign with stop_campaign. A count or filter is a read and does not need confirmation.",
        "Approved actions:",
        CATALOG,
      ].join("\n"),
    },
    ...history.slice(-6),
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
  } catch {
    return { action: null as string | null, args: {}, clarification: UNCLEAR };
  }
}

export async function narrate(outcome: ActionOutcome): Promise<string> {
  try {
    const result = await completeJson([
      {
        role: "system",
        content: [
          "Turn the server result into one or two sentences for an administrator.",
          "Use only the facts in the result. Do not invent counts, names, or statuses.",
          "If kind is confirmation, ask them to confirm and do not say the change is done.",
          "If kind is refused or matches, say that nothing was changed.",
          "Return JSON: {\"reply\":\"...\"}.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          kind: outcome.kind,
          summary: outcome.summary,
          total: outcome.total ?? null,
          rows: (outcome.rows ?? []).slice(0, 8),
        }),
      },
    ]);
    const reply = text(result.reply);
    if (!reply) return outcome.summary;
    if (outcome.kind !== "done" && outcome.kind !== "read" && /nothing was changed|confirm|choose/i.test(outcome.summary) && /\b(updated|deleted|created|deducted|stopped)\b/i.test(reply)) {
      return outcome.summary;
    }
    return reply;
  } catch {
    return outcome.summary;
  }
}
