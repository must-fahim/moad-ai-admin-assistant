import { getCurrentAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return Response.json({ error: "Sign in required." }, { status: 401 });
    return Response.json({ admin });
  } catch (error) {
    return apiError(error);
  }
}
