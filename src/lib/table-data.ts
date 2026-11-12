import { DATABASE_TABLES } from "@/lib/catalog";
import { db } from "@/lib/db";

export type TableSnapshot = {
  rows: Record<string, string>[];
  total: number;
  error?: string;
};

const ORDER_BY: Record<string, string> = {
  admin_users: "created_at",
  advertisers: "registered_at",
  cargo_partners: "registered_at",
  campaigns: "applied_at",
  campaign_applications: "applied_at",
  daily_distances: "service_date",
  cargo_settlements: "settlement_month",
  advertiser_settlements: "settlement_month",
  solo_pay_transactions: "occurred_at",
  faqs: "sort_order",
  notices: "sort_order",
  pending_actions: "created_at",
  audit_logs: "created_at",
  chat_messages: "created_at",
};

function cell(column: string, value: unknown): string {
  if (column === "password_hash") return "hidden";
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function loadTableData(): Promise<Record<string, TableSnapshot>> {
  const snapshots = await Promise.all(
    DATABASE_TABLES.map(async (table) => {
      const order = ORDER_BY[table.name];
      let query = db().from(table.name).select("*", { count: "exact" });
      if (order) query = query.order(order, { ascending: true });
      const result = await query.limit(1000);
      if (result.error) {
        return [table.name, { rows: [], total: 0, error: result.error.message }] as const;
      }
      const source = (result.data ?? []) as Record<string, unknown>[];
      const rows = source.map((row) =>
        Object.fromEntries(table.columns.map((column) => [column.name, cell(column.name, row[column.name])])),
      );
      return [table.name, { rows, total: result.count ?? rows.length }] as const;
    }),
  );
  return Object.fromEntries(snapshots);
}
