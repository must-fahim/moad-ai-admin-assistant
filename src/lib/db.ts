import { friendlyDbError, getServiceClient } from "@/lib/supabase";

// The service client is used without generated database types.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

export function db() {
  return getServiceClient() as any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw friendlyDbError(result.error);
  return result.data;
}
