import { requireAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { friendlyDbError, getServiceClient } from "@/lib/supabase";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const current = await requireAdmin();
    const { id } = await context.params;
    const body = await request.json();
    if (typeof body.isActive !== "boolean") {
      return Response.json({ error: "Choose active or deactivated." }, { status: 400 });
    }
    if (id === current.id && !body.isActive) {
      return Response.json({ error: "You cannot deactivate the account you are using." }, { status: 400 });
    }

    const supabase = getServiceClient();
    const existing = await supabase.from("admin_users").select("id, is_primary, username").eq("id", id).maybeSingle();
    if (existing.error) throw friendlyDbError(existing.error);
    if (!existing.data) return Response.json({ error: "Admin not found." }, { status: 404 });
    if (existing.data.is_primary && !body.isActive) {
      return Response.json({ error: "The primary MOAD Admin account stays active." }, { status: 400 });
    }

    const updated = await supabase
      .from("admin_users")
      .update({ is_active: body.isActive })
      .eq("id", id)
      .select("id, name, phone, country, username, is_active, is_primary, created_at")
      .single();
    if (updated.error) throw friendlyDbError(updated.error);
    return Response.json({ admin: updated.data });
  } catch (error) {
    return apiError(error);
  }
}
