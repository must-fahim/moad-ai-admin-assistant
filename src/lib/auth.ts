import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { friendlyDbError, getServiceClient } from "@/lib/supabase";
import type { AdminProfile } from "@/lib/chat-types";

export const SESSION_COOKIE = "moad_session";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    const error = new Error("AUTH_SECRET is not set.");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }
  return new TextEncoder().encode(value);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function checkPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signAdminToken(adminId: string, username: string) {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export async function getCurrentAdmin(): Promise<AdminProfile | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let adminId = "";
  try {
    const { payload } = await jwtVerify(token, secret());
    adminId = typeof payload.sub === "string" ? payload.sub : "";
  } catch {
    jar.delete(SESSION_COOKIE);
    return null;
  }
  if (!adminId) return null;

  const { data, error } = await getServiceClient()
    .from("admin_users")
    .select("id, name, phone, country, username, is_active, is_primary")
    .eq("id", adminId)
    .maybeSingle();

  if (error) throw friendlyDbError(error);
  if (!data || !data.is_active) {
    jar.delete(SESSION_COOKIE);
    return null;
  }

  return data as AdminProfile;
}

export async function requireAdmin(): Promise<AdminProfile> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    const error = new Error("Sign in required.");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  return admin;
}
