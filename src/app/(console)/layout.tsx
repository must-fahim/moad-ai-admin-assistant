import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");
  return <AppShell admin={admin}>{children}</AppShell>;
}
