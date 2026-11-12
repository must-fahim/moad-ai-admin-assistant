import { friendlyDbError, getServiceClient } from "@/lib/supabase";

type AuditInput = {
  adminId: string;
  event: "confirm" | "cancel" | "refuse";
  actionName: string;
  summary: string;
  pendingActionId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function writeAudit(input: AuditInput) {
  const { error } = await getServiceClient().from("audit_logs").insert({
    admin_id: input.adminId,
    pending_action_id: input.pendingActionId ?? null,
    event: input.event,
    action_name: input.actionName,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    summary: input.summary,
    before_data: input.before ?? null,
    after_data: input.after ?? null,
  });
  if (error) throw friendlyDbError(error);
}
