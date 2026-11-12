export type ResultColumn = { key: string; title: string };
export type ResultRow = Record<string, string | number>;

export type ChatPayload = {
  kind: "clarification" | "read" | "matches" | "confirmation" | "refused" | "done";
  columns?: ResultColumn[];
  rows?: ResultRow[];
  total?: number;
  matches?: { id: string; label: string; detail: string }[];
  resume?: { action: string; args: Record<string, unknown> };
  confirmation?: {
    pendingActionId: string;
    title: string;
    lines: { label: string; value: string }[];
    state: "pending" | "confirmed" | "cancelled" | "refused" | "expired";
  };
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload: ChatPayload | null;
  createdAt: string;
};

export type AdminProfile = {
  id: string;
  name: string;
  phone: string | null;
  country: string | null;
  username: string;
  is_active: boolean;
  is_primary: boolean;
};
