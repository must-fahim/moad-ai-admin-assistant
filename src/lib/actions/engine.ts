import { readActions } from "@/lib/actions/reads";
import { commitAction, writeActions } from "@/lib/actions/writes";
import type { ActionContext, ActionHandler, ActionOutcome, Args } from "@/lib/actions/types";

const actions: Record<string, ActionHandler> = { ...readActions, ...writeActions };

export function listActions() {
  return Object.entries(actions).map(([name, handler]) => ({
    name,
    kind: handler.kind,
    description: handler.description,
    args: handler.args,
  }));
}

export async function runAction(name: string, args: Args, ctx: ActionContext): Promise<ActionOutcome> {
  const handler = actions[name];
  if (!handler) {
    return {
      kind: "clarification",
      summary: `“${name}” is not one of the approved actions. Ask for a search, a count, or a change that is on the list.`,
    };
  }
  return handler.run(args ?? {}, ctx);
}

export { commitAction };
