import { redirect } from "next/navigation";
import { ChatScreen } from "@/components/chat-screen";
import { getCurrentAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");
  return <ChatScreen admin={admin} />;
}
