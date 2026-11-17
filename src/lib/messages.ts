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

const MESSAGE_COLUMNS = "id, role, content, payload, created_at";

function messageQuery(adminId: string) {
  return db().from("chat_messages").select(MESSAGE_COLUMNS).eq("admin_id", adminId).order("created_at", { ascending: true }).limit(80);
}

function pendingQuery(adminId: string) {
  return db().from("pending_actions").select("id").eq("admin_id", adminId).eq("status", "pending");
}

export async function listMessages(adminId: string) {
  return unwrap<Row[]>(await messageQuery(adminId)).map(toMessage);
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
  const rows = unwrap<Row[]>(
    await db()
      .from("chat_messages")
      .select("role, content, payload")
      .eq("admin_id", adminId)
      .order("created_at", { ascending: false })
      .limit(8),
  );
  const kept: { role: "user" | "assistant"; content: string }[] = [];
  const chronological = rows.reverse();
  for (let index = 0; index < chronological.length; index += 1) {
    const row = chronological[index];
    const next = chronological[index + 1];
    const nextKind = (next?.payload as ChatPayload | null)?.kind;
    if (row.role === "user" && next?.role === "assistant" && nextKind === "clarification") {
      index += 1;
      continue;
    }
    if (row.role === "assistant" && (row.payload as ChatPayload | null)?.kind === "clarification") continue;
    kept.push({
      role: row.role as "user" | "assistant",
      content: String(row.content ?? ""),
    });
  }
  return kept.slice(-4);
}

export async function openChat(adminId: string) {
  const [messageResult, pendingResult] = await Promise.all([messageQuery(adminId), pendingQuery(adminId)]);
  const messages = unwrap<Row[]>(messageResult);
  const closed = await expireConfirmations(adminId, messages, unwrap<Row[]>(pendingResult), true);
  if (closed.length === 0) return messages.map(toMessage);
  const replacements = new Map(closed.map((message) => [message.id, message]));
  return messages.map((row) => replacements.get(String(row.id)) ?? toMessage(row));
}

export async function closeOpenConfirmations(adminId: string, onlyStale = false): Promise<ChatMessage[]> {
  const [messageResult, pendingResult] = await Promise.all([messageQuery(adminId), pendingQuery(adminId)]);
  return expireConfirmations(adminId, unwrap<Row[]>(messageResult), unwrap<Row[]>(pendingResult), onlyStale);
}

async function expireConfirmations(adminId: string, messages: Row[], pending: Row[], onlyStale: boolean): Promise<ChatMessage[]> {
  if (pending.length === 0) return [];
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

  return Promise.all(targets.map(async (row) => {
    const payload = row.payload as ChatPayload;
    const next: ChatPayload = {
      ...payload,
      kind: "refused",
      confirmation: { ...payload.confirmation!, state: "expired" },
    };
    const updated = unwrap<Row>(
      await db().from("chat_messages").update({ payload: next }).eq("id", row.id).select(MESSAGE_COLUMNS).single(),
    );
    return toMessage(updated);
  }));
}

export async function markConfirmation(adminId: string, pendingActionId: string, state: "confirmed" | "cancelled" | "refused", content: string) {
  const rows = unwrap<Row[]>(
    await db().from("chat_messages").select(MESSAGE_COLUMNS).eq("admin_id", adminId).order("created_at", { ascending: false }).limit(20),
  );
  const match = rows.find((row) => row.payload?.confirmation?.pendingActionId === pendingActionId);
  if (!match) return null;
  const payload = {
    ...(match.payload as ChatPayload),
    kind: state === "confirmed" ? "done" : "refused",
    confirmation: { ...(match.payload as ChatPayload).confirmation!, state },
  } satisfies ChatPayload;
  const updated = unwrap<Row>(await db().from("chat_messages").update({ content, payload }).eq("id", match.id).select(MESSAGE_COLUMNS).single());
  return toMessage(updated);
}
