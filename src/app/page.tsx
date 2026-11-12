import { redirect } from "next/navigation";
import { ChatScreen } from "@/components/chat-screen";
import { getCurrentAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");
  const { prompt } = await searchParams;
  return <ChatScreen admin={admin} initialDraft={typeof prompt === "string" ? prompt : ""} />;
}
