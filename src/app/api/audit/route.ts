import { requireAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { friendlyDbError, getServiceClient } from "@/lib/supabase";

export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await getServiceClient()
      .from("audit_logs")
      .select("id, event, action_name, summary, created_at, admin_users(name)")
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw friendlyDbError(error);
    return Response.json({
      events: (data ?? []).map((row) => {
        const admin = row.admin_users as { name?: string } | { name?: string }[] | null;
        const name = Array.isArray(admin) ? admin[0]?.name : admin?.name;
        return {
          id: row.id,
          event: row.event,
          actionName: row.action_name,
          summary: row.summary,
          createdAt: row.created_at,
          adminName: name ?? "Admin",
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
