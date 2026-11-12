import { ChatScreen } from "@/components/chat-screen";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt } = await searchParams;
  return <ChatScreen key={typeof prompt === "string" ? prompt : ""} initialDraft={typeof prompt === "string" ? prompt : ""} />;
}
