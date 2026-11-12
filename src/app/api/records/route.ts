import { requireAdmin } from "@/lib/auth";
import { loadClientLists } from "@/lib/client-lists";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await loadClientLists());
  } catch (error) {
    return apiError(error);
  }
}
