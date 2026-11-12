import type { ChatPayload } from "@/lib/chat-types";

export type Args = Record<string, unknown>;

export type ActionContext = {
  adminId: string;
};

export type ActionOutcome = {
  kind: ChatPayload["kind"];
  summary: string;
  columns?: ChatPayload["columns"];
  rows?: ChatPayload["rows"];
  total?: number;
  matches?: ChatPayload["matches"];
  resume?: ChatPayload["resume"];
  confirmation?: ChatPayload["confirmation"];
};

export type ActionHandler = {
  kind: "read" | "write";
  description: string;
  args: string;
  run: (args: Args, ctx: ActionContext) => Promise<ActionOutcome>;
};

export type PendingAction = {
  id: string;
  admin_id: string;
  action_name: string;
  args: Args;
  target_type: string;
  target_id: string | null;
  summary: string;
  before_data: Record<string, unknown> | null;
  status: string;
};
