import { TablesScreen } from "@/components/tables-screen";
import { loadClientLists } from "@/lib/client-lists";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  const lists = await loadClientLists();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "";
  return <TablesScreen lists={lists} origin={origin} />;
}
