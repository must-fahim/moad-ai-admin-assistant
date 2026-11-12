import { friendlyDbError, getServiceClient } from "@/lib/supabase";

export type Row = Record<string, any>;

export function db() {
  return getServiceClient() as any;
}

export function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw friendlyDbError(result.error);
  return result.data;
}
