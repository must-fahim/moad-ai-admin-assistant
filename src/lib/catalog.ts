export const APP_PAGES = [
  { name: "Assistant", path: "/" },
  { name: "Sign in", path: "/login" },
  { name: "Question guide", path: "/guide" },
  { name: "Database tables", path: "/tables" },
] as const;

export type TableColumn = {
  name: string;
  type: string;
};

export type DatabaseTable = {
  name: string;
  columns: TableColumn[];
};

function cols(entries: [string, string][]): TableColumn[] {
  return entries.map(([name, type]) => ({ name, type }));
}

export const DATABASE_TABLES: DatabaseTable[] = [
  {
    name: "admin_users",
    columns: cols([
      ["id", "uuid"],
      ["name", "text"],
      ["phone", "text"],
      ["country", "text"],
      ["username", "text"],
      ["password_hash", "text"],
      ["is_active", "boolean"],
      ["is_primary", "boolean"],
      ["created_at", "timestamptz"],
    ]),
  },
  {
    name: "advertisers",
    columns: cols([
      ["id", "uuid"],
      ["company_name", "text"],
      ["email", "text"],
      ["company_phone", "text"],
      ["contact_name", "text"],
      ["contact_phone", "text"],
      ["business_registration_no", "text"],
      ["status", "text"],
      ["registered_at", "timestamptz"],
    ]),
  },
  {
    name: "cargo_partners",
    columns: cols([
      ["id", "uuid"],
      ["member_number", "text"],
      ["name", "text"],
      ["phone", "text"],
      ["vehicle_number", "text"],
      ["vehicle_type", "text"],
      ["fixed_operating_location", "boolean"],
      ["region_label", "text"],
      ["status", "text"],
      ["registered_at", "timestamptz"],
    ]),
  },
  {
    name: "campaigns",
    columns: cols([
      ["id", "uuid"],
      ["advertiser_id", "uuid"],
      ["name", "text"],
      ["status", "text"],
      ["starts_on", "date"],
      ["ends_on", "date"],
      ["contact_name", "text"],
      ["contact_phone", "text"],
      ["recruitment_status", "text"],
      ["coverage_type", "text"],
      ["applied_at", "timestamptz"],
    ]),
  },
  {
    name: "campaign_applications",
    columns: cols([
      ["id", "uuid"],
      ["campaign_id", "uuid"],
      ["cargo_partner_id", "uuid"],
      ["status", "text"],
      ["region_label", "text"],
      ["applied_at", "timestamptz"],
    ]),
  },
  {
    name: "daily_distances",
    columns: cols([
      ["id", "uuid"],
      ["campaign_id", "uuid"],
      ["cargo_partner_id", "uuid"],
      ["service_date", "date"],
      ["distance_km", "numeric"],
    ]),
  },
  {
    name: "cargo_settlements",
    columns: cols([
      ["id", "uuid"],
      ["cargo_partner_id", "uuid"],
      ["settlement_month", "date"],
      ["status", "text"],
      ["operation_count", "integer"],
      ["distance_km", "numeric"],
      ["prorated_days", "integer"],
      ["daily_cap_km", "numeric"],
      ["base_amount_krw", "integer"],
      ["additional_amount_krw", "integer"],
      ["tax_amount_krw", "integer"],
      ["final_amount_krw", "integer"],
      ["memo", "text"],
    ]),
  },
  {
    name: "cargo_settlement_lines",
    columns: cols([
      ["id", "uuid"],
      ["settlement_id", "uuid"],
      ["fee_type", "text"],
      ["quantity", "integer"],
      ["unit_price_krw", "integer"],
      ["amount_krw", "integer"],
    ]),
  },
  {
    name: "advertiser_settlements",
    columns: cols([
      ["id", "uuid"],
      ["campaign_id", "uuid"],
      ["settlement_month", "date"],
      ["status", "text"],
      ["coverage_type", "text"],
      ["discount_rate", "numeric"],
      ["final_amount_krw", "integer"],
    ]),
  },
  {
    name: "solo_pay_accounts",
    columns: cols([
      ["id", "uuid"],
      ["advertiser_id", "uuid"],
      ["linked", "boolean"],
      ["balance_krw", "integer"],
      ["total_accumulated_krw", "integer"],
      ["month_topup_krw", "integer"],
      ["month_deduction_krw", "integer"],
    ]),
  },
  {
    name: "solo_pay_transactions",
    columns: cols([
      ["id", "uuid"],
      ["advertiser_id", "uuid"],
      ["occurred_at", "timestamptz"],
      ["category", "text"],
      ["detail", "text"],
      ["amount_krw", "integer"],
    ]),
  },
  {
    name: "faqs",
    columns: cols([
      ["id", "uuid"],
      ["category", "text"],
      ["question", "text"],
      ["answer", "text"],
      ["exposed", "boolean"],
      ["pinned", "boolean"],
      ["sort_order", "integer"],
      ["author_name", "text"],
      ["created_at", "timestamptz"],
    ]),
  },
  {
    name: "notices",
    columns: cols([
      ["id", "uuid"],
      ["audience", "text"],
      ["post_type", "text"],
      ["title", "text"],
      ["body", "text"],
      ["pinned", "boolean"],
      ["sort_order", "integer"],
      ["author_name", "text"],
      ["created_at", "timestamptz"],
    ]),
  },
  {
    name: "pending_actions",
    columns: cols([
      ["id", "uuid"],
      ["admin_id", "uuid"],
      ["action_name", "text"],
      ["args", "jsonb"],
      ["target_type", "text"],
      ["target_id", "uuid"],
      ["summary", "text"],
      ["before_data", "jsonb"],
      ["status", "text"],
      ["created_at", "timestamptz"],
      ["resolved_at", "timestamptz"],
    ]),
  },
  {
    name: "audit_logs",
    columns: cols([
      ["id", "uuid"],
      ["admin_id", "uuid"],
      ["pending_action_id", "uuid"],
      ["event", "text"],
      ["action_name", "text"],
      ["target_type", "text"],
      ["target_id", "uuid"],
      ["summary", "text"],
      ["before_data", "jsonb"],
      ["after_data", "jsonb"],
      ["created_at", "timestamptz"],
    ]),
  },
  {
    name: "chat_messages",
    columns: cols([
      ["id", "uuid"],
      ["admin_id", "uuid"],
      ["role", "text"],
      ["content", "text"],
      ["payload", "jsonb"],
      ["created_at", "timestamptz"],
    ]),
  },
];
