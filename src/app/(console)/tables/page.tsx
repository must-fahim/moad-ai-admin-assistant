import { TablesScreen } from "@/components/tables-screen";
import { loadClientLists } from "@/lib/client-lists";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  const lists = await loadClientLists();
  return <TablesScreen lists={lists} />;
}
