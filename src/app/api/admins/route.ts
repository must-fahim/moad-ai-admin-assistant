import { z } from "zod";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { COUNTRIES } from "@/lib/countries";
import { apiError } from "@/lib/http";
import { friendlyDbError, getServiceClient } from "@/lib/supabase";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(30),
  country: z.string().refine((value) => COUNTRIES.includes(value), "Choose a country from the list."),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "Use 3–40 letters, numbers, dots, or underscores."),
  password: z.string().min(8).max(80),
});

export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await getServiceClient()
      .from("admin_users")
      .select("id, name, phone, country, username, is_active, is_primary, created_at")
      .order("created_at", { ascending: true });
    if (error) throw friendlyDbError(error);
    return Response.json({ admins: data });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message || "Check the admin details." }, { status: 400 });
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const { data, error } = await getServiceClient()
      .from("admin_users")
      .insert({
        name: parsed.data.name,
        phone: parsed.data.phone,
        country: parsed.data.country,
        username: parsed.data.username,
        password_hash: passwordHash,
        is_active: true,
        is_primary: false,
      })
      .select("id, name, phone, country, username, is_active, is_primary, created_at")
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return Response.json({ error: "That username is already in use." }, { status: 409 });
      }
      throw friendlyDbError(error);
    }
    return Response.json({ admin: data });
  } catch (error) {
    return apiError(error);
  }
}
