import { runAction } from "@/lib/actions/engine";
import type { ActionOutcome } from "@/lib/actions/types";
import { requireAdmin } from "@/lib/auth";
import type { ChatPayload } from "@/lib/chat-types";
import { apiError } from "@/lib/http";
import { text } from "@/lib/labels";
import { addMessage, closeOpenConfirmations, listMessages, recentHistory } from "@/lib/messages";
import { interpret, narrate } from "@/lib/narrate";
import { db } from "@/lib/db";

function payloadFrom(outcome: ActionOutcome): ChatPayload {
  return {
    kind: outcome.kind,
    columns: outcome.columns,
    rows: outcome.rows,
    total: outcome.total,
    matches: outcome.matches,
    resume: outcome.resume,
    confirmation: outcome.confirmation,
  };
}

export async function GET() {
  try {
    const admin = await requireAdmin();
    await closeOpenConfirmations(admin.id, true);
    return Response.json({ messages: await listMessages(admin.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  try {
    const admin = await requireAdmin();
    const result = await db().from("chat_messages").delete().eq("admin_id", admin.id);
    if (result.error) throw new Error(result.error.message);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const message = text(body.message);
    if (!message) return Response.json({ error: "Write a message first." }, { status: 400 });

    const closedMessages = await closeOpenConfirmations(admin.id);
    const history = await recentHistory(admin.id);
    const userMessage = await addMessage(admin.id, "user", message);
    const resume = body.resume as { action?: string; args?: Record<string, unknown> } | undefined;

    let outcome: ActionOutcome;
    try {
      if (resume?.action) {
        outcome = await runAction(resume.action, resume.args ?? {}, { adminId: admin.id });
      } else {
        const decision = await interpret(message, history);
        outcome = decision.action
          ? await runAction(decision.action, decision.args, { adminId: admin.id })
          : { kind: "clarification", summary: decision.clarification };
      }
    } catch (error) {
      console.error(error);
      outcome = {
        kind: "clarification",
        summary: "I could not complete that. Ask for a count, a name, or one record to change.",
      };
    }

    const reply = outcome.kind === "clarification" ? outcome.summary : await narrate(outcome);
    const assistantMessage = await addMessage(admin.id, "assistant", reply || outcome.summary, payloadFrom(outcome));
    return Response.json({ userMessage, assistantMessage, closedMessages });
  } catch (error) {
    return apiError(error);
  }
}
