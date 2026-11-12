import { db, unwrap, type Row } from "@/lib/db";
import type { ChatMessage, ChatPayload } from "@/lib/chat-types";

export function toMessage(row: Row): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    payload: (row.payload as ChatPayload | null) ?? null,
    createdAt: row.created_at,
  };
}

export async function listMessages(adminId: string) {
  const rows = unwrap<Row[]>(
    await db().from("chat_messages").select("*").eq("admin_id", adminId).order("created_at", { ascending: true }).limit(200),
  );
  return rows.map(toMessage);
}

export async function addMessage(adminId: string, role: "user" | "assistant", content: string, payload?: ChatPayload | null) {
  const row = unwrap<Row>(
    await db()
      .from("chat_messages")
      .insert({ admin_id: adminId, role, content, payload: payload ?? null })
      .select("*")
      .single(),
  );
  return toMessage(row);
}

export async function recentHistory(adminId: string) {
  const messages = await listMessages(adminId);
  return messages.slice(-6).map((message) => ({ role: message.role, content: message.content }));
}

export async function closeOpenConfirmations(adminId: string, onlyStale = false): Promise<ChatMessage[]> {
  const pending = unwrap<Row[]>(
    await db().from("pending_actions").select("id").eq("admin_id", adminId).eq("status", "pending"),
  );
  if (pending.length === 0) return [];
  const messages = unwrap<Row[]>(
    await db().from("chat_messages").select("*").eq("admin_id", adminId).order("created_at", { ascending: true }).limit(200),
  );
  const latestId = messages.at(-1)?.id;
  const pendingIds = new Set(pending.map((row) => String(row.id)));
  const targets = messages.filter((row) => {
    const confirmation = (row.payload as ChatPayload | null)?.confirmation;
    if (!confirmation || confirmation.state !== "pending" || !pendingIds.has(confirmation.pendingActionId)) return false;
    return onlyStale ? row.id !== latestId : true;
  });
  if (targets.length === 0) return [];
  const ids = targets.map((row) => (row.payload as ChatPayload).confirmation!.pendingActionId);
  unwrap(
    await db()
      .from("pending_actions")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .in("id", ids)
      .eq("admin_id", adminId)
      .eq("status", "pending"),
  );

  const closed: ChatMessage[] = [];
  for (const row of targets) {
    const payload = row.payload as ChatPayload;
    const next: ChatPayload = {
      ...payload,
      kind: "refused",
      confirmation: { ...payload.confirmation!, state: "expired" },
    };
    const updated = unwrap<Row>(
      await db().from("chat_messages").update({ payload: next }).eq("id", row.id).select("*").single(),
    );
    closed.push(toMessage(updated));
  }
  return closed;
}

export async function markConfirmation(adminId: string, pendingActionId: string, state: "confirmed" | "cancelled" | "refused", content: string) {
  const rows = unwrap<Row[]>(
    await db().from("chat_messages").select("*").eq("admin_id", adminId).order("created_at", { ascending: false }).limit(40),
  );
  const match = rows.find((row) => row.payload?.confirmation?.pendingActionId === pendingActionId);
  if (!match) return null;
  const payload = {
    ...(match.payload as ChatPayload),
    kind: state === "confirmed" ? "done" : "refused",
    confirmation: { ...(match.payload as ChatPayload).confirmation!, state },
  } satisfies ChatPayload;
  const updated = unwrap<Row>(await db().from("chat_messages").update({ content, payload }).eq("id", match.id).select("*").single());
  return toMessage(updated);
}
