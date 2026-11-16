import { writeAudit } from "@/lib/audit";
import { db, unwrap, type Row } from "@/lib/db";
import { booleanValue, canonical, day, integer, km, krw, labelize, like, monthStart, text } from "@/lib/labels";
import { FEE_RATES, lineAmount, recomputeSettlement, type FeeType } from "@/lib/settlement-math";
import type { ActionContext, ActionHandler, ActionOutcome, Args, PendingAction } from "@/lib/actions/types";

export class ActionRefusal extends Error {}

const ADVERTISER_STATUSES = ["pending_approval", "approved", "rejected", "blacklist"];
const CARGO_STATUSES = ["under_review", "approved", "rejected", "blacklist"];
const CAMPAIGN_STATUSES = ["under_review", "preparing", "recruiting", "in_progress", "paused", "ended", "rejected"];
const APPLICATION_STATUSES = ["under_review", "preparing", "operational", "in_progress", "ended"];
const FEE_TYPES = ["visit", "detachment", "event", "introduce", "fuel", "interview"] as const;

async function loadOne(table: string, id: string) {
  const result = await db().from(table).select("*").eq("id", id).maybeSingle();
  return unwrap<Row | null>(result);
}

async function exactOrLoose(table: string, column: string, value: string, select = "*") {
  const exact = unwrap<Row[]>(await db().from(table).select(select).ilike(column, value).limit(20));
  if (exact.length) return exact;
  return unwrap<Row[]>(await db().from(table).select(select).ilike(column, like(value)).limit(20));
}

function present(rows: Row[], format: (row: Row) => { label: string; detail: string }) {
  return rows.slice(0, 20).map((row) => ({ id: String(row.id), ...format(row) }));
}

async function refuse(ctx: ActionContext, action: string, summary: string, targetType?: string, targetId?: string | null): Promise<ActionOutcome> {
  await writeAudit({
    adminId: ctx.adminId,
    event: "refuse",
    actionName: action,
    summary,
    targetType,
    targetId,
  });
  return { kind: "refused", summary };
}

function ambiguous(action: string, args: Args, rows: Row[], noun: string, format: (row: Row) => { label: string; detail: string }): ActionOutcome {
  const shown = Math.min(rows.length, 20);
  return {
    kind: "matches",
    summary: `${rows.length} ${noun} match. Showing ${shown}. Choose one record. I will not open a confirmation until the choice is unique.`,
    matches: present(rows, format),
    total: rows.length,
    resume: { action, args },
    rows: present(rows, format).map((match) => ({ record: match.label, detail: match.detail })),
    columns: [
      { key: "record", title: "Record" },
      { key: "detail", title: "Detail" },
    ],
  };
}

function ask(summary: string): ActionOutcome {
  return { kind: "clarification", summary };
}

async function queue(
  ctx: ActionContext,
  input: {
    action: string;
    args: Args;
    targetType: string;
    targetId: string | null;
    title: string;
    summary: string;
    lines: { label: string; value: string }[];
    before: Record<string, unknown> | null;
  },
): Promise<ActionOutcome> {
  const inserted = unwrap<{ id: string }>(
    await db()
      .from("pending_actions")
      .insert({
        admin_id: ctx.adminId,
        action_name: input.action,
        args: input.args,
        target_type: input.targetType,
        target_id: input.targetId,
        summary: input.summary,
        before_data: input.before,
        status: "pending",
      })
      .select("id")
      .single(),
  );
  return {
    kind: "confirmation",
    summary: input.summary,
    confirmation: {
      pendingActionId: inserted.id,
      title: input.title,
      lines: input.lines,
      state: "pending",
    },
  };
}

function detailLines(pairs: Array<[string, unknown]>) {
  return pairs
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}

function guardStatus(value: unknown, allowed: string[]) {
  const status = canonical(value);
  if (!status) return { missing: true as const, status: "" };
  if (!allowed.includes(status)) return { missing: false as const, status: "", allowed };
  return { missing: false as const, status, allowed };
}

function drifted(before: Record<string, unknown> | null, current: Row, keys: string[]) {
  if (!before) return false;
  return keys.some((key) => before[key] !== current[key]);
}

async function findAdvertisers(args: Args, allowName: boolean) {
  const id = text(args.id) || text(args.advertiser_id);
  if (id) return unwrap<Row[]>(await db().from("advertisers").select("*").eq("id", id).limit(5));
  const email = text(args.email);
  if (email) return exactOrLoose("advertisers", "email", email);
  const company = text(args.company_name) || text(args.company) || (allowName ? text(args.name) : "");
  if (!company) return null;
  return exactOrLoose("advertisers", "company_name", company);
}

async function findCargo(args: Args) {
  const id = text(args.id) || text(args.cargo_partner_id);
  if (id) return unwrap<Row[]>(await db().from("cargo_partners").select("*").eq("id", id).limit(5));
  const member = text(args.member_number);
  if (member) return exactOrLoose("cargo_partners", "member_number", member);
  const name = text(args.name) || text(args.partner_name);
  if (!name) return null;
  return exactOrLoose("cargo_partners", "name", name);
}

const CAMPAIGN_SELECT = "*, advertisers!inner(company_name)";

async function findCampaigns(args: Args) {
  const id = text(args.id) || text(args.campaign_id);
  if (id) return unwrap<Row[]>(await db().from("campaigns").select(CAMPAIGN_SELECT).eq("id", id).limit(5));
  const name = text(args.name) || text(args.campaign_name);
  const company = text(args.company_name) || text(args.company);
  if (!name && !company) return null;
  const run = (campaignName: string, loose: boolean) => {
    let query = db().from("campaigns").select(CAMPAIGN_SELECT).limit(20);
    if (campaignName) query = query.ilike("name", loose ? like(campaignName) : campaignName);
    if (company) query = query.ilike("advertisers.company_name", like(company));
    return query;
  };
  if (name) {
    const exact = unwrap<Row[]>(await run(name, false));
    if (exact.length || !company) {
      if (exact.length) return exact;
      return unwrap<Row[]>(await run(name, true));
    }
  }
  return unwrap<Row[]>(await run(name, true));
}

const APPLICATION_SELECT = "id, status, region_label, applied_at, campaigns!inner(id, name), cargo_partners!inner(id, name, member_number)";

async function findApplications(args: Args) {
  const id = text(args.id);
  if (id) return unwrap<Row[]>(await db().from("campaign_applications").select(APPLICATION_SELECT).eq("id", id).limit(5));
  const campaign = text(args.campaign_name);
  const partner = text(args.partner_name) || text(args.cargo_name);
  const member = text(args.member_number);
  const loose = text(args.name);
  if (!campaign && !partner && !member && !loose) return null;
  const run = async (campaignName: string, partnerName: string) => {
    let query = db().from("campaign_applications").select(APPLICATION_SELECT).limit(20);
    if (campaignName) query = query.ilike("campaigns.name", like(campaignName));
    if (partnerName) query = query.ilike("cargo_partners.name", like(partnerName));
    if (member) query = query.ilike("cargo_partners.member_number", like(member));
    return unwrap<Row[]>(await query);
  };
  if (campaign || partner || member) return run(campaign, partner);
  const [byPartner, byCampaign] = await Promise.all([run("", loose), run(loose, "")]);
  const merged = new Map<string, Row>();
  for (const row of [...byPartner, ...byCampaign]) merged.set(row.id, row);
  return [...merged.values()];
}

const CARGO_SETTLEMENT_SELECT = "*, cargo_partners!inner(name, member_number)";

async function findCargoSettlements(args: Args) {
  const id = text(args.id);
  if (id) return unwrap<Row[]>(await db().from("cargo_settlements").select(CARGO_SETTLEMENT_SELECT).eq("id", id).limit(5));
  const partner = text(args.partner_name) || text(args.name);
  const member = text(args.member_number);
  const month = monthStart(args.month);
  if (!partner && !member && !month) return null;
  let query = db().from("cargo_settlements").select(CARGO_SETTLEMENT_SELECT).limit(20);
  if (partner) query = query.ilike("cargo_partners.name", like(partner));
  if (member) query = query.ilike("cargo_partners.member_number", like(member));
  if (month) query = query.eq("settlement_month", month);
  return unwrap<Row[]>(await query);
}

const ADVERTISER_SETTLEMENT_SELECT = "*, campaigns!inner(name, advertisers!inner(company_name))";

async function findAdvertiserSettlements(args: Args) {
  const id = text(args.id);
  if (id) return unwrap<Row[]>(await db().from("advertiser_settlements").select(ADVERTISER_SETTLEMENT_SELECT).eq("id", id).limit(5));
  const campaign = text(args.campaign_name) || text(args.name);
  const company = text(args.company_name) || text(args.company);
  const month = monthStart(args.month);
  if (!campaign && !company && !month) return null;
  let query = db().from("advertiser_settlements").select(ADVERTISER_SETTLEMENT_SELECT).limit(20);
  if (campaign) query = query.ilike("campaigns.name", like(campaign));
  if (company) query = query.ilike("campaigns.advertisers.company_name", like(company));
  if (month) query = query.eq("settlement_month", month);
  return unwrap<Row[]>(await query);
}

async function findPosts(table: string, args: Args, column: "question" | "title") {
  const id = text(args.id);
  if (id) return unwrap<Row[]>(await db().from(table).select("*").eq("id", id).limit(5));
  const value = text(args[column]) || text(args.name);
  if (!value) return null;
  return exactOrLoose(table, column, value);
}

function cargoCard(row: Row) {
  return { label: String(row.name), detail: `${row.member_number} · ${labelize(row.status)} · ${row.vehicle_type ?? "No vehicle"}` };
}

function advertiserCard(row: Row) {
  return { label: String(row.company_name), detail: `${row.email} · ${labelize(row.status)}` };
}

function campaignCard(row: Row) {
  return { label: String(row.name), detail: `${row.advertisers?.company_name ?? "—"} · ${labelize(row.status)} · ${row.starts_on} – ${row.ends_on}` };
}

function applicationCard(row: Row) {
  return { label: `${row.cargo_partners?.name ?? "Partner"} · ${row.campaigns?.name ?? "Campaign"}`, detail: `${row.cargo_partners?.member_number ?? "—"} · ${labelize(row.status)}` };
}

async function oneOf(
  ctx: ActionContext,
  action: string,
  args: Args,
  found: Row[] | null,
  noun: string,
  format: (row: Row) => { label: string; detail: string },
  onOne: (row: Row) => Promise<ActionOutcome>,
): Promise<ActionOutcome> {
  if (found == null) return ask(`Which ${noun} should I use? Give the name, member number, or record id.`);
  if (found.length === 0) return refuse(ctx, action, `No ${noun} matched. Nothing was changed.`);
  if (found.length > 1) return ambiguous(action, args, found, noun, format);
  return onOne(found[0]);
}

async function requireCurrent(table: string, id: string | null, before: Record<string, unknown> | null, keys: string[]) {
  if (!id) throw new ActionRefusal("The record is no longer there. Nothing was changed.");
  const current = await loadOne(table, id);
  if (!current) throw new ActionRefusal("The record is no longer there. Nothing was changed.");
  if (drifted(before, current, keys)) {
    throw new ActionRefusal("The record changed after this confirmation was created. Nothing was changed.");
  }
  return current;
}

type SettlementAmount = "base" | "extras" | "tax" | "net";

function percentInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) return value;
  const raw = text(value).replace(/%/g, "").replace(/percent/gi, "").trim();
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

function moneyInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  const parsed = integer(text(value).replace(/,/g, "").replace(/krw/gi, ""));
  if (parsed == null || parsed < 0) return null;
  return parsed;
}

function previewSettlement(row: Row, field: SettlementAmount, amount: number) {
  const base = field === "base" ? amount : Number(row.base_amount_krw || 0);
  const extras = field === "extras" ? amount : Number(row.additional_amount_krw || 0);
  if (field === "base" || field === "extras") {
    const money = recomputeSettlement(base, extras);
    return { base, extras, tax: money.taxAmountKrw, net: money.finalAmountKrw };
  }
  const tax = field === "tax" ? amount : Number(row.tax_amount_krw || 0);
  const net = field === "net" ? amount : Math.floor((base + extras - tax) / 10) * 10;
  return { base, extras, tax, net };
}

function countInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  const parsed = integer(text(value).replace(/,/g, ""));
  if (parsed == null || parsed < 0) return null;
  return parsed;
}

function distanceInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  const raw = text(value).replace(/,/g, "").replace(/km/gi, "").trim();
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function settlementMeasureAction(column: "operation_count" | "distance_km"): ActionHandler {
  const distance = column === "distance_km";
  const action = distance ? "update_cargo_settlement_distance" : "update_cargo_settlement_operation_count";
  const label = distance ? "distance" : "operation count";
  return {
    kind: "write",
    description: distance
      ? "Set the recorded kilometres on one driving-partner settlement that is still before settlement."
      : "Set the operation count on one driving-partner settlement that is still before settlement.",
    args: "partner_name or member_number or id, month, " + (distance ? "distance_km" : "operation_count"),
    async run(args, ctx) {
      const next = distance
        ? distanceInput(args.distance_km ?? args.distance ?? args.amount)
        : countInput(args.operation_count ?? args.count ?? args.amount);
      if (next == null) return ask(distance ? "How many kilometres should I set?" : "What operation count should I set?");
      const found = await findCargoSettlements(args);
      return oneOf(ctx, action, { ...args, [column]: next }, found, "cargo settlement", (row) => ({
        label: row.cargo_partners?.name ?? "Settlement",
        detail: `${String(row.settlement_month).slice(0, 7)} · ${labelize(row.status)} · ${distance ? km(Number(row.distance_km || 0)) : row.operation_count}`,
      }), async (row) => {
        if (row.status !== "before_settlement") {
          return refuse(ctx, action, `${row.cargo_partners?.name}'s ${String(row.settlement_month).slice(0, 7)} settlement is already ${labelize(row.status)}. Nothing was changed.`, "cargo_settlement", row.id);
        }
        const current = distance ? Number(row.distance_km || 0) : Number(row.operation_count || 0);
        if (current === next) return ask(`${row.cargo_partners?.name}'s ${label} is already ${distance ? km(next) : next}. Nothing needs to change.`);
        return queue(ctx, {
          action,
          args: { ...args, [column]: next },
          targetType: "cargo_settlement",
          targetId: row.id,
          title: distance ? "Change settlement distance" : "Change operation count",
          summary: `Set the ${label} for ${row.cargo_partners?.name} (${String(row.settlement_month).slice(0, 7)}) to ${distance ? km(next) : next} after you confirm.`,
          before: { status: row.status, [column]: row[column] },
          lines: detailLines([
            ["Partner", row.cargo_partners?.name],
            ["Month", String(row.settlement_month).slice(0, 7)],
            [distance ? "Current distance" : "Current operation count", distance ? km(current) : String(current)],
            [distance ? "New distance" : "New operation count", distance ? km(next) : String(next)],
          ]),
        });
      });
    },
  };
}

function settlementAmountAction(field: SettlementAmount): ActionHandler {
  const label = field === "base" ? "Base" : field === "extras" ? "Extras" : field === "tax" ? "Tax" : "Final settlement amount";
  const action = `update_cargo_settlement_${field}`;
  return {
    kind: "write",
    description: field === "net"
      ? "Set the final settlement amount, in KRW, on one driving-partner settlement that is still before settlement. This is the net shown in the settlement table."
      : `Set the ${label.toLowerCase()} amount, in KRW, on one driving-partner settlement that is still before settlement. Changing base or extras recalculates tax and the final amount. Changing tax recalculates the final amount.`,
    args: "partner_name or member_number or id, month, amount",
    async run(args, ctx) {
      const amount = moneyInput(args.amount ?? args[field] ?? args[`${field}_amount`]);
      if (amount == null) return ask(`What ${label.toLowerCase()} amount, in KRW, should I set?`);
      const found = await findCargoSettlements(args);
      return oneOf(ctx, action, { ...args, amount }, found, "cargo settlement", (row) => ({
        label: row.cargo_partners?.name ?? "Settlement",
        detail: `${String(row.settlement_month).slice(0, 7)} · ${labelize(row.status)} · net ${krw(row.final_amount_krw)}`,
      }), async (row) => {
        if (row.status !== "before_settlement") {
          return refuse(ctx, action, `${row.cargo_partners?.name}'s ${String(row.settlement_month).slice(0, 7)} settlement is already ${labelize(row.status)}. Nothing was changed.`, "cargo_settlement", row.id);
        }
        const next = previewSettlement(row, field, amount);
        const unchanged = Number(row.base_amount_krw) === next.base
          && Number(row.additional_amount_krw) === next.extras
          && Number(row.tax_amount_krw) === next.tax
          && Number(row.final_amount_krw) === next.net;
        if (unchanged) return ask(`${row.cargo_partners?.name}'s ${label.toLowerCase()} is already ${krw(amount)}. Nothing needs to change.`);
        return queue(ctx, {
          action,
          args: { ...args, amount },
          targetType: "cargo_settlement",
          targetId: row.id,
          title: `Change settlement ${label.toLowerCase()}`,
          summary: `Set the ${label.toLowerCase()} for ${row.cargo_partners?.name} (${String(row.settlement_month).slice(0, 7)}) to ${krw(amount)} after you confirm.`,
          before: {
            status: row.status,
            base_amount_krw: row.base_amount_krw,
            additional_amount_krw: row.additional_amount_krw,
            tax_amount_krw: row.tax_amount_krw,
            final_amount_krw: row.final_amount_krw,
          },
          lines: detailLines([
            ["Partner", row.cargo_partners?.name],
            ["Month", String(row.settlement_month).slice(0, 7)],
            [`Current ${label.toLowerCase()}`, krw(row[field === "base" ? "base_amount_krw" : field === "extras" ? "additional_amount_krw" : field === "tax" ? "tax_amount_krw" : "final_amount_krw"])],
            [`New ${label.toLowerCase()}`, krw(amount)],
            ["Tax", krw(next.tax)],
            ["Net", krw(next.net)],
          ]),
        });
      });
    },
  };
}

export const writeActions: Record<string, ActionHandler> = {
  change_advertiser_status: {
    kind: "write",
    description: "Change an advertiser status to pending approval, approved, rejected, or blacklist.",
    args: "company_name or name or email or id, status",
    async run(args, ctx) {
      const check = guardStatus(args.status, ADVERTISER_STATUSES);
      if (check.missing) return ask("What status should the advertiser have? Pending approval, approved, rejected, or blacklist.");
      if (!check.status) return ask(`Use one of these advertiser statuses: ${ADVERTISER_STATUSES.map(labelize).join(", ")}.`);
      const found = await findAdvertisers(args, true);
      return oneOf(ctx, "change_advertiser_status", args, found, "advertiser", advertiserCard, async (row) => {
        if (row.status === check.status) return ask(`${row.company_name} is already ${labelize(check.status)}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_advertiser_status",
          args,
          targetType: "advertiser",
          targetId: row.id,
          title: "Change advertiser status",
          summary: `Change ${row.company_name} from ${labelize(row.status)} to ${labelize(check.status)} after you confirm.`,
          before: { status: row.status },
          lines: detailLines([
            ["Company", row.company_name],
            ["Current status", labelize(row.status)],
            ["New status", labelize(check.status)],
          ]),
        });
      });
    },
  },
  set_advertiser_blacklist_reason: {
    kind: "write",
    description: "Set or change the blacklist reason for an advertiser who is already blacklisted.",
    args: "company_name or email or id, blacklist_reason",
    async run(args, ctx) {
      const next = text(args.blacklist_reason) || text(args.reason);
      if (!next) return ask("What should the blacklist reason be?");
      const found = await findAdvertisers({ ...args, company_name: text(args.company_name) || text(args.company) || text(args.name) }, true);
      return oneOf(ctx, "set_advertiser_blacklist_reason", args, found, "advertiser", advertiserCard, async (row) => {
        if (row.status !== "blacklist") return refuse(ctx, "set_advertiser_blacklist_reason", `${row.company_name} is not on the blacklist. Nothing was changed.`, "advertiser", row.id);
        if (row.blacklist_reason === next) return ask(`${row.company_name} already has that blacklist reason. Nothing needs to change.`);
        return queue(ctx, {
          action: "set_advertiser_blacklist_reason",
          args: { ...args, blacklist_reason: next },
          targetType: "advertiser",
          targetId: row.id,
          title: "Change blacklist reason",
          summary: `Set the blacklist reason for ${row.company_name} to “${next}” after you confirm.`,
          before: { blacklist_reason: row.blacklist_reason },
          lines: detailLines([
            ["Company", row.company_name],
            ["Current reason", row.blacklist_reason || "—"],
            ["New reason", next],
          ]),
        });
      });
    },
  },
  change_advertiser_contact_name: {
    kind: "write",
    description: "Change the contact name on one advertiser company.",
    args: "company_name or email or id, contact_name",
    async run(args, ctx) {
      const next = text(args.contact_name) || text(args.new_name);
      if (!next) return ask("What should the new contact name be?");
      const found = await findAdvertisers({ ...args, company_name: text(args.company_name) || text(args.company) || text(args.name) }, false);
      return oneOf(ctx, "change_advertiser_contact_name", args, found, "advertiser", advertiserCard, async (row) => {
        if (row.contact_name === next) return ask(`${row.company_name} already has contact name ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_advertiser_contact_name",
          args: { ...args, contact_name: next },
          targetType: "advertiser",
          targetId: row.id,
          title: "Change advertiser contact name",
          summary: `Change the contact name for ${row.company_name} from “${row.contact_name || "—"}” to “${next}” after you confirm.`,
          before: { contact_name: row.contact_name },
          lines: detailLines([
            ["Company", row.company_name],
            ["Current contact name", row.contact_name || "—"],
            ["New contact name", next],
          ]),
        });
      });
    },
  },
  change_advertiser_contact_phone: {
    kind: "write",
    description: "Change the contact phone number on one advertiser company.",
    args: "company_name or email or id, contact_phone",
    async run(args, ctx) {
      const next = text(args.contact_phone) || text(args.phone) || text(args.new_phone);
      if (!next) return ask("What should the new contact phone number be?");
      const found = await findAdvertisers({ ...args, company_name: text(args.company_name) || text(args.company) || text(args.name) }, false);
      return oneOf(ctx, "change_advertiser_contact_phone", args, found, "advertiser", advertiserCard, async (row) => {
        if (row.contact_phone === next) return ask(`${row.company_name} already has contact phone ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_advertiser_contact_phone",
          args: { ...args, contact_phone: next },
          targetType: "advertiser",
          targetId: row.id,
          title: "Change advertiser contact phone",
          summary: `Change the contact phone for ${row.company_name} from ${row.contact_phone || "—"} to ${next} after you confirm.`,
          before: { contact_phone: row.contact_phone },
          lines: detailLines([
            ["Company", row.company_name],
            ["Current contact phone", row.contact_phone || "—"],
            ["New contact phone", next],
          ]),
        });
      });
    },
  },
  change_advertiser_company_name: {
    kind: "write",
    description: "Change the company name of one advertiser. company_name is the current name used to find the company. new_company_name is the replacement.",
    args: "current company_name or email or id, new_company_name",
    async run(args, ctx) {
      const next = text(args.new_company_name) || text(args.new_name);
      if (!next) return ask("What should the new company name be?");
      const found = await findAdvertisers({ ...args, company_name: text(args.current_company_name) || text(args.company_name) || text(args.company) }, true);
      return oneOf(ctx, "change_advertiser_company_name", args, found, "advertiser", advertiserCard, async (row) => {
        if (row.company_name === next) return ask(`${row.company_name} already uses that company name. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_advertiser_company_name",
          args: { ...args, new_company_name: next },
          targetType: "advertiser",
          targetId: row.id,
          title: "Change advertiser company name",
          summary: `Change the company name from “${row.company_name}” to “${next}” after you confirm.`,
          before: { company_name: row.company_name },
          lines: detailLines([
            ["Current company name", row.company_name],
            ["New company name", next],
            ["Email", row.email],
          ]),
        });
      });
    },
  },
  change_advertiser_email: {
    kind: "write",
    description: "Change the email of one advertiser. Find the company by company_name or id. Put the replacement address in new_email, not in email.",
    args: "company_name or id, new_email",
    async run(args, ctx) {
      const next = text(args.new_email);
      if (!next) return ask("What should the new email be?");
      if (!emailLooksValid(next)) return ask("Give the new email as a full address, such as team@company.example.");
      const company = text(args.company_name) || text(args.company) || text(args.name);
      const found = await findAdvertisers({
        id: args.id,
        advertiser_id: args.advertiser_id,
        company_name: company,
        email: text(args.current_email) || (company ? "" : text(args.email)),
      }, false);
      return oneOf(ctx, "change_advertiser_email", args, found, "advertiser", advertiserCard, async (row) => {
        if (String(row.email).toLowerCase() === next.toLowerCase()) return ask(`${row.company_name} already uses ${next}. Nothing needs to change.`);
        const taken = await advertiserEmailOwner(next, row.id);
        if (taken) return refuse(ctx, "change_advertiser_email", `${next} is already used by ${taken.company_name}. Nothing was changed.`, "advertiser", row.id);
        return queue(ctx, {
          action: "change_advertiser_email",
          args: { ...args, new_email: next },
          targetType: "advertiser",
          targetId: row.id,
          title: "Change advertiser email",
          summary: `Change the email for ${row.company_name} from ${row.email} to ${next} after you confirm.`,
          before: { email: row.email },
          lines: detailLines([
            ["Company", row.company_name],
            ["Current email", row.email],
            ["New email", next],
          ]),
        });
      });
    },
  },
  change_advertiser_company_phone: {
    kind: "write",
    description: "Change the company phone number of one advertiser. This is the company phone, not the contact phone.",
    args: "company_name or email or id, company_phone",
    async run(args, ctx) {
      const next = text(args.new_company_phone) || text(args.company_phone);
      if (!next) return ask("What should the new company phone number be?");
      const found = await findAdvertisers({ ...args, company_name: text(args.company_name) || text(args.company) || text(args.name) }, false);
      return oneOf(ctx, "change_advertiser_company_phone", args, found, "advertiser", advertiserCard, async (row) => {
        if (row.company_phone === next) return ask(`${row.company_name} already has company phone ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_advertiser_company_phone",
          args: { ...args, company_phone: next },
          targetType: "advertiser",
          targetId: row.id,
          title: "Change advertiser company phone",
          summary: `Change the company phone for ${row.company_name} from ${row.company_phone || "—"} to ${next} after you confirm.`,
          before: { company_phone: row.company_phone },
          lines: detailLines([
            ["Company", row.company_name],
            ["Current company phone", row.company_phone || "—"],
            ["New company phone", next],
          ]),
        });
      });
    },
  },
  change_cargo_partner_status: {
    kind: "write",
    description: "Change a cargo partner status to under review, approved, rejected, or blacklist.",
    args: "name or member_number or id, status",
    async run(args, ctx) {
      const check = guardStatus(args.status, CARGO_STATUSES);
      if (check.missing) return ask("What status should the cargo partner have? Under review, approved, rejected, or blacklist.");
      if (!check.status) return ask(`Use one of these cargo partner statuses: ${CARGO_STATUSES.map(labelize).join(", ")}.`);
      const found = await findCargo(args);
      return oneOf(ctx, "change_cargo_partner_status", args, found, "cargo partner", cargoCard, async (row) => {
        if (row.status === check.status) return ask(`${row.name} (${row.member_number}) is already ${labelize(check.status)}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_cargo_partner_status",
          args,
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change cargo partner status",
          summary: `Change ${row.name} (${row.member_number}) from ${labelize(row.status)} to ${labelize(check.status)} after you confirm.`,
          before: { status: row.status },
          lines: detailLines([
            ["Partner", row.name],
            ["Member", row.member_number],
            ["Current status", labelize(row.status)],
            ["New status", labelize(check.status)],
          ]),
        });
      });
    },
  },
  set_cargo_partner_blacklist_reason: {
    kind: "write",
    description: "Set or change the blacklist reason for a cargo partner who is already blacklisted.",
    args: "name or member_number or id, blacklist_reason",
    async run(args, ctx) {
      const next = text(args.blacklist_reason) || text(args.reason);
      if (!next) return ask("What should the blacklist reason be?");
      const found = await findCargo(args);
      return oneOf(ctx, "set_cargo_partner_blacklist_reason", args, found, "cargo partner", cargoCard, async (row) => {
        if (row.status !== "blacklist") return refuse(ctx, "set_cargo_partner_blacklist_reason", `${row.name} is not on the blacklist. Nothing was changed.`, "cargo_partner", row.id);
        if (row.blacklist_reason === next) return ask(`${row.name} already has that blacklist reason. Nothing needs to change.`);
        return queue(ctx, {
          action: "set_cargo_partner_blacklist_reason",
          args: { ...args, blacklist_reason: next },
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change blacklist reason",
          summary: `Set the blacklist reason for ${row.name} (${row.member_number}) to “${next}” after you confirm.`,
          before: { blacklist_reason: row.blacklist_reason },
          lines: detailLines([
            ["Partner", row.name],
            ["Member", row.member_number],
            ["Current reason", row.blacklist_reason || "—"],
            ["New reason", next],
          ]),
        });
      });
    },
  },
  change_cargo_partner_name: {
    kind: "write",
    description: "Change a cargo partner's name after a unique partner is identified.",
    args: "name or member_number or id, new_name",
    async run(args, ctx) {
      const newName = text(args.new_name);
      if (!newName) return ask("What should the new cargo partner name be?");
      const found = await findCargo(args);
      return oneOf(ctx, "change_cargo_partner_name", args, found, "cargo partner", cargoCard, (row) =>
        queue(ctx, {
          action: "change_cargo_partner_name",
          args,
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change cargo partner name",
          summary: `Change ${row.member_number} from “${row.name}” to “${newName}” after you confirm.`,
          before: { name: row.name },
          lines: detailLines([
            ["Member", row.member_number],
            ["Current name", row.name],
            ["New name", newName],
          ]),
        }),
      );
    },
  },
  change_cargo_partner_member_number: {
    kind: "write",
    description: "Change a cargo partner member number. member_number is the current number used to find the partner. new_member_number is the replacement.",
    args: "current member_number or name or id, new_member_number",
    async run(args, ctx) {
      const next = text(args.new_member_number);
      if (!next) return ask("What should the new member number be?");
      const name = text(args.name) || text(args.partner_name);
      const currentMember = text(args.current_member_number) || (text(args.member_number) !== next ? text(args.member_number) : "");
      const found = await findCargo({
        id: args.id,
        cargo_partner_id: args.cargo_partner_id,
        name,
        member_number: currentMember,
      });
      return oneOf(ctx, "change_cargo_partner_member_number", args, found, "cargo partner", cargoCard, async (row) => {
        if (row.member_number === next) return ask(`${row.name} already uses member number ${next}. Nothing needs to change.`);
        const taken = await cargoMemberOwner(next, row.id);
        if (taken) return refuse(ctx, "change_cargo_partner_member_number", `${next} is already used by ${taken.name}. Nothing was changed.`, "cargo_partner", row.id);
        return queue(ctx, {
          action: "change_cargo_partner_member_number",
          args: { ...args, new_member_number: next },
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change cargo partner member number",
          summary: `Change the member number for ${row.name} from ${row.member_number} to ${next} after you confirm.`,
          before: { member_number: row.member_number },
          lines: detailLines([
            ["Partner", row.name],
            ["Current member number", row.member_number],
            ["New member number", next],
          ]),
        });
      });
    },
  },
  change_cargo_partner_phone: {
    kind: "write",
    description: "Change the mobile phone number of one cargo partner.",
    args: "name or member_number or id, phone",
    async run(args, ctx) {
      const next = text(args.new_phone) || text(args.phone);
      if (!next) return ask("What should the new mobile phone number be?");
      const found = await findCargo(args);
      return oneOf(ctx, "change_cargo_partner_phone", args, found, "cargo partner", cargoCard, async (row) => {
        if (row.phone === next) return ask(`${row.name} already has phone ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_cargo_partner_phone",
          args: { ...args, phone: next },
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change cargo partner phone",
          summary: `Change the phone for ${row.name} (${row.member_number}) from ${row.phone || "—"} to ${next} after you confirm.`,
          before: { phone: row.phone },
          lines: detailLines([
            ["Partner", row.name],
            ["Member", row.member_number],
            ["Current phone", row.phone || "—"],
            ["New phone", next],
          ]),
        });
      });
    },
  },
  change_cargo_partner_vehicle_number: {
    kind: "write",
    description: "Change the vehicle number of one cargo partner.",
    args: "name or member_number or id, vehicle_number",
    async run(args, ctx) {
      const next = text(args.new_vehicle_number) || text(args.vehicle_number);
      if (!next) return ask("What should the new vehicle number be?");
      const found = await findCargo(args);
      return oneOf(ctx, "change_cargo_partner_vehicle_number", args, found, "cargo partner", cargoCard, async (row) => {
        if (row.vehicle_number === next) return ask(`${row.name} already has vehicle number ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_cargo_partner_vehicle_number",
          args: { ...args, vehicle_number: next },
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change cargo partner vehicle number",
          summary: `Change the vehicle number for ${row.name} (${row.member_number}) from ${row.vehicle_number || "—"} to ${next} after you confirm.`,
          before: { vehicle_number: row.vehicle_number },
          lines: detailLines([
            ["Partner", row.name],
            ["Member", row.member_number],
            ["Current vehicle number", row.vehicle_number || "—"],
            ["New vehicle number", next],
          ]),
        });
      });
    },
  },
  change_cargo_partner_vehicle_type: {
    kind: "write",
    description: "Change the vehicle type of one cargo partner, such as Top / Large or Cargo / Small.",
    args: "name or member_number or id, vehicle_type",
    async run(args, ctx) {
      const next = text(args.new_vehicle_type) || text(args.vehicle_type);
      if (!next) return ask("What should the new vehicle type be?");
      const found = await findCargo(args);
      return oneOf(ctx, "change_cargo_partner_vehicle_type", args, found, "cargo partner", cargoCard, async (row) => {
        if (row.vehicle_type === next) return ask(`${row.name} already has vehicle type ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_cargo_partner_vehicle_type",
          args: { ...args, vehicle_type: next },
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change cargo partner vehicle type",
          summary: `Change the vehicle type for ${row.name} (${row.member_number}) from ${row.vehicle_type || "—"} to ${next} after you confirm.`,
          before: { vehicle_type: row.vehicle_type },
          lines: detailLines([
            ["Partner", row.name],
            ["Member", row.member_number],
            ["Current vehicle type", row.vehicle_type || "—"],
            ["New vehicle type", next],
          ]),
        });
      });
    },
  },
  change_cargo_partner_fixed_location: {
    kind: "write",
    description: "Set whether a cargo partner has a fixed operating location. Use yes or no.",
    args: "name or member_number or id, fixed_operating_location",
    async run(args, ctx) {
      const flag = booleanValue(args.fixed_operating_location ?? args.fixed_location ?? args.value);
      if (flag == null) return ask("Should the fixed operating location be yes or no?");
      const found = await findCargo(args);
      return oneOf(ctx, "change_cargo_partner_fixed_location", args, found, "cargo partner", cargoCard, async (row) => {
        if (row.fixed_operating_location === flag) return ask(`${row.name} already has fixed operating location set to ${flag ? "yes" : "no"}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_cargo_partner_fixed_location",
          args: { ...args, fixed_operating_location: flag },
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change fixed operating location",
          summary: `Set fixed operating location for ${row.name} (${row.member_number}) to ${flag ? "yes" : "no"} after you confirm.`,
          before: { fixed_operating_location: row.fixed_operating_location },
          lines: detailLines([
            ["Partner", row.name],
            ["Member", row.member_number],
            ["Current", row.fixed_operating_location ? "Yes" : "No"],
            ["New", flag ? "Yes" : "No"],
          ]),
        });
      });
    },
  },
  change_cargo_partner_region: {
    kind: "write",
    description: "Change the region label of one cargo partner, such as Seoul > Songpa-gu.",
    args: "name or member_number or id, region",
    async run(args, ctx) {
      const next = text(args.new_region) || text(args.region) || text(args.region_label);
      if (!next) return ask("What should the new region be?");
      const found = await findCargo(args);
      return oneOf(ctx, "change_cargo_partner_region", args, found, "cargo partner", cargoCard, async (row) => {
        if (row.region_label === next) return ask(`${row.name} is already in ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_cargo_partner_region",
          args: { ...args, region: next },
          targetType: "cargo_partner",
          targetId: row.id,
          title: "Change cargo partner region",
          summary: `Change the region for ${row.name} (${row.member_number}) from ${row.region_label || "—"} to ${next} after you confirm.`,
          before: { region_label: row.region_label },
          lines: detailLines([
            ["Partner", row.name],
            ["Member", row.member_number],
            ["Current region", row.region_label || "—"],
            ["New region", next],
          ]),
        });
      });
    },
  },
  create_campaign: {
    kind: "write",
    description: "Create a campaign for one uniquely identified advertiser.",
    args: "company_name or advertiser id, name, starts_on, ends_on, coverage_type, recruitment_status, contact_name, contact_phone",
    async run(args, ctx) {
      const name = text(args.name) || text(args.campaign_name);
      const starts = day(args.starts_on);
      const ends = day(args.ends_on);
      if (!name || !starts || !ends) return ask("To create a campaign I need the advertiser, the ad name, and the start and end dates in YYYY-MM-DD.");
      const coverage = canonical(args.coverage_type || "national");
      const recruitment = canonical(args.recruitment_status || "active");
      if (!["national", "regional"].includes(coverage)) return ask("Coverage type must be national or regional.");
      if (!["active", "inactive"].includes(recruitment)) return ask("Recruitment status must be active or inactive.");
      const found = await findAdvertisers(args, false);
      return oneOf(ctx, "create_campaign", { ...args, name, starts_on: starts, ends_on: ends, coverage_type: coverage, recruitment_status: recruitment }, found, "advertiser", advertiserCard, (row) =>
        queue(ctx, {
          action: "create_campaign",
          args: { ...args, name, starts_on: starts, ends_on: ends, coverage_type: coverage, recruitment_status: recruitment },
          targetType: "advertiser",
          targetId: row.id,
          title: "Create campaign",
          summary: `Create “${name}” for ${row.company_name} after you confirm. It will start as Under review.`,
          before: null,
          lines: detailLines([
            ["Advertiser", row.company_name],
            ["Ad name", name],
            ["Period", `${starts} – ${ends}`],
            ["Coverage", labelize(coverage)],
            ["Recruitment", labelize(recruitment)],
            ["Status", "Under review"],
          ]),
        }),
      );
    },
  },
  change_campaign_status: {
    kind: "write",
    description: "Change a campaign status. Statuses: under review, preparing, recruiting, in progress, paused, ended, rejected.",
    args: "name or id, company_name, status",
    async run(args, ctx) {
      const check = guardStatus(args.status, CAMPAIGN_STATUSES);
      if (check.missing) return ask("What status should the campaign have?");
      if (!check.status) return ask(`Use one of these campaign statuses: ${CAMPAIGN_STATUSES.map(labelize).join(", ")}.`);
      const found = await findCampaigns(args);
      return oneOf(ctx, "change_campaign_status", args, found, "campaign", campaignCard, async (row) => {
        if (row.status === check.status) return ask(`${row.name} is already ${labelize(check.status)}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_campaign_status",
          args,
          targetType: "campaign",
          targetId: row.id,
          title: "Change campaign status",
          summary: `Change ${row.name} from ${labelize(row.status)} to ${labelize(check.status)} after you confirm.`,
          before: { status: row.status },
          lines: detailLines([
            ["Campaign", row.name],
            ["Company", row.advertisers?.company_name],
            ["Current status", labelize(row.status)],
            ["New status", labelize(check.status)],
          ]),
        });
      });
    },
  },
  stop_campaign: {
    kind: "write",
    description: "Stop a campaign by setting its status to ended.",
    args: "name or id, company_name",
    async run(args, ctx) {
      const found = await findCampaigns(args);
      return oneOf(ctx, "stop_campaign", args, found, "campaign", campaignCard, (row) => {
        if (row.status === "ended") return refuse(ctx, "stop_campaign", `${row.name} is already ended. Nothing was changed.`, "campaign", row.id);
        return queue(ctx, {
          action: "stop_campaign",
          args,
          targetType: "campaign",
          targetId: row.id,
          title: "Stop campaign",
          summary: `Stop ${row.name} for ${row.advertisers?.company_name}. The status will become Ended after you confirm.`,
          before: { status: row.status },
          lines: detailLines([
            ["Campaign", row.name],
            ["Company", row.advertisers?.company_name],
            ["Current status", labelize(row.status)],
            ["New status", "Ended"],
          ]),
        });
      });
    },
  },
  change_recruitment_status: {
    kind: "write",
    description: "Set a campaign's driver recruitment to active or inactive.",
    args: "name or id, company_name, recruitment_status",
    async run(args, ctx) {
      const check = guardStatus(args.recruitment_status ?? args.status, ["active", "inactive"]);
      if (check.missing || !check.status) return ask("Should driver recruitment be active or inactive?");
      const found = await findCampaigns(args);
      return oneOf(ctx, "change_recruitment_status", args, found, "campaign", campaignCard, async (row) => {
        if (row.recruitment_status === check.status) return ask(`Recruitment for ${row.name} is already ${labelize(check.status)}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_recruitment_status",
          args,
          targetType: "campaign",
          targetId: row.id,
          title: "Change recruitment",
          summary: `Set recruitment for ${row.name} to ${labelize(check.status)} after you confirm.`,
          before: { recruitment_status: row.recruitment_status },
          lines: detailLines([
            ["Campaign", row.name],
            ["Current recruitment", labelize(row.recruitment_status)],
            ["New recruitment", labelize(check.status)],
          ]),
        });
      });
    },
  },
  change_campaign_name: {
    kind: "write",
    description: "Change a campaign's ad name. name is the current ad name. new_name is the replacement. Add company_name when more than one campaign shares the name.",
    args: "current name or id, company_name, new_name",
    async run(args, ctx) {
      const next = text(args.new_name) || text(args.new_campaign_name);
      if (!next) return ask("What should the new ad name be?");
      const currentName = text(args.current_name) || text(args.campaign_name) || (text(args.name) !== next ? text(args.name) : "");
      const found = await findCampaigns({ id: args.id, campaign_id: args.campaign_id, name: currentName, company_name: text(args.company_name) || text(args.company) });
      return oneOf(ctx, "change_campaign_name", args, found, "campaign", campaignCard, async (row) => {
        if (row.name === next) return ask(`${row.name} already uses that ad name. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_campaign_name",
          args: { ...args, new_name: next },
          targetType: "campaign",
          targetId: row.id,
          title: "Change ad name",
          summary: `Change the ad name from “${row.name}” to “${next}” after you confirm.`,
          before: { name: row.name },
          lines: detailLines([
            ["Company", row.advertisers?.company_name],
            ["Current ad name", row.name],
            ["New ad name", next],
          ]),
        });
      });
    },
  },
  change_campaign_company: {
    kind: "write",
    description: "Move one campaign to a different advertiser company. name is the ad name. company_name is the current company. new_company_name is the company that should own the campaign.",
    args: "name or id, current company_name, new_company_name",
    async run(args, ctx) {
      const nextCompany = text(args.new_company_name);
      if (!nextCompany) return ask("Which company should own this campaign?");
      const currentCompany = text(args.current_company_name) || (text(args.company_name) !== nextCompany ? text(args.company_name) : "");
      const campaignPinned = Boolean(text(args.campaign_id));
      const found = await findCampaigns({
        id: campaignPinned ? "" : args.id,
        campaign_id: args.campaign_id,
        name: text(args.name) || text(args.campaign_name),
        company_name: currentCompany,
      });
      return oneOf(ctx, "change_campaign_company", args, found, "campaign", campaignCard, async (row) => {
        const advertisers = await findAdvertisers(campaignPinned ? { id: args.id } : { company_name: nextCompany }, false);
        if (advertisers == null || advertisers.length === 0) return refuse(ctx, "change_campaign_company", `No advertiser named ${nextCompany} was found. Nothing was changed.`, "campaign", row.id);
        if (advertisers.length > 1) return ambiguous("change_campaign_company", { ...args, new_company_name: nextCompany, campaign_id: row.id }, advertisers, "advertiser", advertiserCard);
        const advertiser = advertisers[0];
        if (row.advertiser_id === advertiser.id) return ask(`${row.name} is already owned by ${advertiser.company_name}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_campaign_company",
          args: { ...args, new_company_name: nextCompany, advertiser_id: advertiser.id },
          targetType: "campaign",
          targetId: row.id,
          title: "Change campaign company",
          summary: `Move ${row.name} from ${row.advertisers?.company_name} to ${advertiser.company_name} after you confirm.`,
          before: { advertiser_id: row.advertiser_id },
          lines: detailLines([
            ["Ad name", row.name],
            ["Current company", row.advertisers?.company_name],
            ["New company", advertiser.company_name],
          ]),
        });
      });
    },
  },
  change_campaign_period: {
    kind: "write",
    description: "Change a campaign's start and end dates. Dates use YYYY-MM-DD.",
    args: "name or id, company_name, starts_on, ends_on",
    async run(args, ctx) {
      const starts = day(args.starts_on);
      const ends = day(args.ends_on);
      if (!starts || !ends) return ask("What should the new start and end dates be? Use YYYY-MM-DD.");
      if (ends < starts) return ask("The end date has to be on or after the start date.");
      const found = await findCampaigns(args);
      return oneOf(ctx, "change_campaign_period", args, found, "campaign", campaignCard, async (row) => {
        if (row.starts_on === starts && row.ends_on === ends) return ask(`${row.name} already runs from ${starts} to ${ends}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_campaign_period",
          args: { ...args, starts_on: starts, ends_on: ends },
          targetType: "campaign",
          targetId: row.id,
          title: "Change ad period",
          summary: `Change the period for ${row.name} from ${row.starts_on} – ${row.ends_on} to ${starts} – ${ends} after you confirm.`,
          before: { starts_on: row.starts_on, ends_on: row.ends_on },
          lines: detailLines([
            ["Ad name", row.name],
            ["Company", row.advertisers?.company_name],
            ["Current period", `${row.starts_on} – ${row.ends_on}`],
            ["New period", `${starts} – ${ends}`],
          ]),
        });
      });
    },
  },
  change_campaign_contact_name: {
    kind: "write",
    description: "Change the contact person on one campaign.",
    args: "name or id, company_name, contact_name",
    async run(args, ctx) {
      const next = text(args.new_contact_name) || text(args.contact_name);
      if (!next) return ask("Who should the new contact person be?");
      const found = await findCampaigns({
        id: args.id,
        campaign_id: args.campaign_id,
        name: text(args.campaign_name) || text(args.current_name) || (text(args.name) !== next ? text(args.name) : ""),
        company_name: text(args.company_name) || text(args.company),
      });
      return oneOf(ctx, "change_campaign_contact_name", args, found, "campaign", campaignCard, async (row) => {
        if (row.contact_name === next) return ask(`${row.name} already lists ${next} as the contact. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_campaign_contact_name",
          args: { ...args, contact_name: next },
          targetType: "campaign",
          targetId: row.id,
          title: "Change campaign contact",
          summary: `Change the contact for ${row.name} from “${row.contact_name || "—"}” to “${next}” after you confirm.`,
          before: { contact_name: row.contact_name },
          lines: detailLines([
            ["Ad name", row.name],
            ["Company", row.advertisers?.company_name],
            ["Current contact", row.contact_name || "—"],
            ["New contact", next],
          ]),
        });
      });
    },
  },
  change_campaign_contact_phone: {
    kind: "write",
    description: "Change the contact phone number on one campaign.",
    args: "name or id, company_name, contact_phone",
    async run(args, ctx) {
      const next = text(args.new_contact_phone) || text(args.contact_phone) || text(args.phone);
      if (!next) return ask("What should the new contact phone number be?");
      const found = await findCampaigns({
        id: args.id,
        campaign_id: args.campaign_id,
        name: text(args.campaign_name) || text(args.current_name) || (text(args.name) !== next ? text(args.name) : ""),
        company_name: text(args.company_name) || text(args.company),
      });
      return oneOf(ctx, "change_campaign_contact_phone", args, found, "campaign", campaignCard, async (row) => {
        if (row.contact_phone === next) return ask(`${row.name} already uses contact phone ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_campaign_contact_phone",
          args: { ...args, contact_phone: next },
          targetType: "campaign",
          targetId: row.id,
          title: "Change campaign contact phone",
          summary: `Change the contact phone for ${row.name} from ${row.contact_phone || "—"} to ${next} after you confirm.`,
          before: { contact_phone: row.contact_phone },
          lines: detailLines([
            ["Ad name", row.name],
            ["Company", row.advertisers?.company_name],
            ["Current phone", row.contact_phone || "—"],
            ["New phone", next],
          ]),
        });
      });
    },
  },
  change_application_status: {
    kind: "write",
    description: "Change a campaign application status: under review, preparing, operational, in progress, or ended.",
    args: "id or campaign_name plus partner_name or member_number, status",
    async run(args, ctx) {
      const check = guardStatus(args.status, APPLICATION_STATUSES);
      if (check.missing) return ask("What status should the application have?");
      if (!check.status) return ask(`Use one of these application statuses: ${APPLICATION_STATUSES.map(labelize).join(", ")}.`);
      const found = await findApplications(args);
      return oneOf(ctx, "change_application_status", args, found, "application", applicationCard, async (row) => {
        if (row.status === check.status) return ask(`${row.cargo_partners?.name}'s application on ${row.campaigns?.name} is already ${labelize(check.status)}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_application_status",
          args,
          targetType: "campaign_application",
          targetId: row.id,
          title: "Change application status",
          summary: `Change ${row.cargo_partners?.name}'s application on ${row.campaigns?.name} to ${labelize(check.status)} after you confirm.`,
          before: { status: row.status },
          lines: detailLines([
            ["Partner", row.cargo_partners?.name],
            ["Member", row.cargo_partners?.member_number],
            ["Campaign", row.campaigns?.name],
            ["Current status", labelize(row.status)],
            ["New status", labelize(check.status)],
          ]),
        });
      });
    },
  },
  change_application_region: {
    kind: "write",
    description: "Change the region on one campaign application, such as Seoul > Gangnam-gu. This is the application's region, not the cargo partner's region.",
    args: "campaign_name plus partner_name or member_number or id, region",
    async run(args, ctx) {
      const next = text(args.new_region) || text(args.region) || text(args.region_label);
      if (!next) return ask("What should the new application region be?");
      const found = await findApplications({ ...args, region: "", region_label: "", new_region: "" });
      return oneOf(ctx, "change_application_region", args, found, "application", applicationCard, async (row) => {
        if (row.region_label === next) return ask(`${row.cargo_partners?.name}'s application on ${row.campaigns?.name} is already in ${next}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_application_region",
          args: { ...args, region: next },
          targetType: "campaign_application",
          targetId: row.id,
          title: "Change application region",
          summary: `Change the region for ${row.cargo_partners?.name}'s application on ${row.campaigns?.name} from ${row.region_label || "—"} to ${next} after you confirm.`,
          before: { region_label: row.region_label },
          lines: detailLines([
            ["Partner", row.cargo_partners?.name],
            ["Member", row.cargo_partners?.member_number],
            ["Campaign", row.campaigns?.name],
            ["Current region", row.region_label || "—"],
            ["New region", next],
          ]),
        });
      });
    },
  },
  update_cargo_settlement_operation_count: settlementMeasureAction("operation_count"),
  update_cargo_settlement_distance: settlementMeasureAction("distance_km"),
  confirm_cargo_settlement: {
    kind: "write",
    description: "Confirm an operating-partner settlement that is still before settlement.",
    args: "id or partner_name or member_number, month",
    async run(args, ctx) {
      const found = await findCargoSettlements(args);
      return oneOf(ctx, "confirm_cargo_settlement", args, found, "cargo settlement", (row) => ({
        label: row.cargo_partners?.name ?? "Settlement",
        detail: `${String(row.settlement_month).slice(0, 7)} · ${labelize(row.status)} · ${krw(row.final_amount_krw)}`,
      }), (row) => {
        if (row.status !== "before_settlement") {
          return refuse(ctx, "confirm_cargo_settlement", `${row.cargo_partners?.name}'s ${String(row.settlement_month).slice(0, 7)} settlement is already ${labelize(row.status)}. Nothing was changed.`, "cargo_settlement", row.id);
        }
        return queue(ctx, {
          action: "confirm_cargo_settlement",
          args,
          targetType: "cargo_settlement",
          targetId: row.id,
          title: "Confirm settlement",
          summary: `Confirm the ${String(row.settlement_month).slice(0, 7)} settlement for ${row.cargo_partners?.name} at ${krw(row.final_amount_krw)}.`,
          before: { status: row.status },
          lines: detailLines([
            ["Partner", row.cargo_partners?.name],
            ["Month", String(row.settlement_month).slice(0, 7)],
            ["Amount", krw(row.final_amount_krw)],
            ["New status", "Settlement confirmed"],
          ]),
        });
      });
    },
  },
  update_cargo_settlement_fees: {
    kind: "write",
    description: "Update fee quantities or the memo on a cargo settlement that is still before settlement.",
    args: "partner_name or id, month, visit, detachment, event, introduce, fuel, interview, other_amount, memo",
    async run(args, ctx) {
      const quantities = feeQuantities(args);
      const hasMemo = "memo" in args;
      if (!quantities.length && !hasMemo) return ask("Which fee counts or memo should I update?");
      const found = await findCargoSettlements(args);
      return oneOf(ctx, "update_cargo_settlement_fees", args, found, "cargo settlement", (row) => ({
        label: row.cargo_partners?.name ?? "Settlement",
        detail: `${String(row.settlement_month).slice(0, 7)} · ${labelize(row.status)}`,
      }), (row) => {
        if (row.status !== "before_settlement") {
          return refuse(ctx, "update_cargo_settlement_fees", "Only a settlement that is still before settlement can be edited. Nothing was changed.", "cargo_settlement", row.id);
        }
        return queue(ctx, {
          action: "update_cargo_settlement_fees",
          args,
          targetType: "cargo_settlement",
          targetId: row.id,
          title: "Update settlement fees",
          summary: `Update fees for ${row.cargo_partners?.name} (${String(row.settlement_month).slice(0, 7)}) after you confirm.`,
          before: { status: row.status, final_amount_krw: row.final_amount_krw, memo: row.memo },
          lines: detailLines([
            ["Partner", row.cargo_partners?.name],
            ["Month", String(row.settlement_month).slice(0, 7)],
            ...quantities.map((item) => [labelize(item.type), item.type === "other" ? krw(item.quantity) : String(item.quantity)] as [string, string]),
            ["Memo", hasMemo ? text(args.memo) || "Clear memo" : ""],
          ]),
        });
      });
    },
  },
  update_cargo_settlement_base: settlementAmountAction("base"),
  update_cargo_settlement_extras: settlementAmountAction("extras"),
  update_cargo_settlement_tax: settlementAmountAction("tax"),
  update_cargo_settlement_net: settlementAmountAction("net"),
  update_advertiser_settlement_discount: {
    kind: "write",
    description: "Set the discount rate, from 0 to 100 percent, on an advertiser settlement that is still before payment.",
    args: "campaign_name or company_name or id, month, discount_rate",
    async run(args, ctx) {
      const rate = percentInput(args.discount_rate ?? args.discount ?? args.rate);
      if (rate == null) return ask("What discount rate should I set? Use a number from 0 to 100.");
      const found = await findAdvertiserSettlements(args);
      return oneOf(ctx, "update_advertiser_settlement_discount", { ...args, discount_rate: rate }, found, "advertiser settlement", (row) => ({
        label: row.campaigns?.name ?? "Settlement",
        detail: `${row.campaigns?.advertisers?.company_name ?? "—"} · ${labelize(row.status)} · ${Number(row.discount_rate)}%`,
      }), async (row) => {
        if (row.status !== "before_payment") {
          return refuse(ctx, "update_advertiser_settlement_discount", `${row.campaigns?.name} is already ${labelize(row.status)}. Nothing was changed.`, "advertiser_settlement", row.id);
        }
        if (Number(row.discount_rate) === rate) return ask(`${row.campaigns?.name} already has a ${rate}% discount. Nothing needs to change.`);
        return queue(ctx, {
          action: "update_advertiser_settlement_discount",
          args: { ...args, discount_rate: rate },
          targetType: "advertiser_settlement",
          targetId: row.id,
          title: "Change discount rate",
          summary: `Set the discount for ${row.campaigns?.name} (${String(row.settlement_month).slice(0, 7)}) from ${Number(row.discount_rate)}% to ${rate}% after you confirm.`,
          before: { status: row.status, discount_rate: row.discount_rate },
          lines: detailLines([
            ["Campaign", row.campaigns?.name],
            ["Company", row.campaigns?.advertisers?.company_name],
            ["Month", String(row.settlement_month).slice(0, 7)],
            ["Current discount", `${Number(row.discount_rate)}%`],
            ["New discount", `${rate}%`],
          ]),
        });
      });
    },
  },
  update_advertiser_settlement_amount: {
    kind: "write",
    description: "Set the final payment amount, in KRW, on an advertiser settlement that is still before payment.",
    args: "campaign_name or company_name or id, month, amount",
    async run(args, ctx) {
      const amount = moneyInput(args.amount ?? args.final_amount_krw ?? args.final_amount);
      if (amount == null) return ask("What final payment amount, in KRW, should I set?");
      const found = await findAdvertiserSettlements(args);
      return oneOf(ctx, "update_advertiser_settlement_amount", { ...args, amount }, found, "advertiser settlement", (row) => ({
        label: row.campaigns?.name ?? "Settlement",
        detail: `${row.campaigns?.advertisers?.company_name ?? "—"} · ${labelize(row.status)} · ${krw(row.final_amount_krw)}`,
      }), async (row) => {
        if (row.status !== "before_payment") {
          return refuse(ctx, "update_advertiser_settlement_amount", `${row.campaigns?.name} is already ${labelize(row.status)}. Nothing was changed.`, "advertiser_settlement", row.id);
        }
        if (Number(row.final_amount_krw) === amount) return ask(`${row.campaigns?.name} is already ${krw(amount)}. Nothing needs to change.`);
        return queue(ctx, {
          action: "update_advertiser_settlement_amount",
          args: { ...args, amount },
          targetType: "advertiser_settlement",
          targetId: row.id,
          title: "Change final payment amount",
          summary: `Set the final payment for ${row.campaigns?.name} (${String(row.settlement_month).slice(0, 7)}) to ${krw(amount)} after you confirm.`,
          before: { status: row.status, final_amount_krw: row.final_amount_krw },
          lines: detailLines([
            ["Campaign", row.campaigns?.name],
            ["Company", row.campaigns?.advertisers?.company_name],
            ["Month", String(row.settlement_month).slice(0, 7)],
            ["Current amount", krw(row.final_amount_krw)],
            ["New amount", krw(amount)],
          ]),
        });
      });
    },
  },
  confirm_advertiser_payment: {
    kind: "write",
    description: "Mark an advertiser settlement as payment confirmed.",
    args: "id or campaign_name or company_name, month",
    async run(args, ctx) {
      const found = await findAdvertiserSettlements(args);
      return oneOf(ctx, "confirm_advertiser_payment", args, found, "advertiser settlement", (row) => ({
        label: row.campaigns?.name ?? "Settlement",
        detail: `${row.campaigns?.advertisers?.company_name ?? "—"} · ${labelize(row.status)} · ${krw(row.final_amount_krw)}`,
      }), (row) => {
        if (row.status !== "before_payment") {
          return refuse(ctx, "confirm_advertiser_payment", `${row.campaigns?.name} is already ${labelize(row.status)}. Nothing was changed.`, "advertiser_settlement", row.id);
        }
        return queue(ctx, {
          action: "confirm_advertiser_payment",
          args,
          targetType: "advertiser_settlement",
          targetId: row.id,
          title: "Confirm advertiser payment",
          summary: `Confirm payment of ${krw(row.final_amount_krw)} for ${row.campaigns?.name}.`,
          before: { status: row.status },
          lines: detailLines([
            ["Campaign", row.campaigns?.name],
            ["Company", row.campaigns?.advertisers?.company_name],
            ["Amount", krw(row.final_amount_krw)],
            ["New status", "Payment confirmed"],
          ]),
        });
      });
    },
  },
  deduct_solo_pay: {
    kind: "write",
    description: "Deduct a KRW amount from one advertiser Solo Pay wallet.",
    args: "company_name or id, amount, detail",
    async run(args, ctx) {
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) return ask("How many KRW should I deduct?");
      const found = await findAdvertisers(args, true);
      if (found == null) return ask("Which advertiser wallet should I deduct from?");
      if (found.length === 0) return refuse(ctx, "deduct_solo_pay", "No advertiser matched. Nothing was deducted.");
      if (found.length > 1) return ambiguous("deduct_solo_pay", args, found, "advertiser", advertiserCard);
      const advertiser = found[0];
      const account = unwrap<Row | null>(await db().from("solo_pay_accounts").select("*").eq("advertiser_id", advertiser.id).maybeSingle());
      if (!account) return refuse(ctx, "deduct_solo_pay", `${advertiser.company_name} has no Solo Pay account. Nothing was deducted.`, "advertiser", advertiser.id);
      if (!account.linked) return refuse(ctx, "deduct_solo_pay", `Solo Pay is not linked for ${advertiser.company_name}. Nothing was deducted.`, "solo_pay_account", account.id);
      if (account.balance_krw < amount) {
        return refuse(ctx, "deduct_solo_pay", `${advertiser.company_name} has ${krw(account.balance_krw)}, which is less than ${krw(amount)}. Nothing was deducted.`, "solo_pay_account", account.id);
      }
      return queue(ctx, {
        action: "deduct_solo_pay",
        args: { ...args, amount },
        targetType: "solo_pay_account",
        targetId: account.id,
        title: "Deduct Solo Pay",
        summary: `Deduct ${krw(amount)} from ${advertiser.company_name} after you confirm. Balance is ${krw(account.balance_krw)}.`,
        before: { balance_krw: account.balance_krw, linked: account.linked },
        lines: detailLines([
          ["Company", advertiser.company_name],
          ["Current balance", krw(account.balance_krw)],
          ["Deduction", krw(amount)],
          ["Balance after", krw(account.balance_krw - amount)],
        ]),
      });
    },
  },
  set_solo_pay_linked: {
    kind: "write",
    description: "Link or unlink one advertiser Solo Pay wallet. Use yes to link and no to unlink.",
    args: "company_name or id, linked",
    async run(args, ctx) {
      const linked = booleanValue(args.linked ?? args.value ?? args.state);
      if (linked == null) return ask("Should Solo Pay be linked? Yes or no.");
      const found = await findAdvertisers(args, true);
      if (found == null) return ask("Which advertiser wallet should I update?");
      if (found.length === 0) return refuse(ctx, "set_solo_pay_linked", "No advertiser matched. Nothing was changed.");
      if (found.length > 1) return ambiguous("set_solo_pay_linked", { ...args, linked }, found, "advertiser", advertiserCard);
      const advertiser = found[0];
      const account = unwrap<Row | null>(await db().from("solo_pay_accounts").select("*").eq("advertiser_id", advertiser.id).maybeSingle());
      if (!account) return refuse(ctx, "set_solo_pay_linked", `${advertiser.company_name} has no Solo Pay account. Nothing was changed.`, "advertiser", advertiser.id);
      if (account.linked === linked) return ask(`Solo Pay for ${advertiser.company_name} is already ${linked ? "linked" : "unlinked"}. Nothing needs to change.`);
      return queue(ctx, {
        action: "set_solo_pay_linked",
        args: { ...args, linked },
        targetType: "solo_pay_account",
        targetId: account.id,
        title: "Change Solo Pay link",
        summary: `${linked ? "Link" : "Unlink"} Solo Pay for ${advertiser.company_name} after you confirm.`,
        before: { linked: account.linked },
        lines: detailLines([
          ["Company", advertiser.company_name],
          ["Current", account.linked ? "Linked" : "Not linked"],
          ["New", linked ? "Linked" : "Not linked"],
        ]),
      });
    },
  },
  set_solo_pay_balance: {
    kind: "write",
    description: "Set the Moad money balance, in KRW, on one Solo Pay wallet. The difference is recorded as a recharge or a deduction.",
    args: "company_name or id, balance",
    async run(args, ctx) {
      const balance = moneyInput(args.balance ?? args.balance_krw ?? args.amount);
      if (balance == null) return ask("What should the Moad money balance be, in KRW?");
      const found = await findAdvertisers(args, true);
      if (found == null) return ask("Which advertiser wallet should I update?");
      if (found.length === 0) return refuse(ctx, "set_solo_pay_balance", "No advertiser matched. Nothing was changed.");
      if (found.length > 1) return ambiguous("set_solo_pay_balance", { ...args, balance }, found, "advertiser", advertiserCard);
      const advertiser = found[0];
      const account = unwrap<Row | null>(await db().from("solo_pay_accounts").select("*").eq("advertiser_id", advertiser.id).maybeSingle());
      if (!account) return refuse(ctx, "set_solo_pay_balance", `${advertiser.company_name} has no Solo Pay account. Nothing was changed.`, "advertiser", advertiser.id);
      if (Number(account.balance_krw) === balance) return ask(`${advertiser.company_name} already has ${krw(balance)}. Nothing needs to change.`);
      return queue(ctx, {
        action: "set_solo_pay_balance",
        args: { ...args, balance },
        targetType: "solo_pay_account",
        targetId: account.id,
        title: "Change Moad money",
        summary: `Set the Moad money balance for ${advertiser.company_name} from ${krw(account.balance_krw)} to ${krw(balance)} after you confirm.`,
        before: { balance_krw: account.balance_krw },
        lines: detailLines([
          ["Company", advertiser.company_name],
          ["Current balance", krw(account.balance_krw)],
          ["New balance", krw(balance)],
        ]),
      });
    },
  },
  create_faq: {
    kind: "write",
    description: "Create an FAQ post.",
    args: "question, answer, category",
    async run(args, ctx) {
      const question = text(args.question);
      if (!question) return ask("What is the FAQ question?");
      const category = canonical(args.category || "others");
      if (!["use_of_service", "settlement", "others"].includes(category)) return ask("FAQ category must be use of service, settlement, or others.");
      return queue(ctx, {
        action: "create_faq",
        args: { ...args, question, category, answer: text(args.answer) },
        targetType: "faq",
        targetId: null,
        title: "Create FAQ",
        summary: `Create the FAQ “${question}” after you confirm.`,
        before: null,
        lines: detailLines([
          ["Question", question],
          ["Category", labelize(category)],
          ["Answer", text(args.answer) || "No answer yet"],
        ]),
      });
    },
  },
  delete_faq: postDelete("faq", "faqs", "question"),
  set_faq_pin: postFlag("faq", "faqs", "question", "pinned", "Pin FAQ", "set_faq_pin"),
  set_faq_exposure: postFlag("faq", "faqs", "question", "exposed", "Change FAQ exposure", "set_faq_exposure"),
  reorder_faqs: postReorder("faq", "faqs", "question", "reorder_faqs"),
  create_notice: {
    kind: "write",
    description: "Create a notice for both, cargo owner, advertiser, or landing page.",
    args: "title, body, audience",
    async run(args, ctx) {
      const title = text(args.title);
      if (!title) return ask("What is the notice title?");
      const audience = canonical(args.audience || "both");
      if (!["both", "cargo_owner", "advertiser", "landing_page"].includes(audience)) {
        return ask("Audience must be both, cargo owner, advertiser, or landing page.");
      }
      return queue(ctx, {
        action: "create_notice",
        args: { ...args, title, audience, body: text(args.body) },
        targetType: "notice",
        targetId: null,
        title: "Create notice",
        summary: `Create the notice “${title}” after you confirm.`,
        before: null,
        lines: detailLines([
          ["Title", title],
          ["Audience", labelize(audience)],
          ["Body", text(args.body) || "No body yet"],
        ]),
      });
    },
  },
  change_notice_category: {
    kind: "write",
    description: "Change a notice category. Categories: both, cargo owner, advertiser, landing page.",
    args: "title or id, audience or category",
    async run(args, ctx) {
      const audience = canonical(args.audience || args.category);
      if (!audience) return ask("Which category should the notice use? Both, cargo owner, advertiser, or landing page.");
      if (!["both", "cargo_owner", "advertiser", "landing_page"].includes(audience)) {
        return ask("Category must be both, cargo owner, advertiser, or landing page.");
      }
      const found = await findPosts("notices", args, "title");
      return oneOf(ctx, "change_notice_category", args, found, "notice", (row) => ({ label: String(row.title), detail: labelize(row.audience) }), async (row) => {
        if (row.audience === audience) return ask(`“${row.title}” is already ${labelize(audience)}. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_notice_category",
          args: { ...args, audience },
          targetType: "notice",
          targetId: row.id,
          title: "Change notice category",
          summary: `Change “${row.title}” from ${labelize(row.audience)} to ${labelize(audience)} after you confirm.`,
          before: { audience: row.audience },
          lines: detailLines([
            ["Title", row.title],
            ["Current category", labelize(row.audience)],
            ["New category", labelize(audience)],
          ]),
        });
      });
    },
  },
  change_notice_title: {
    kind: "write",
    description: "Change the title of one notice.",
    args: "current title or id, new_title",
    async run(args, ctx) {
      const next = text(args.new_title);
      const currentTitle = text(args.current_title) || text(args.name) || text(args.title);
      if (!next) return ask("What should the new notice title be?");
      if (!currentTitle && !text(args.id)) return ask("Which notice title should I change?");
      const found = await findPosts("notices", { ...args, title: currentTitle }, "title");
      return oneOf(ctx, "change_notice_title", args, found, "notice", (row) => ({ label: String(row.title), detail: labelize(row.audience) }), async (row) => {
        if (row.title === next) return ask(`The notice is already titled “${next}”. Nothing needs to change.`);
        return queue(ctx, {
          action: "change_notice_title",
          args: { ...args, new_title: next },
          targetType: "notice",
          targetId: row.id,
          title: "Change notice title",
          summary: `Change the notice title from “${row.title}” to “${next}” after you confirm.`,
          before: { title: row.title },
          lines: detailLines([
            ["Current title", row.title],
            ["New title", next],
            ["Category", labelize(row.audience)],
          ]),
        });
      });
    },
  },
  delete_notice: postDelete("notice", "notices", "title"),
  set_notice_pin: postFlag("notice", "notices", "title", "pinned", "Pin notice", "set_notice_pin"),
  reorder_notices: postReorder("notice", "notices", "title", "reorder_notices"),
};

function postDelete(noun: string, table: string, column: "question" | "title"): ActionHandler {
  const action = table === "faqs" ? "delete_faq" : "delete_notice";
  return {
    kind: "write",
    description: `Delete one ${noun}.`,
    args: `${column} or id`,
    async run(args, ctx) {
      const found = await findPosts(table, args, column);
      return oneOf(ctx, action, args, found, noun, (row) => ({ label: String(row[column]), detail: labelize(row.category || row.audience) }), (row) =>
        queue(ctx, {
          action,
          args,
          targetType: noun,
          targetId: row.id,
          title: `Delete ${noun}`,
          summary: `Delete “${row[column]}” after you confirm.`,
          before: { title: row[column] },
          lines: detailLines([["Post", row[column]]]),
        }),
      );
    },
  };
}

function postFlag(noun: string, table: string, column: "question" | "title", field: "pinned" | "exposed", title: string, action: string): ActionHandler {
  const pin = field === "pinned";
  return {
    kind: "write",
    description: pin
      ? `Pin or unpin one ${noun}. Set pinned to true to pin it, or false to unpin it.`
      : `Show or hide one ${noun}. Set exposed to true to show it, or false to hide it.`,
    args: `${column} or id, ${field}`,
    async run(args, ctx) {
      const flag = booleanValue(args[field] ?? args.value ?? args.state);
      if (flag == null) return ask(pin ? "Should I pin it or unpin it?" : "Should I show it or hide it?");
      const found = await findPosts(table, args, column);
      const verb = pin ? (flag ? "Pin" : "Unpin") : (flag ? "Show" : "Hide");
      const state = pin ? (flag ? "pinned" : "unpinned") : (flag ? "shown" : "hidden");
      return oneOf(ctx, action, args, found, noun, (row) => ({ label: String(row[column]), detail: labelize(row.category || row.audience) }), async (row) => {
        if (row[field] === flag) return ask(`“${row[column]}” is already ${state}. Nothing needs to change.`);
        return queue(ctx, {
          action,
          args: { ...args, [field]: flag },
          targetType: noun,
          targetId: row.id,
          title: `${verb} ${noun}`,
          summary: `${verb} “${row[column]}” after you confirm.`,
          before: { [field]: row[field] },
          lines: detailLines([
            ["Post", row[column]],
            ["Current", row[field] ? (pin ? "Pinned" : "Shown") : (pin ? "Not pinned" : "Hidden")],
            ["New", flag ? (pin ? "Pinned" : "Shown") : (pin ? "Not pinned" : "Hidden")],
          ]),
        });
      });
    },
  };
}

function postReorder(noun: string, table: string, column: "question" | "title", action: string): ActionHandler {
  return {
    kind: "write",
    description: `Move one ${noun} up or down in the list.`,
    args: `${column} or id, direction`,
    async run(args, ctx) {
      const raw = text(args.direction).toLowerCase();
      const move = ["up", "higher", "earlier"].includes(raw) ? "up" : ["down", "lower", "later"].includes(raw) ? "down" : "";
      if (!move) return ask("Should I move it up or down?");
      const found = await findPosts(table, args, column);
      return oneOf(ctx, action, args, found, noun, (row) => ({ label: String(row[column]), detail: `Order ${row.sort_order}` }), (row) =>
        queue(ctx, {
          action,
          args: { ...args, direction: move },
          targetType: noun,
          targetId: row.id,
          title: "Change order",
          summary: `Move “${row[column]}” ${move} after you confirm.`,
          before: { sort_order: row.sort_order },
          lines: detailLines([
            ["Post", row[column]],
            ["Direction", move],
          ]),
        }),
      );
    },
  };
}

function feeQuantities(args: Args) {
  const items: { type: FeeType; quantity: number }[] = [];
  for (const type of FEE_TYPES) {
    const quantity = Number(args[type] ?? args[`${type}_count`]);
    if (Number.isFinite(quantity) && quantity >= 0) items.push({ type, quantity });
  }
  const other = Number(args.other_amount ?? args.other);
  if (Number.isFinite(other) && other >= 0) items.push({ type: "other", quantity: other });
  return items;
}

async function updateStatus(table: string, pending: PendingAction, nextStatus: string) {
  const current = await requireCurrent(table, pending.target_id, pending.before_data, ["status"]);
  if (current.status === nextStatus) {
    throw new ActionRefusal(`${labelOf(current)} is already ${labelize(nextStatus)}. Nothing was changed.`);
  }
  unwrap(await db().from(table).update({ status: nextStatus }).eq("id", current.id));
  return {
    summary: `${labelOf(current)} is now ${labelize(nextStatus)}.`,
    before: { status: current.status },
    after: { status: nextStatus, id: current.id },
  };
}

async function updateBlacklistReason(table: string, pending: PendingAction, next: string) {
  const current = await requireCurrent(table, pending.target_id, pending.before_data, ["blacklist_reason"]);
  if (current.status !== "blacklist") throw new ActionRefusal(`${labelOf(current)} is not on the blacklist. Nothing was changed.`);
  if (!next) throw new ActionRefusal("A blacklist reason is required. Nothing was changed.");
  unwrap(await db().from(table).update({ blacklist_reason: next }).eq("id", current.id));
  return { summary: `The blacklist reason for ${labelOf(current)} is now ${next}.`, before: { blacklist_reason: current.blacklist_reason }, after: { blacklist_reason: next, id: current.id } };
}

function labelOf(row: Row) {
  return row.company_name || row.name || row.member_number || row.title || row.question || "The record";
}

function emailLooksValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function advertiserEmailOwner(email: string, exceptId: string) {
  const rows = unwrap<Row[]>(await db().from("advertisers").select("id, company_name").ilike("email", email).limit(5));
  return rows.find((row) => row.id !== exceptId) ?? null;
}

async function cargoMemberOwner(memberNumber: string, exceptId: string) {
  const rows = unwrap<Row[]>(await db().from("cargo_partners").select("id, name").eq("member_number", memberNumber).limit(5));
  return rows.find((row) => row.id !== exceptId) ?? null;
}

export async function commitAction(pending: PendingAction) {
  const args = pending.args || {};
  switch (pending.action_name) {
    case "change_advertiser_status":
      return updateStatus("advertisers", pending, canonical(args.status));
    case "set_advertiser_blacklist_reason":
      return updateBlacklistReason("advertisers", pending, text(args.blacklist_reason));
    case "change_advertiser_contact_name": {
      const current = await requireCurrent("advertisers", pending.target_id, pending.before_data, ["contact_name"]);
      const next = text(args.contact_name);
      if (!next) throw new ActionRefusal("A contact name is required. Nothing was changed.");
      unwrap(await db().from("advertisers").update({ contact_name: next }).eq("id", current.id));
      return { summary: `The contact name for ${current.company_name} is now ${next}.`, before: { contact_name: current.contact_name }, after: { contact_name: next, id: current.id } };
    }
    case "change_advertiser_contact_phone": {
      const current = await requireCurrent("advertisers", pending.target_id, pending.before_data, ["contact_phone"]);
      const next = text(args.contact_phone);
      if (!next) throw new ActionRefusal("A contact phone number is required. Nothing was changed.");
      unwrap(await db().from("advertisers").update({ contact_phone: next }).eq("id", current.id));
      return { summary: `The contact phone for ${current.company_name} is now ${next}.`, before: { contact_phone: current.contact_phone }, after: { contact_phone: next, id: current.id } };
    }
    case "change_advertiser_company_name": {
      const current = await requireCurrent("advertisers", pending.target_id, pending.before_data, ["company_name"]);
      const next = text(args.new_company_name);
      if (!next) throw new ActionRefusal("A company name is required. Nothing was changed.");
      unwrap(await db().from("advertisers").update({ company_name: next }).eq("id", current.id));
      return { summary: `The company name is now ${next}.`, before: { company_name: current.company_name }, after: { company_name: next, id: current.id } };
    }
    case "change_advertiser_email": {
      const current = await requireCurrent("advertisers", pending.target_id, pending.before_data, ["email"]);
      const next = text(args.new_email);
      if (!next || !emailLooksValid(next)) throw new ActionRefusal("A valid email is required. Nothing was changed.");
      const taken = await advertiserEmailOwner(next, current.id);
      if (taken) throw new ActionRefusal(`${next} is already used by ${taken.company_name}. Nothing was changed.`);
      unwrap(await db().from("advertisers").update({ email: next }).eq("id", current.id));
      return { summary: `The email for ${current.company_name} is now ${next}.`, before: { email: current.email }, after: { email: next, id: current.id } };
    }
    case "change_advertiser_company_phone": {
      const current = await requireCurrent("advertisers", pending.target_id, pending.before_data, ["company_phone"]);
      const next = text(args.company_phone);
      if (!next) throw new ActionRefusal("A company phone number is required. Nothing was changed.");
      unwrap(await db().from("advertisers").update({ company_phone: next }).eq("id", current.id));
      return { summary: `The company phone for ${current.company_name} is now ${next}.`, before: { company_phone: current.company_phone }, after: { company_phone: next, id: current.id } };
    }
    case "change_cargo_partner_status":
      return updateStatus("cargo_partners", pending, canonical(args.status));
    case "set_cargo_partner_blacklist_reason":
      return updateBlacklistReason("cargo_partners", pending, text(args.blacklist_reason));
    case "change_cargo_partner_name": {
      const current = await requireCurrent("cargo_partners", pending.target_id, pending.before_data, ["name"]);
      const newName = text(args.new_name);
      unwrap(await db().from("cargo_partners").update({ name: newName }).eq("id", current.id));
      return { summary: `${current.member_number} is now named ${newName}.`, before: { name: current.name }, after: { name: newName, id: current.id } };
    }
    case "change_cargo_partner_member_number": {
      const current = await requireCurrent("cargo_partners", pending.target_id, pending.before_data, ["member_number"]);
      const next = text(args.new_member_number);
      if (!next) throw new ActionRefusal("A member number is required. Nothing was changed.");
      const taken = await cargoMemberOwner(next, current.id);
      if (taken) throw new ActionRefusal(`${next} is already used by ${taken.name}. Nothing was changed.`);
      unwrap(await db().from("cargo_partners").update({ member_number: next }).eq("id", current.id));
      return { summary: `${current.name} is now member ${next}.`, before: { member_number: current.member_number }, after: { member_number: next, id: current.id } };
    }
    case "change_cargo_partner_phone": {
      const current = await requireCurrent("cargo_partners", pending.target_id, pending.before_data, ["phone"]);
      const next = text(args.phone);
      if (!next) throw new ActionRefusal("A phone number is required. Nothing was changed.");
      unwrap(await db().from("cargo_partners").update({ phone: next }).eq("id", current.id));
      return { summary: `The phone for ${current.name} is now ${next}.`, before: { phone: current.phone }, after: { phone: next, id: current.id } };
    }
    case "change_cargo_partner_vehicle_number": {
      const current = await requireCurrent("cargo_partners", pending.target_id, pending.before_data, ["vehicle_number"]);
      const next = text(args.vehicle_number);
      if (!next) throw new ActionRefusal("A vehicle number is required. Nothing was changed.");
      unwrap(await db().from("cargo_partners").update({ vehicle_number: next }).eq("id", current.id));
      return { summary: `The vehicle number for ${current.name} is now ${next}.`, before: { vehicle_number: current.vehicle_number }, after: { vehicle_number: next, id: current.id } };
    }
    case "change_cargo_partner_vehicle_type": {
      const current = await requireCurrent("cargo_partners", pending.target_id, pending.before_data, ["vehicle_type"]);
      const next = text(args.vehicle_type);
      if (!next) throw new ActionRefusal("A vehicle type is required. Nothing was changed.");
      unwrap(await db().from("cargo_partners").update({ vehicle_type: next }).eq("id", current.id));
      return { summary: `The vehicle type for ${current.name} is now ${next}.`, before: { vehicle_type: current.vehicle_type }, after: { vehicle_type: next, id: current.id } };
    }
    case "change_cargo_partner_fixed_location": {
      const current = await requireCurrent("cargo_partners", pending.target_id, pending.before_data, ["fixed_operating_location"]);
      const flag = booleanValue(args.fixed_operating_location);
      if (flag == null) throw new ActionRefusal("Fixed operating location must be yes or no. Nothing was changed.");
      unwrap(await db().from("cargo_partners").update({ fixed_operating_location: flag }).eq("id", current.id));
      return { summary: `Fixed operating location for ${current.name} is now ${flag ? "yes" : "no"}.`, before: { fixed_operating_location: current.fixed_operating_location }, after: { fixed_operating_location: flag, id: current.id } };
    }
    case "change_cargo_partner_region": {
      const current = await requireCurrent("cargo_partners", pending.target_id, pending.before_data, ["region_label"]);
      const next = text(args.region);
      if (!next) throw new ActionRefusal("A region is required. Nothing was changed.");
      unwrap(await db().from("cargo_partners").update({ region_label: next }).eq("id", current.id));
      return { summary: `The region for ${current.name} is now ${next}.`, before: { region_label: current.region_label }, after: { region_label: next, id: current.id } };
    }
    case "create_campaign": {
      const advertiser = await loadOne("advertisers", pending.target_id || "");
      if (!advertiser) throw new ActionRefusal("The advertiser is no longer there. No campaign was created.");
      const inserted = unwrap<Row>(
        await db()
          .from("campaigns")
          .insert({
            advertiser_id: advertiser.id,
            name: text(args.name),
            status: "under_review",
            starts_on: day(args.starts_on),
            ends_on: day(args.ends_on),
            contact_name: text(args.contact_name) || advertiser.contact_name,
            contact_phone: text(args.contact_phone) || advertiser.contact_phone,
            recruitment_status: canonical(args.recruitment_status || "active"),
            coverage_type: canonical(args.coverage_type || "national"),
          })
          .select("id, name")
          .single(),
      );
      return { summary: `Created campaign ${inserted.name} for ${advertiser.company_name}. Status is Under review.`, before: null, after: inserted };
    }
    case "change_campaign_status":
      return updateStatus("campaigns", pending, canonical(args.status));
    case "stop_campaign": {
      const current = await requireCurrent("campaigns", pending.target_id, pending.before_data, ["status"]);
      if (current.status === "ended") throw new ActionRefusal(`${current.name} is already ended. Nothing was changed.`);
      unwrap(await db().from("campaigns").update({ status: "ended" }).eq("id", current.id));
      return { summary: `${current.name} is now Ended.`, before: { status: current.status }, after: { status: "ended", id: current.id } };
    }
    case "change_recruitment_status": {
      const current = await requireCurrent("campaigns", pending.target_id, pending.before_data, ["recruitment_status"]);
      const recruitment = canonical(args.recruitment_status ?? args.status);
      if (current.recruitment_status === recruitment) {
        throw new ActionRefusal(`Recruitment for ${current.name} is already ${labelize(recruitment)}. Nothing was changed.`);
      }
      unwrap(await db().from("campaigns").update({ recruitment_status: recruitment }).eq("id", current.id));
      return { summary: `Recruitment for ${current.name} is now ${labelize(recruitment)}.`, before: { recruitment_status: current.recruitment_status }, after: { recruitment_status: recruitment, id: current.id } };
    }
    case "change_campaign_name": {
      const current = await requireCurrent("campaigns", pending.target_id, pending.before_data, ["name"]);
      const next = text(args.new_name);
      if (!next) throw new ActionRefusal("An ad name is required. Nothing was changed.");
      unwrap(await db().from("campaigns").update({ name: next }).eq("id", current.id));
      return { summary: `The ad name is now ${next}.`, before: { name: current.name }, after: { name: next, id: current.id } };
    }
    case "change_campaign_company": {
      const current = await requireCurrent("campaigns", pending.target_id, pending.before_data, ["advertiser_id"]);
      const advertiserId = text(args.advertiser_id);
      const advertiser = await loadOne("advertisers", advertiserId);
      if (!advertiser) throw new ActionRefusal("That advertiser is no longer there. Nothing was changed.");
      unwrap(await db().from("campaigns").update({ advertiser_id: advertiser.id }).eq("id", current.id));
      return { summary: `${current.name} now belongs to ${advertiser.company_name}.`, before: { advertiser_id: current.advertiser_id }, after: { advertiser_id: advertiser.id, id: current.id } };
    }
    case "change_campaign_period": {
      const current = await requireCurrent("campaigns", pending.target_id, pending.before_data, ["starts_on", "ends_on"]);
      const starts = day(args.starts_on);
      const ends = day(args.ends_on);
      if (!starts || !ends || ends < starts) throw new ActionRefusal("A valid start and end date are required. Nothing was changed.");
      unwrap(await db().from("campaigns").update({ starts_on: starts, ends_on: ends }).eq("id", current.id));
      return { summary: `The period for ${current.name} is now ${starts} – ${ends}.`, before: { starts_on: current.starts_on, ends_on: current.ends_on }, after: { starts_on: starts, ends_on: ends, id: current.id } };
    }
    case "change_campaign_contact_name": {
      const current = await requireCurrent("campaigns", pending.target_id, pending.before_data, ["contact_name"]);
      const next = text(args.contact_name);
      if (!next) throw new ActionRefusal("A contact name is required. Nothing was changed.");
      unwrap(await db().from("campaigns").update({ contact_name: next }).eq("id", current.id));
      return { summary: `The contact for ${current.name} is now ${next}.`, before: { contact_name: current.contact_name }, after: { contact_name: next, id: current.id } };
    }
    case "change_campaign_contact_phone": {
      const current = await requireCurrent("campaigns", pending.target_id, pending.before_data, ["contact_phone"]);
      const next = text(args.contact_phone);
      if (!next) throw new ActionRefusal("A contact phone number is required. Nothing was changed.");
      unwrap(await db().from("campaigns").update({ contact_phone: next }).eq("id", current.id));
      return { summary: `The contact phone for ${current.name} is now ${next}.`, before: { contact_phone: current.contact_phone }, after: { contact_phone: next, id: current.id } };
    }
    case "change_application_status":
      return updateStatus("campaign_applications", pending, canonical(args.status));
    case "change_application_region": {
      const current = await requireCurrent("campaign_applications", pending.target_id, pending.before_data, ["region_label"]);
      const next = text(args.region);
      if (!next) throw new ActionRefusal("A region is required. Nothing was changed.");
      unwrap(await db().from("campaign_applications").update({ region_label: next }).eq("id", current.id));
      return { summary: `The application region is now ${next}.`, before: { region_label: current.region_label }, after: { region_label: next, id: current.id } };
    }
    case "confirm_cargo_settlement": {
      const current = await requireCurrent("cargo_settlements", pending.target_id, pending.before_data, ["status"]);
      if (current.status !== "before_settlement") throw new ActionRefusal("This settlement is no longer waiting. Nothing was changed.");
      unwrap(await db().from("cargo_settlements").update({ status: "settlement_confirmed" }).eq("id", current.id));
      return { summary: `The settlement is now Settlement confirmed. Final amount remains ${krw(current.final_amount_krw)}.`, before: { status: current.status }, after: { status: "settlement_confirmed", id: current.id } };
    }
    case "update_cargo_settlement_fees":
      return commitFees(pending);
    case "update_cargo_settlement_base":
      return commitSettlementAmount(pending, "base");
    case "update_cargo_settlement_extras":
      return commitSettlementAmount(pending, "extras");
    case "update_cargo_settlement_tax":
      return commitSettlementAmount(pending, "tax");
    case "update_cargo_settlement_net":
      return commitSettlementAmount(pending, "net");
    case "update_cargo_settlement_operation_count":
      return commitSettlementMeasure(pending, "operation_count");
    case "update_cargo_settlement_distance":
      return commitSettlementMeasure(pending, "distance_km");
    case "update_advertiser_settlement_discount": {
      const current = await requireCurrent("advertiser_settlements", pending.target_id, pending.before_data, ["status", "discount_rate"]);
      if (current.status !== "before_payment") throw new ActionRefusal("This bill is no longer waiting for payment. Nothing was changed.");
      const rate = percentInput(pending.args.discount_rate);
      if (rate == null) throw new ActionRefusal("A discount rate from 0 to 100 is required. Nothing was changed.");
      unwrap(await db().from("advertiser_settlements").update({ discount_rate: rate }).eq("id", current.id));
      return { summary: `The discount rate is now ${rate}%.`, before: { discount_rate: current.discount_rate }, after: { discount_rate: rate, id: current.id } };
    }
    case "update_advertiser_settlement_amount": {
      const current = await requireCurrent("advertiser_settlements", pending.target_id, pending.before_data, ["status", "final_amount_krw"]);
      if (current.status !== "before_payment") throw new ActionRefusal("This bill is no longer waiting for payment. Nothing was changed.");
      const amount = moneyInput(pending.args.amount);
      if (amount == null) throw new ActionRefusal("A final payment amount is required. Nothing was changed.");
      unwrap(await db().from("advertiser_settlements").update({ final_amount_krw: amount }).eq("id", current.id));
      return { summary: `The final payment amount is now ${krw(amount)}.`, before: { final_amount_krw: current.final_amount_krw }, after: { final_amount_krw: amount, id: current.id } };
    }
    case "confirm_advertiser_payment": {
      const current = await requireCurrent("advertiser_settlements", pending.target_id, pending.before_data, ["status"]);
      if (current.status !== "before_payment") throw new ActionRefusal("This bill is no longer waiting for payment. Nothing was changed.");
      unwrap(await db().from("advertiser_settlements").update({ status: "payment_confirmed" }).eq("id", current.id));
      return { summary: `Advertiser payment is confirmed for ${krw(current.final_amount_krw)}.`, before: { status: current.status }, after: { status: "payment_confirmed", id: current.id } };
    }
    case "deduct_solo_pay":
      return commitDeduction(pending);
    case "set_solo_pay_linked": {
      const account = await requireCurrent("solo_pay_accounts", pending.target_id, pending.before_data, ["linked"]);
      const linked = booleanValue(pending.args.linked);
      if (linked == null) throw new ActionRefusal("Say whether Solo Pay should be linked. Nothing was changed.");
      unwrap(await db().from("solo_pay_accounts").update({ linked }).eq("id", account.id));
      return { summary: `Solo Pay is now ${linked ? "linked" : "unlinked"}.`, before: { linked: account.linked }, after: { linked, id: account.id } };
    }
    case "set_solo_pay_balance":
      return commitSoloPayBalance(pending);
    case "create_faq":
      return commitPost("faqs", {
        category: canonical(args.category || "others"),
        question: text(args.question),
        answer: text(args.answer),
        exposed: true,
        pinned: false,
      }, "FAQ");
    case "create_notice":
      return commitPost("notices", {
        audience: canonical(args.audience || "both"),
        post_type: "notice",
        title: text(args.title),
        body: text(args.body),
        pinned: false,
      }, "Notice");
    case "change_notice_category": {
      const current = await requireCurrent("notices", pending.target_id, pending.before_data, ["audience"]);
      const audience = canonical(args.audience || args.category);
      if (!["both", "cargo_owner", "advertiser", "landing_page"].includes(audience)) {
        throw new ActionRefusal("That category is not allowed. Nothing was changed.");
      }
      unwrap(await db().from("notices").update({ audience }).eq("id", current.id));
      return { summary: `“${current.title}” is now ${labelize(audience)}.`, before: { audience: current.audience }, after: { audience, id: current.id } };
    }
    case "change_notice_title": {
      const current = await requireCurrent("notices", pending.target_id, pending.before_data, ["title"]);
      const next = text(args.new_title);
      if (!next) throw new ActionRefusal("A notice title is required. Nothing was changed.");
      unwrap(await db().from("notices").update({ title: next }).eq("id", current.id));
      return { summary: `The notice is now titled “${next}”.`, before: { title: current.title }, after: { title: next, id: current.id } };
    }
    case "delete_faq":
      return commitDelete("faqs", pending, "question", "FAQ");
    case "delete_notice":
      return commitDelete("notices", pending, "title", "Notice");
    case "set_faq_pin":
      return commitFlag("faqs", pending, "pinned", "question");
    case "set_faq_exposure":
      return commitFlag("faqs", pending, "exposed", "question");
    case "set_notice_pin":
      return commitFlag("notices", pending, "pinned", "title");
    case "reorder_faqs":
      return commitReorder("faqs", pending, "question");
    case "reorder_notices":
      return commitReorder("notices", pending, "title");
    default:
      throw new ActionRefusal("That action is no longer available. Nothing was changed.");
  }
}

async function commitFees(pending: PendingAction) {
  const current = await requireCurrent("cargo_settlements", pending.target_id, pending.before_data, ["status"]);
  if (current.status !== "before_settlement") throw new ActionRefusal("This settlement can no longer be edited. Nothing was changed.");
  const quantities = feeQuantities(pending.args);
  for (const item of quantities) {
    const unit = item.type === "other" ? 1 : FEE_RATES[item.type];
    const amount = lineAmount(item.type, item.quantity, item.quantity);
    const existing = unwrap<Row | null>(await db().from("cargo_settlement_lines").select("id").eq("settlement_id", current.id).eq("fee_type", item.type).maybeSingle());
    if (existing) {
      unwrap(await db().from("cargo_settlement_lines").update({ quantity: item.quantity, unit_price_krw: unit, amount_krw: amount }).eq("id", existing.id));
    } else {
      unwrap(await db().from("cargo_settlement_lines").insert({ settlement_id: current.id, fee_type: item.type, quantity: item.quantity, unit_price_krw: unit, amount_krw: amount }));
    }
  }
  const lines = unwrap<Row[]>(await db().from("cargo_settlement_lines").select("amount_krw").eq("settlement_id", current.id));
  const additional = lines.reduce((sum: number, line: Row) => sum + Number(line.amount_krw || 0), 0);
  const money = recomputeSettlement(Number(current.base_amount_krw || 0), additional);
  const patch: Row = {
    additional_amount_krw: additional,
    tax_amount_krw: money.taxAmountKrw,
    final_amount_krw: money.finalAmountKrw,
  };
  if ("memo" in pending.args) patch.memo = text(pending.args.memo);
  unwrap(await db().from("cargo_settlements").update(patch).eq("id", current.id));
  return {
    summary: `Fees updated. The final amount is now ${krw(money.finalAmountKrw)}.`,
    before: pending.before_data,
    after: { id: current.id, ...patch },
  };
}

async function commitSettlementMeasure(pending: PendingAction, column: "operation_count" | "distance_km") {
  const current = await requireCurrent("cargo_settlements", pending.target_id, pending.before_data, ["status", column]);
  if (current.status !== "before_settlement") throw new ActionRefusal("This settlement can no longer be edited. Nothing was changed.");
  const distance = column === "distance_km";
  const next = distance ? distanceInput(pending.args.distance_km) : countInput(pending.args.operation_count);
  if (next == null) throw new ActionRefusal(distance ? "A distance in kilometres is required. Nothing was changed." : "An operation count is required. Nothing was changed.");
  unwrap(await db().from("cargo_settlements").update({ [column]: next }).eq("id", current.id));
  const shown = distance ? km(next) : String(next);
  return {
    summary: `The ${distance ? "distance" : "operation count"} is now ${shown}.`,
    before: { [column]: current[column] },
    after: { [column]: next, id: current.id },
  };
}

async function commitSettlementAmount(pending: PendingAction, field: SettlementAmount) {
  const current = await requireCurrent("cargo_settlements", pending.target_id, pending.before_data, ["status", "base_amount_krw", "additional_amount_krw", "tax_amount_krw", "final_amount_krw"]);
  if (current.status !== "before_settlement") throw new ActionRefusal("This settlement can no longer be edited. Nothing was changed.");
  const amount = moneyInput(pending.args.amount);
  if (amount == null) throw new ActionRefusal("A KRW amount is required. Nothing was changed.");
  const next = previewSettlement(current, field, amount);
  const patch = {
    base_amount_krw: next.base,
    additional_amount_krw: next.extras,
    tax_amount_krw: next.tax,
    final_amount_krw: next.net,
  };
  unwrap(await db().from("cargo_settlements").update(patch).eq("id", current.id));
  const label = field === "base" ? "Base" : field === "extras" ? "Extras" : field === "tax" ? "Tax" : "Net";
  return {
    summary: `${label} is now ${krw(amount)}. Tax is ${krw(next.tax)} and the net is ${krw(next.net)}.`,
    before: pending.before_data,
    after: { id: current.id, ...patch },
  };
}

async function commitSoloPayBalance(pending: PendingAction) {
  const account = await requireCurrent("solo_pay_accounts", pending.target_id, pending.before_data, ["balance_krw"]);
  const balance = moneyInput(pending.args.balance);
  if (balance == null) throw new ActionRefusal("A balance in KRW is required. Nothing was changed.");
  const delta = balance - Number(account.balance_krw);
  if (delta === 0) throw new ActionRefusal(`The balance is already ${krw(balance)}. Nothing was changed.`);
  const patch = delta > 0
    ? { balance_krw: balance, total_accumulated_krw: Number(account.total_accumulated_krw) + delta, month_topup_krw: Number(account.month_topup_krw) + delta }
    : { balance_krw: balance, month_deduction_krw: Number(account.month_deduction_krw) + Math.abs(delta) };
  unwrap(await db().from("solo_pay_accounts").update(patch).eq("id", account.id));
  unwrap(await db().from("solo_pay_transactions").insert({
    advertiser_id: account.advertiser_id,
    category: delta > 0 ? "recharge" : "deduction",
    detail: text(pending.args.detail) || (delta > 0 ? "Admin recharge" : "Admin balance adjustment"),
    amount_krw: delta,
  }));
  return { summary: `The Moad money balance is now ${krw(balance)}.`, before: { balance_krw: account.balance_krw }, after: { balance_krw: balance, id: account.id } };
}

async function commitDeduction(pending: PendingAction) {
  const account = await requireCurrent("solo_pay_accounts", pending.target_id, pending.before_data, ["balance_krw", "linked"]);
  const amount = Number(pending.args.amount);
  if (!account.linked) throw new ActionRefusal("Solo Pay is not linked. Nothing was deducted.");
  if (account.balance_krw < amount) throw new ActionRefusal(`The balance is ${krw(account.balance_krw)}. Nothing was deducted.`);
  const balance = account.balance_krw - amount;
  unwrap(await db().from("solo_pay_accounts").update({ balance_krw: balance, month_deduction_krw: account.month_deduction_krw + amount }).eq("id", account.id));
  unwrap(await db().from("solo_pay_transactions").insert({
    advertiser_id: account.advertiser_id,
    category: "deduction",
    detail: text(pending.args.detail) || "Admin deduction",
    amount_krw: -amount,
  }));
  return { summary: `Deducted ${krw(amount)}. The balance is now ${krw(balance)}.`, before: { balance_krw: account.balance_krw }, after: { balance_krw: balance, id: account.id } };
}

async function commitPost(table: string, values: Row, noun: string) {
  const latest = unwrap<Row[]>(await db().from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1));
  const inserted = unwrap<Row>(await db().from(table).insert({ ...values, sort_order: (latest[0]?.sort_order ?? 0) + 1, author_name: "MOAD Admin" }).select("id, question, title").single());
  const label = inserted.question || inserted.title;
  return { summary: `${noun} “${label}” was created.`, before: null, after: inserted };
}

async function commitDelete(table: string, pending: PendingAction, column: "question" | "title", noun: string) {
  const current = await requireCurrent(table, pending.target_id, null, []);
  unwrap(await db().from(table).delete().eq("id", current.id));
  return { summary: `${noun} “${current[column]}” was deleted.`, before: { [column]: current[column] }, after: null };
}

async function commitFlag(table: string, pending: PendingAction, field: "pinned" | "exposed", column: "question" | "title") {
  const current = await requireCurrent(table, pending.target_id, pending.before_data, [field]);
  const value = booleanValue(pending.args[field]);
  if (value == null) throw new ActionRefusal("The requested value was missing. Nothing was changed.");
  unwrap(await db().from(table).update({ [field]: value }).eq("id", current.id));
  const state = field === "pinned" ? (value ? "pinned" : "unpinned") : (value ? "shown" : "hidden");
  return { summary: `“${current[column]}” is now ${state}.`, before: { [field]: current[field] }, after: { [field]: value, id: current.id } };
}

async function commitReorder(table: string, pending: PendingAction, column: "question" | "title") {
  const current = await requireCurrent(table, pending.target_id, pending.before_data, ["sort_order"]);
  const move = text(pending.args.direction);
  const neighborQuery = db().from(table).select("id, sort_order").limit(1);
  const neighbor = unwrap<Row[]>(
    await (move === "up"
      ? neighborQuery.lt("sort_order", current.sort_order).order("sort_order", { ascending: false })
      : neighborQuery.gt("sort_order", current.sort_order).order("sort_order", { ascending: true })),
  );
  if (!neighbor[0]) throw new ActionRefusal(`“${current[column]}” is already at the ${move === "up" ? "top" : "bottom"}. Nothing was changed.`);
  unwrap(await db().from(table).update({ sort_order: neighbor[0].sort_order }).eq("id", current.id));
  unwrap(await db().from(table).update({ sort_order: current.sort_order }).eq("id", neighbor[0].id));
  return { summary: `Moved “${current[column]}” ${move}.`, before: { sort_order: current.sort_order }, after: { sort_order: neighbor[0].sort_order, id: current.id } };
}
