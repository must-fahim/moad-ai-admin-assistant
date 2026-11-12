import { writeAudit } from "@/lib/audit";
import { db, unwrap, type Row } from "@/lib/db";
import { booleanValue, canonical, day, krw, labelize, like, monthStart, text } from "@/lib/labels";
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
    summary: `${rows.length} ${noun} match. Choose one record. I will not open a confirmation until the choice is unique.`,
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
      return oneOf(ctx, "change_advertiser_status", args, found, "advertiser", advertiserCard, (row) =>
        queue(ctx, {
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
        }),
      );
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
      return oneOf(ctx, "change_cargo_partner_status", args, found, "cargo partner", cargoCard, (row) =>
        queue(ctx, {
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
        }),
      );
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
      return oneOf(ctx, "change_campaign_status", args, found, "campaign", campaignCard, (row) =>
        queue(ctx, {
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
        }),
      );
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
      return oneOf(ctx, "change_recruitment_status", args, found, "campaign", campaignCard, (row) =>
        queue(ctx, {
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
        }),
      );
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
      return oneOf(ctx, "change_application_status", args, found, "application", applicationCard, (row) =>
        queue(ctx, {
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
        }),
      );
    },
  },
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
  return {
    kind: "write",
    description: title,
    args: `${column} or id, ${field}`,
    async run(args, ctx) {
      const flag = booleanValue(args[field] ?? args.value ?? args.state);
      if (flag == null) return ask(field === "pinned" ? "Should I pin it or unpin it?" : "Should I show it or hide it?");
      const found = await findPosts(table, args, column);
      return oneOf(ctx, action, args, found, noun, (row) => ({ label: String(row[column]), detail: labelize(row.category || row.audience) }), (row) =>
        queue(ctx, {
          action,
          args: { ...args, [field]: flag },
          targetType: noun,
          targetId: row.id,
          title,
          summary: `Set ${field} on “${row[column]}” to ${flag ? "yes" : "no"} after you confirm.`,
          before: { [field]: row[field] },
          lines: detailLines([
            ["Post", row[column]],
            ["Current", row[field] ? "Yes" : "No"],
            ["New", flag ? "Yes" : "No"],
          ]),
        }),
      );
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
  unwrap(await db().from(table).update({ status: nextStatus }).eq("id", current.id));
  return {
    summary: `${labelOf(current)} is now ${labelize(nextStatus)}.`,
    before: { status: current.status },
    after: { status: nextStatus, id: current.id },
  };
}

function labelOf(row: Row) {
  return row.company_name || row.name || row.member_number || row.title || row.question || "The record";
}

export async function commitAction(pending: PendingAction) {
  const args = pending.args || {};
  switch (pending.action_name) {
    case "change_advertiser_status":
      return updateStatus("advertisers", pending, canonical(args.status));
    case "change_cargo_partner_status":
      return updateStatus("cargo_partners", pending, canonical(args.status));
    case "change_cargo_partner_name": {
      const current = await requireCurrent("cargo_partners", pending.target_id, pending.before_data, ["name"]);
      const newName = text(args.new_name);
      unwrap(await db().from("cargo_partners").update({ name: newName }).eq("id", current.id));
      return { summary: `${current.member_number} is now named ${newName}.`, before: { name: current.name }, after: { name: newName, id: current.id } };
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
      unwrap(await db().from("campaigns").update({ recruitment_status: recruitment }).eq("id", current.id));
      return { summary: `Recruitment for ${current.name} is now ${labelize(recruitment)}.`, before: { recruitment_status: current.recruitment_status }, after: { recruitment_status: recruitment, id: current.id } };
    }
    case "change_application_status":
      return updateStatus("campaign_applications", pending, canonical(args.status));
    case "confirm_cargo_settlement": {
      const current = await requireCurrent("cargo_settlements", pending.target_id, pending.before_data, ["status"]);
      if (current.status !== "before_settlement") throw new ActionRefusal("This settlement is no longer waiting. Nothing was changed.");
      unwrap(await db().from("cargo_settlements").update({ status: "settlement_confirmed" }).eq("id", current.id));
      return { summary: `The settlement is now Settlement confirmed. Final amount remains ${krw(current.final_amount_krw)}.`, before: { status: current.status }, after: { status: "settlement_confirmed", id: current.id } };
    }
    case "update_cargo_settlement_fees":
      return commitFees(pending);
    case "confirm_advertiser_payment": {
      const current = await requireCurrent("advertiser_settlements", pending.target_id, pending.before_data, ["status"]);
      if (current.status !== "before_payment") throw new ActionRefusal("This bill is no longer waiting for payment. Nothing was changed.");
      unwrap(await db().from("advertiser_settlements").update({ status: "payment_confirmed" }).eq("id", current.id));
      return { summary: `Advertiser payment is confirmed for ${krw(current.final_amount_krw)}.`, before: { status: current.status }, after: { status: "payment_confirmed", id: current.id } };
    }
    case "deduct_solo_pay":
      return commitDeduction(pending);
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
  return { summary: `${current[column]} is now ${value ? "on" : "off"} for ${field}.`, before: { [field]: current[field] }, after: { [field]: value, id: current.id } };
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
