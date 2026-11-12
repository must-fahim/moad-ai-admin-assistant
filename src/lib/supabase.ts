import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getServiceClient(): SupabaseClient {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, run supabase/schema.sql, then npm run seed.");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }

  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return client;
}

export function friendlyDbError(error: { message: string }): Error {
  if (/does not exist|schema cache/i.test(error.message)) {
    const wrapped = new Error("The Supabase tables are missing. Run supabase/schema.sql in the SQL editor, then npm run seed.");
    (wrapped as Error & { status?: number }).status = 503;
    return wrapped;
  }
  return new Error(error.message);
}
