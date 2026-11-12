import { cookies } from "next/headers";
import { checkPassword, sessionCookieOptions, SESSION_COOKIE, signAdminToken } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { friendlyDbError, getServiceClient } from "@/lib/supabase";
import { text } from "@/lib/labels";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = text(body.username).toLowerCase();
    const password = text(body.password);
    if (!username || !password) {
      return Response.json({ error: "Enter your username and password." }, { status: 400 });
    }

    const now = Date.now();
    const attempt = attempts.get(username);
    if (attempt && attempt.resetAt > now && attempt.count >= 8) {
      return Response.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429 });
    }

    const { data, error } = await getServiceClient()
      .from("admin_users")
      .select("id, username, password_hash, is_active")
      .eq("username", username)
      .maybeSingle();
    if (error) throw friendlyDbError(error);

    const valid = data ? await checkPassword(password, data.password_hash) : false;
    if (!data || !valid) {
      const current = attempts.get(username);
      attempts.set(username, {
        count: current && current.resetAt > now ? current.count + 1 : 1,
        resetAt: current && current.resetAt > now ? current.resetAt : now + 60_000,
      });
      return Response.json({ error: "Username or password is incorrect." }, { status: 401 });
    }
    if (!data.is_active) {
      return Response.json({ error: "This account is deactivated." }, { status: 403 });
    }

    attempts.delete(username);
    const token = await signAdminToken(data.id, data.username);
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, sessionCookieOptions());
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
