import { db, unwrap, type Row } from "@/lib/db";
import { booleanValue, canonical, km, krw, labelize, like, monthStart, text } from "@/lib/labels";
import type { ActionHandler, Args } from "@/lib/actions/types";

type Filter = {
  arg: string;
  column: string;
  mode: "eq" | "ilike" | "status" | "bool" | "month";
};

type Column = { key: string; title: string };

function applyFilters(query: any, args: Args, filters: Filter[]) {
  let next = query;
  const applied: string[] = [];
  for (const filter of filters) {
    const raw = args[filter.arg];
    if (raw == null || raw === "") continue;
    if (filter.mode === "eq") {
      next = next.eq(filter.column, String(raw));
      applied.push(`${labelize(filter.arg)} ${raw}`);
    } else if (filter.mode === "ilike") {
      const value = text(raw);
      if (!value) continue;
      next = next.ilike(filter.column, like(value));
      applied.push(`${labelize(filter.arg)} contains “${value}”`);
    } else if (filter.mode === "status") {
      const value = canonical(raw);
      if (!value) continue;
      next = next.eq(filter.column, value);
      applied.push(`${labelize(filter.arg)} ${labelize(value)}`);
    } else if (filter.mode === "bool") {
      const value = booleanValue(raw);
      if (value == null) continue;
      next = next.eq(filter.column, value);
      applied.push(`${labelize(filter.arg)} ${value ? "yes" : "no"}`);
    } else if (filter.mode === "month") {
      const value = monthStart(raw);
      if (!value) continue;
      next = next.eq(filter.column, value);
      applied.push(`month ${value.slice(0, 7)}`);
    }
  }
  return { query: next, applied };
}

function phrase(applied: string[]) {
  return applied.length ? ` Filters: ${applied.join("; ")}.` : "";
}

function defineList(options: {
  name: string;
  description: string;
  args: string;
  table: string;
  select: string;
  filters: Filter[];
  order: string;
  singular: string;
  plural: string;
  columns: Column[];
  map: (row: Row) => Record<string, string | number>;
}): ActionHandler {
  return {
    kind: "read",
    description: options.description,
    args: options.args,
    async run(args) {
      const filtered = applyFilters(
        db().from(options.table).select(options.select, { count: "exact" }).order(options.order, { ascending: false }),
        args,
        options.filters,
      );
      const result = await filtered.query.limit(15);
      if (result.error) throw new Error(result.error.message);
      const total = result.count ?? result.data?.length ?? 0;
      const rows = (result.data ?? []).map(options.map);
      const summary =
        total === 0
          ? `No ${options.plural} matched.${phrase(filtered.applied)}`
          : `Found ${total} ${total === 1 ? options.singular : options.plural}. Showing ${rows.length}.${phrase(filtered.applied)}`;
      return { kind: "read", summary, columns: options.columns, rows, total };
    },
  };
}

function defineCount(options: {
  name: string;
  description: string;
  args: string;
  table: string;
  select: string;
  filters: Filter[];
  singular: string;
  plural: string;
}): ActionHandler {
  return {
    kind: "read",
    description: options.description,
    args: options.args,
    async run(args) {
      const filtered = applyFilters(
        db().from(options.table).select(options.select, { count: "exact", head: true }),
        args,
        options.filters,
      );
      const result = await filtered.query;
      if (result.error) throw new Error(result.error.message);
      const total = result.count ?? 0;
      return {
        kind: "read",
        summary: `${total} ${total === 1 ? options.singular : options.plural} match.${phrase(filtered.applied)}`,
        total,
        columns: [{ key: "count", title: "Count" }],
        rows: [{ count: total }],
      };
    },
  };
}

const advertiserFilters: Filter[] = [
  { arg: "id", column: "id", mode: "eq" },
  { arg: "status", column: "status", mode: "status" },
  { arg: "company_name", column: "company_name", mode: "ilike" },
  { arg: "email", column: "email", mode: "ilike" },
  { arg: "contact_name", column: "contact_name", mode: "ilike" },
];

const cargoFilters: Filter[] = [
  { arg: "id", column: "id", mode: "eq" },
  { arg: "status", column: "status", mode: "status" },
  { arg: "name", column: "name", mode: "ilike" },
  { arg: "member_number", column: "member_number", mode: "ilike" },
  { arg: "vehicle_type", column: "vehicle_type", mode: "ilike" },
  { arg: "region", column: "region_label", mode: "ilike" },
  { arg: "fixed_operating_location", column: "fixed_operating_location", mode: "bool" },
];

const campaignFilters: Filter[] = [
  { arg: "id", column: "id", mode: "eq" },
  { arg: "status", column: "status", mode: "status" },
  { arg: "name", column: "name", mode: "ilike" },
  { arg: "recruitment_status", column: "recruitment_status", mode: "status" },
  { arg: "coverage_type", column: "coverage_type", mode: "status" },
  { arg: "company_name", column: "advertisers.company_name", mode: "ilike" },
];

const applicationFilters: Filter[] = [
  { arg: "id", column: "id", mode: "eq" },
  { arg: "status", column: "status", mode: "status" },
  { arg: "campaign_name", column: "campaigns.name", mode: "ilike" },
  { arg: "partner_name", column: "cargo_partners.name", mode: "ilike" },
  { arg: "member_number", column: "cargo_partners.member_number", mode: "ilike" },
  { arg: "region", column: "region_label", mode: "ilike" },
];

const cargoSettlementFilters: Filter[] = [
  { arg: "id", column: "id", mode: "eq" },
  { arg: "status", column: "status", mode: "status" },
  { arg: "month", column: "settlement_month", mode: "month" },
  { arg: "partner_name", column: "cargo_partners.name", mode: "ilike" },
  { arg: "member_number", column: "cargo_partners.member_number", mode: "ilike" },
];

const advertiserSettlementFilters: Filter[] = [
  { arg: "id", column: "id", mode: "eq" },
  { arg: "status", column: "status", mode: "status" },
  { arg: "month", column: "settlement_month", mode: "month" },
  { arg: "campaign_name", column: "campaigns.name", mode: "ilike" },
  { arg: "company_name", column: "campaigns.advertisers.company_name", mode: "ilike" },
];

const soloFilters: Filter[] = [
  { arg: "linked", column: "linked", mode: "bool" },
  { arg: "company_name", column: "advertisers.company_name", mode: "ilike" },
  { arg: "status", column: "advertisers.status", mode: "status" },
];

const faqFilters: Filter[] = [
  { arg: "id", column: "id", mode: "eq" },
  { arg: "category", column: "category", mode: "status" },
  { arg: "question", column: "question", mode: "ilike" },
  { arg: "exposed", column: "exposed", mode: "bool" },
  { arg: "pinned", column: "pinned", mode: "bool" },
];

const noticeFilters: Filter[] = [
  { arg: "id", column: "id", mode: "eq" },
  { arg: "audience", column: "audience", mode: "status" },
  { arg: "title", column: "title", mode: "ilike" },
  { arg: "pinned", column: "pinned", mode: "bool" },
];

function period(row: Row) {
  return `${row.starts_on} – ${row.ends_on}`;
}

export const readActions: Record<string, ActionHandler> = {
  search_advertisers: defineList({
    name: "search_advertisers",
    description: "List advertiser companies. Filter by status, company name, email, or contact name.",
    args: "status, company_name, email, contact_name, id",
    table: "advertisers",
    select: "id, company_name, email, contact_name, contact_phone, status, registered_at",
    filters: advertiserFilters,
    order: "registered_at",
    singular: "advertiser",
    plural: "advertisers",
    columns: [
      { key: "company", title: "Company" },
      { key: "status", title: "Status" },
      { key: "contact", title: "Contact" },
      { key: "email", title: "Email" },
    ],
    map: (row) => ({
      company: row.company_name,
      status: labelize(row.status),
      contact: row.contact_name ?? "—",
      email: row.email,
    }),
  }),
  count_advertisers: defineCount({
    name: "count_advertisers",
    description: "Count advertisers, with optional status, company, email, or contact filters.",
    args: "status, company_name, email, contact_name",
    table: "advertisers",
    select: "id",
    filters: advertiserFilters,
    singular: "advertiser",
    plural: "advertisers",
  }),
  search_cargo_partners: defineList({
    name: "search_cargo_partners",
    description: "List cargo partners. Filter by name, member number, status, vehicle type, region, or fixed location.",
    args: "name, member_number, status, vehicle_type, region, fixed_operating_location, id",
    table: "cargo_partners",
    select: "id, member_number, name, phone, vehicle_number, vehicle_type, fixed_operating_location, region_label, status",
    filters: cargoFilters,
    order: "registered_at",
    singular: "cargo partner",
    plural: "cargo partners",
    columns: [
      { key: "member", title: "Member" },
      { key: "name", title: "Name" },
      { key: "status", title: "Status" },
      { key: "vehicle", title: "Vehicle" },
      { key: "region", title: "Region" },
    ],
    map: (row) => ({
      member: row.member_number,
      name: row.name,
      status: labelize(row.status),
      vehicle: row.vehicle_type ?? "—",
      region: row.region_label ?? "—",
    }),
  }),
  count_cargo_partners: defineCount({
    name: "count_cargo_partners",
    description: "Count cargo partners with the same filters as the cargo search.",
    args: "name, member_number, status, vehicle_type, region, fixed_operating_location",
    table: "cargo_partners",
    select: "id",
    filters: cargoFilters,
    singular: "cargo partner",
    plural: "cargo partners",
  }),
  search_campaigns: defineList({
    name: "search_campaigns",
    description: "List campaigns. Filter by status, ad name, company, recruitment, or coverage type.",
    args: "status, name, company_name, recruitment_status, coverage_type, id",
    table: "campaigns",
    select: "id, name, status, starts_on, ends_on, recruitment_status, coverage_type, advertisers!inner(company_name), campaign_applications(count)",
    filters: campaignFilters,
    order: "applied_at",
    singular: "campaign",
    plural: "campaigns",
    columns: [
      { key: "name", title: "Ad name" },
      { key: "company", title: "Company" },
      { key: "status", title: "Status" },
      { key: "period", title: "Period" },
      { key: "vehicles", title: "Vehicles" },
    ],
    map: (row) => ({
      name: row.name,
      company: row.advertisers?.company_name ?? "—",
      status: labelize(row.status),
      period: period(row),
      vehicles: Array.isArray(row.campaign_applications) ? row.campaign_applications[0]?.count ?? 0 : 0,
    }),
  }),
  count_campaigns: defineCount({
    name: "count_campaigns",
    description: "Count campaigns. Use this for status tabs such as in progress, paused, ended, or under review.",
    args: "status, name, company_name, recruitment_status, coverage_type",
    table: "campaigns",
    select: "id, advertisers!inner(company_name)",
    filters: campaignFilters,
    singular: "campaign",
    plural: "campaigns",
  }),
  search_applications: defineList({
    name: "search_applications",
    description: "List cargo partner applications on campaigns.",
    args: "status, campaign_name, partner_name, member_number, region, id",
    table: "campaign_applications",
    select: "id, status, region_label, applied_at, campaigns!inner(name), cargo_partners!inner(name, member_number, vehicle_type)",
    filters: applicationFilters,
    order: "applied_at",
    singular: "application",
    plural: "applications",
    columns: [
      { key: "partner", title: "Partner" },
      { key: "member", title: "Member" },
      { key: "campaign", title: "Campaign" },
      { key: "status", title: "Status" },
      { key: "region", title: "Region" },
    ],
    map: (row) => ({
      partner: row.cargo_partners?.name ?? "—",
      member: row.cargo_partners?.member_number ?? "—",
      campaign: row.campaigns?.name ?? "—",
      status: labelize(row.status),
      region: row.region_label ?? "—",
    }),
  }),
  count_applications: defineCount({
    name: "count_applications",
    description: "Count campaign applications with status, campaign, partner, or region filters.",
    args: "status, campaign_name, partner_name, member_number, region",
    table: "campaign_applications",
    select: "id, campaigns!inner(name), cargo_partners!inner(name, member_number)",
    filters: applicationFilters,
    singular: "application",
    plural: "applications",
  }),
  sum_distance: {
    kind: "read",
    description: "Sum recorded kilometres for a campaign, cargo partner, or date range.",
    args: "campaign_name, partner_name, member_number, from, to",
    async run(args) {
      let query = db()
        .from("daily_distances")
        .select("distance_km, service_date, campaigns!inner(name), cargo_partners!inner(name, member_number)")
        .limit(1000);
      const applied: string[] = [];
      if (text(args.campaign_name)) {
        query = query.ilike("campaigns.name", like(text(args.campaign_name)));
        applied.push(`campaign contains “${text(args.campaign_name)}”`);
      }
      if (text(args.partner_name)) {
        query = query.ilike("cargo_partners.name", like(text(args.partner_name)));
        applied.push(`partner contains “${text(args.partner_name)}”`);
      }
      if (text(args.member_number)) {
        query = query.ilike("cargo_partners.member_number", like(text(args.member_number)));
        applied.push(`member ${text(args.member_number)}`);
      }
      if (text(args.from)) {
        query = query.gte("service_date", text(args.from));
        applied.push(`from ${text(args.from)}`);
      }
      if (text(args.to)) {
        query = query.lte("service_date", text(args.to));
        applied.push(`to ${text(args.to)}`);
      }
      const rows = unwrap<Row[]>(await query);
      const totalKm = rows.reduce((sum: number, row: Row) => sum + Number(row.distance_km || 0), 0);
      return {
        kind: "read",
        summary: `${km(totalKm)} across ${rows.length} day ${rows.length === 1 ? "record" : "records"}.${phrase(applied)}`,
        total: rows.length,
        columns: [
          { key: "distance", title: "Distance" },
          { key: "days", title: "Day records" },
        ],
        rows: [{ distance: km(totalKm), days: rows.length }],
      };
    },
  },
  count_operation_days: {
    kind: "read",
    description: "Count distinct days that have a distance greater than zero.",
    args: "campaign_name, partner_name, member_number, from, to",
    async run(args) {
      let query = db()
        .from("daily_distances")
        .select("service_date, distance_km, campaigns!inner(name), cargo_partners!inner(name, member_number)")
        .gt("distance_km", 0)
        .limit(1000);
      if (text(args.campaign_name)) query = query.ilike("campaigns.name", like(text(args.campaign_name)));
      if (text(args.partner_name)) query = query.ilike("cargo_partners.name", like(text(args.partner_name)));
      if (text(args.member_number)) query = query.ilike("cargo_partners.member_number", like(text(args.member_number)));
      if (text(args.from)) query = query.gte("service_date", text(args.from));
      if (text(args.to)) query = query.lte("service_date", text(args.to));
      const rows = unwrap<Row[]>(await query);
      const days = new Set(rows.map((row: Row) => row.service_date)).size;
      return {
        kind: "read",
        summary: `${days} ${days === 1 ? "day has" : "days have"} a recorded distance above zero.`,
        total: days,
        columns: [{ key: "days", title: "Operating days" }],
        rows: [{ days }],
      };
    },
  },
  search_cargo_settlements: defineList({
    name: "search_cargo_settlements",
    description: "List operating-partner settlements by month, status, or partner.",
    args: "month, status, partner_name, member_number, id",
    table: "cargo_settlements",
    select: "id, settlement_month, status, operation_count, distance_km, final_amount_krw, cargo_partners!inner(name, member_number, vehicle_type)",
    filters: cargoSettlementFilters,
    order: "settlement_month",
    singular: "cargo settlement",
    plural: "cargo settlements",
    columns: [
      { key: "partner", title: "Partner" },
      { key: "month", title: "Month" },
      { key: "status", title: "Status" },
      { key: "distance", title: "Distance" },
      { key: "amount", title: "Final amount" },
    ],
    map: (row) => ({
      partner: row.cargo_partners?.name ?? "—",
      month: String(row.settlement_month).slice(0, 7),
      status: labelize(row.status),
      distance: km(Number(row.distance_km || 0)),
      amount: krw(row.final_amount_krw),
    }),
  }),
  count_cargo_settlements: defineCount({
    name: "count_cargo_settlements",
    description: "Count operating-partner settlements.",
    args: "month, status, partner_name, member_number",
    table: "cargo_settlements",
    select: "id, cargo_partners!inner(name, member_number)",
    filters: cargoSettlementFilters,
    singular: "cargo settlement",
    plural: "cargo settlements",
  }),
  summarize_cargo_settlements: {
    kind: "read",
    description: "Summarize operating-partner settlement cards: partner count, total payout, paid, and unpaid.",
    args: "month, partner_name",
    async run(args) {
      let query = db()
        .from("cargo_settlements")
        .select("status, final_amount_krw, cargo_partners!inner(name)")
        .limit(1000);
      const month = monthStart(args.month);
      if (month) query = query.eq("settlement_month", month);
      if (text(args.partner_name)) query = query.ilike("cargo_partners.name", like(text(args.partner_name)));
      const rows = unwrap<Row[]>(await query);
      const paid = rows.filter((row) => row.status === "settlement_confirmed");
      const unpaid = rows.filter((row) => row.status === "before_settlement");
      const sum = (items: Row[]) => items.reduce((total, row) => total + Number(row.final_amount_krw || 0), 0);
      return {
        kind: "read",
        summary: `${rows.length} operating-partner settlements. Paid ${krw(sum(paid))}. Unpaid ${krw(sum(unpaid))}.`,
        total: rows.length,
        columns: [
          { key: "partners", title: "Settlements" },
          { key: "total", title: "Total payout" },
          { key: "paid", title: "Paid" },
          { key: "unpaid", title: "Unpaid" },
        ],
        rows: [{ partners: rows.length, total: krw(sum(rows)), paid: krw(sum(paid)), unpaid: krw(sum(unpaid)) }],
      };
    },
  },
  search_advertiser_settlements: defineList({
    name: "search_advertiser_settlements",
    description: "List advertiser settlement bills by month, status, campaign, or company.",
    args: "month, status, campaign_name, company_name, id",
    table: "advertiser_settlements",
    select: "id, settlement_month, status, coverage_type, discount_rate, final_amount_krw, campaigns!inner(name, advertisers!inner(company_name))",
    filters: advertiserSettlementFilters,
    order: "settlement_month",
    singular: "advertiser settlement",
    plural: "advertiser settlements",
    columns: [
      { key: "campaign", title: "Campaign" },
      { key: "company", title: "Company" },
      { key: "status", title: "Status" },
      { key: "discount", title: "Discount" },
      { key: "amount", title: "Final amount" },
    ],
    map: (row) => ({
      campaign: row.campaigns?.name ?? "—",
      company: row.campaigns?.advertisers?.company_name ?? "—",
      status: labelize(row.status),
      discount: `${row.discount_rate}%`,
      amount: krw(row.final_amount_krw),
    }),
  }),
  count_advertiser_settlements: defineCount({
    name: "count_advertiser_settlements",
    description: "Count advertiser settlement bills.",
    args: "month, status, campaign_name, company_name",
    table: "advertiser_settlements",
    select: "id, campaigns!inner(name, advertisers!inner(company_name))",
    filters: advertiserSettlementFilters,
    singular: "advertiser settlement",
    plural: "advertiser settlements",
  }),
  summarize_advertiser_settlements: {
    kind: "read",
    description: "Summarize advertiser settlement cards: targets, total, paid, and before payment.",
    args: "month, company_name",
    async run(args) {
      let query = db()
        .from("advertiser_settlements")
        .select("status, final_amount_krw, campaigns!inner(name, advertisers!inner(company_name))")
        .limit(1000);
      const month = monthStart(args.month);
      if (month) query = query.eq("settlement_month", month);
      if (text(args.company_name)) query = query.ilike("campaigns.advertisers.company_name", like(text(args.company_name)));
      const rows = unwrap<Row[]>(await query);
      const paid = rows.filter((row) => row.status === "payment_confirmed");
      const waiting = rows.filter((row) => row.status === "before_payment");
      const sum = (items: Row[]) => items.reduce((total, row) => total + Number(row.final_amount_krw || 0), 0);
      return {
        kind: "read",
        summary: `${rows.length} advertiser settlements. Payment confirmed ${krw(sum(paid))}. Before payment ${krw(sum(waiting))}.`,
        total: rows.length,
        columns: [
          { key: "targets", title: "Targets" },
          { key: "total", title: "Total" },
          { key: "paid", title: "Payment completed" },
          { key: "waiting", title: "Before payment" },
        ],
        rows: [{ targets: rows.length, total: krw(sum(rows)), paid: krw(sum(paid)), waiting: krw(sum(waiting)) }],
      };
    },
  },
  search_solo_pay: defineList({
    name: "search_solo_pay",
    description: "List Solo Pay wallets by company, link status, or advertiser status.",
    args: "company_name, linked, status",
    table: "solo_pay_accounts",
    select: "id, linked, balance_krw, total_accumulated_krw, month_topup_krw, month_deduction_krw, advertisers!inner(company_name, email, status)",
    filters: soloFilters,
    order: "balance_krw",
    singular: "Solo Pay account",
    plural: "Solo Pay accounts",
    columns: [
      { key: "company", title: "Company" },
      { key: "linked", title: "Linked" },
      { key: "balance", title: "Moad money" },
      { key: "status", title: "Advertiser status" },
    ],
    map: (row) => ({
      company: row.advertisers?.company_name ?? "—",
      linked: row.linked ? "Yes" : "No",
      balance: krw(row.balance_krw),
      status: labelize(row.advertisers?.status),
    }),
  }),
  count_solo_pay: defineCount({
    name: "count_solo_pay",
    description: "Count Solo Pay accounts, including linked and unlinked filters.",
    args: "company_name, linked, status",
    table: "solo_pay_accounts",
    select: "id, advertisers!inner(company_name, status)",
    filters: soloFilters,
    singular: "Solo Pay account",
    plural: "Solo Pay accounts",
  }),
  get_solo_pay_history: {
    kind: "read",
    description: "Read one advertiser Solo Pay balance and recent recharge or deduction history.",
    args: "company_name, category, id",
    async run(args) {
      let accountQuery = db()
        .from("solo_pay_accounts")
        .select("advertiser_id, linked, balance_krw, total_accumulated_krw, month_topup_krw, month_deduction_krw, advertisers!inner(id, company_name)")
        .limit(15);
      if (text(args.id)) accountQuery = accountQuery.eq("advertiser_id", text(args.id));
      if (text(args.company_name)) accountQuery = accountQuery.ilike("advertisers.company_name", like(text(args.company_name)));
      const accounts = unwrap<Row[]>(await accountQuery);
      if (accounts.length === 0) {
        return { kind: "read", summary: "No Solo Pay account matched.", total: 0, rows: [], columns: [] };
      }
      if (accounts.length > 1) {
        return {
          kind: "read",
          summary: `${accounts.length} Solo Pay accounts matched. Ask again with the company name you want.`,
          total: accounts.length,
          columns: [
            { key: "company", title: "Company" },
            { key: "balance", title: "Balance" },
          ],
          rows: accounts.map((row) => ({ company: row.advertisers.company_name, balance: krw(row.balance_krw) })),
        };
      }
      const account = accounts[0];
      let history = db()
        .from("solo_pay_transactions")
        .select("occurred_at, category, detail, amount_krw")
        .eq("advertiser_id", account.advertiser_id)
        .order("occurred_at", { ascending: false })
        .limit(15);
      if (text(args.category)) history = history.eq("category", canonical(args.category));
      const transactions = unwrap<Row[]>(await history);
      return {
        kind: "read",
        summary: `${account.advertisers.company_name} has ${krw(account.balance_krw)} Moad money. This month: top-up ${krw(account.month_topup_krw)}, deduction ${krw(account.month_deduction_krw)}. ${transactions.length} history rows are shown.`,
        total: transactions.length,
        columns: [
          { key: "when", title: "When" },
          { key: "category", title: "Category" },
          { key: "detail", title: "Detail" },
          { key: "amount", title: "Amount" },
        ],
        rows: transactions.map((row) => ({
          when: String(row.occurred_at).slice(0, 16).replace("T", " "),
          category: labelize(row.category),
          detail: row.detail,
          amount: krw(row.amount_krw),
        })),
      };
    },
  },
  search_faqs: defineList({
    name: "search_faqs",
    description: "List FAQ posts by category, question, exposure, or pin.",
    args: "category, question, exposed, pinned, id",
    table: "faqs",
    select: "id, category, question, exposed, pinned, sort_order, author_name, created_at",
    filters: faqFilters,
    order: "sort_order",
    singular: "FAQ",
    plural: "FAQs",
    columns: [
      { key: "question", title: "Question" },
      { key: "category", title: "Category" },
      { key: "exposed", title: "Exposure" },
      { key: "pinned", title: "Pinned" },
    ],
    map: (row) => ({
      question: row.question,
      category: labelize(row.category),
      exposed: row.exposed ? "Shown" : "Hidden",
      pinned: row.pinned ? "Yes" : "No",
    }),
  }),
  count_faqs: defineCount({
    name: "count_faqs",
    description: "Count FAQ posts.",
    args: "category, question, exposed, pinned",
    table: "faqs",
    select: "id",
    filters: faqFilters,
    singular: "FAQ",
    plural: "FAQs",
  }),
  search_notices: defineList({
    name: "search_notices",
    description: "List notices by audience, title, or pin.",
    args: "audience, title, pinned, id",
    table: "notices",
    select: "id, audience, post_type, title, pinned, author_name, created_at",
    filters: noticeFilters,
    order: "sort_order",
    singular: "notice",
    plural: "notices",
    columns: [
      { key: "title", title: "Title" },
      { key: "audience", title: "Audience" },
      { key: "pinned", title: "Pinned" },
      { key: "author", title: "Author" },
    ],
    map: (row) => ({
      title: row.title,
      audience: labelize(row.audience),
      pinned: row.pinned ? "Yes" : "No",
      author: row.author_name,
    }),
  }),
  count_notices: defineCount({
    name: "count_notices",
    description: "Count notices.",
    args: "audience, title, pinned",
    table: "notices",
    select: "id",
    filters: noticeFilters,
    singular: "notice",
    plural: "notices",
  }),
};
