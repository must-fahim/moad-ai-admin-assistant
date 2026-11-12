import { commitAction } from "@/lib/actions/engine";
import type { PendingAction } from "@/lib/actions/types";
import { ActionRefusal } from "@/lib/actions/writes";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { db, unwrap, type Row } from "@/lib/db";
import { apiError } from "@/lib/http";
import { text } from "@/lib/labels";
import { markConfirmation } from "@/lib/messages";
import { narrate } from "@/lib/narrate";

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const intent = text(body.intent);
    const pendingActionId = text(body.pendingActionId);
    if (!["confirm", "cancel", "refuse"].includes(intent) || !pendingActionId) {
      return Response.json({ error: "Choose confirm, cancel, or refuse." }, { status: 400 });
    }

    const pending = unwrap<Row | null>(
      await db().from("pending_actions").select("*").eq("id", pendingActionId).eq("admin_id", admin.id).maybeSingle(),
    );
    if (!pending || pending.status !== "pending") {
      return Response.json({ error: "This action is no longer waiting for a decision." }, { status: 409 });
    }

    const typed = pending as PendingAction;

    if (intent === "cancel" || intent === "refuse") {
      const event = intent === "cancel" ? "cancel" : "refuse";
      const summary = intent === "cancel" ? "Cancelled. The stored record was not changed." : "Refused. The stored record was not changed.";
      unwrap(await db().from("pending_actions").update({ status: event === "cancel" ? "cancelled" : "refused", resolved_at: new Date().toISOString() }).eq("id", pending.id));
      await writeAudit({
        adminId: admin.id,
        event,
        actionName: typed.action_name,
        pendingActionId: typed.id,
        targetType: typed.target_type,
        targetId: typed.target_id,
        summary,
        before: typed.before_data,
        after: typed.before_data,
      });
      const reply = await narrate({ kind: "refused", summary });
      const message = await markConfirmation(admin.id, typed.id, intent === "cancel" ? "cancelled" : "refused", reply);
      return Response.json({ message });
    }

    try {
      const result = await commitAction(typed);
      unwrap(await db().from("pending_actions").update({ status: "confirmed", resolved_at: new Date().toISOString() }).eq("id", pending.id));
      await writeAudit({
        adminId: admin.id,
        event: "confirm",
        actionName: typed.action_name,
        pendingActionId: typed.id,
        targetType: typed.target_type,
        targetId: typed.target_id,
        summary: result.summary,
        before: result.before,
        after: result.after,
      });
      const reply = await narrate({ kind: "done", summary: result.summary });
      const message = await markConfirmation(admin.id, typed.id, "confirmed", reply);
      return Response.json({ message });
    } catch (error) {
      if (!(error instanceof ActionRefusal)) throw error;
      unwrap(await db().from("pending_actions").update({ status: "refused", resolved_at: new Date().toISOString() }).eq("id", pending.id));
      await writeAudit({
        adminId: admin.id,
        event: "refuse",
        actionName: typed.action_name,
        pendingActionId: typed.id,
        targetType: typed.target_type,
        targetId: typed.target_id,
        summary: error.message,
        before: typed.before_data,
      });
      const reply = await narrate({ kind: "refused", summary: error.message });
      const message = await markConfirmation(admin.id, typed.id, "refused", reply);
      return Response.json({ message });
    }
  } catch (error) {
    return apiError(error);
  }
}
