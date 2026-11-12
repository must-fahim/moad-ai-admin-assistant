import { redirect } from "next/navigation";
import { GuideScreen } from "@/components/guide-screen";
import { getCurrentAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");
  return <GuideScreen admin={admin} />;
}
