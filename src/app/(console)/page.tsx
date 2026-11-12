import { ChatScreen } from "@/components/chat-screen";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt } = await searchParams;
  return <ChatScreen initialDraft={typeof prompt === "string" ? prompt : ""} />;
}
