import { db } from "@/lib/db";
import { km, krw } from "@/lib/labels";

export type AdvertiserRow = {
  id: string;
  status: string;
  companyName: string;
  email: string;
  companyPhone: string;
  contactName: string;
  contactPhone: string;
  registeredOn: string;
  registeredAt: string;
};

export type PartnerRow = {
  id: string;
  memberNumber: string;
  name: string;
  phone: string;
  vehicleNumber: string;
  vehicleType: string;
  fixedLocation: boolean | null;
  region: string;
  status: string;
  registeredOn: string;
  registeredAt: string;
};

export type ApplicationRow = {
  id: string;
  status: string;
  memberNumber: string;
  name: string;
  phone: string;
  vehicleNumber: string;
  vehicleType: string;
  fixedLocation: boolean | null;
  region: string;
  registeredOn: string;
  registeredAt: string;
};

export type CampaignRow = {
  id: string;
  status: string;
  name: string;
  companyName: string;
  period: string;
  contactName: string;
  contactPhone: string;
  vehicles: number;
  recruitment: string;
  appliedAt: string;
  latestReport: string;
};

export type PartnerCampaignRow = {
  id: string;
  status: string;
  memberNumber: string;
  name: string;
  phone: string;
  vehicleNumber: string;
  vehicleType: string;
  adName: string;
  period: string;
  region: string;
  appliedAt: string;
};

export type CargoSettlementRow = {
  id: string;
  status: string;
  memberNumber: string;
  name: string;
  contact: string;
  vehicleType: string;
  operationCount: number;
  distance: string;
  base: string;
  extras: string;
  tax: string;
  net: string;
  month: string;
};

export type AdvertiserSettlementRow = {
  id: string;
  status: string;
  companyName: string;
  campaignName: string;
  period: string;
  type: string;
  discount: string;
  amount: string;
  contactName: string;
  contact: string;
  appliedAt: string;
};

export type SoloRow = {
  id: string;
  companyName: string;
  email: string;
  companyPhone: string;
  ongoing: number;
  linked: boolean;
  balance: string;
  contactName: string;
  contactPhone: string;
  registeredAt: string;
};

export type FaqRow = {
  id: string;
  category: string;
  question: string;
  exposed: boolean;
  registeredAt: string;
  author: string;
};

export type NoticeRow = {
  id: string;
  audience: string;
  title: string;
  registeredAt: string;
  author: string;
};

export type ClientLists = {
  advertisers: AdvertiserRow[];
  partners: PartnerRow[];
  applications: ApplicationRow[];
  campaigns: CampaignRow[];
  partnerCampaigns: PartnerCampaignRow[];
  cargoSettlements: CargoSettlementRow[];
  advertiserSettlements: AdvertiserSettlementRow[];
  solo: SoloRow[];
  faqs: FaqRow[];
  notices: NoticeRow[];
  error: string;
};

function shown(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function day(value: unknown): { on: string; at: string } {
  const raw = typeof value === "string" ? value : "";
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) return { on: "", at: "—" };
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return { on: `${y}-${m}-${d}`, at: `${y}.${m}.${d} ${hh}:${mm}` };
}

function record(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function partnerOf(value: unknown) {
  const row = record(value);
  if (!row) return null;
  return row as {
    member_number?: string;
    name?: string;
    phone?: string | null;
    vehicle_number?: string | null;
    vehicle_type?: string | null;
    fixed_operating_location?: boolean | null;
    region_label?: string | null;
  };
}

function dateOnly(value: unknown) {
  const raw = typeof value === "string" ? value.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  return raw.replaceAll("-", ".");
}

function period(start: unknown, end: unknown) {
  const from = dateOnly(start);
  const to = dateOnly(end);
  if (from === "—" && to === "—") return "—";
  return `${from} ~ ${to}`;
}

function monthLabel(value: unknown) {
  const raw = typeof value === "string" ? value.slice(0, 10) : "";
  const date = new Date(`${raw}T00:00:00`);
  if (!raw || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function money(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? krw(amount) : "—";
}

function percent(value: unknown) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return "—";
  return `${rate}%`;
}

const emptyLists = {
  advertisers: [],
  partners: [],
  applications: [],
  campaigns: [],
  partnerCampaigns: [],
  cargoSettlements: [],
  advertiserSettlements: [],
  solo: [],
  faqs: [],
  notices: [],
};

export async function loadClientLists(): Promise<ClientLists> {
  const [advertisers, partners, applications, campaigns, cargoSettlements, advertiserSettlements, solo, faqs, notices] = await Promise.all([
    db().from("advertisers").select("id, status, company_name, email, company_phone, contact_name, contact_phone, registered_at").order("registered_at", { ascending: false }),
    db().from("cargo_partners").select("id, member_number, name, phone, vehicle_number, vehicle_type, fixed_operating_location, region_label, status, registered_at").order("registered_at", { ascending: false }),
    db().from("campaign_applications").select("id, status, region_label, applied_at, campaign_id, cargo_partners(member_number, name, phone, vehicle_number, vehicle_type, fixed_operating_location, region_label), campaigns(name, starts_on, ends_on)").order("applied_at", { ascending: false }),
    db().from("campaigns").select("id, name, status, starts_on, ends_on, contact_name, contact_phone, recruitment_status, applied_at, advertiser_id, advertisers(company_name)").order("applied_at", { ascending: false }),
    db().from("cargo_settlements").select("id, settlement_month, status, operation_count, distance_km, base_amount_krw, additional_amount_krw, tax_amount_krw, final_amount_krw, cargo_partners(member_number, name, phone, vehicle_type)").order("settlement_month", { ascending: false }),
    db().from("advertiser_settlements").select("id, campaign_id, settlement_month, status, coverage_type, discount_rate, final_amount_krw, campaigns(name, starts_on, ends_on, contact_name, contact_phone, applied_at, advertisers(company_name))").order("settlement_month", { ascending: false }),
    db().from("solo_pay_accounts").select("id, linked, balance_krw, advertisers(id, company_name, email, company_phone, contact_name, contact_phone, registered_at)").order("balance_krw", { ascending: false }),
    db().from("faqs").select("id, category, question, exposed, author_name, created_at").order("sort_order", { ascending: true }),
    db().from("notices").select("id, audience, title, author_name, created_at").order("sort_order", { ascending: true }),
  ]);

  const failed = [advertisers.error, partners.error, applications.error, campaigns.error, cargoSettlements.error, advertiserSettlements.error, solo.error, faqs.error, notices.error].find(Boolean);
  if (failed) return { ...emptyLists, error: failed.message };

  const running = new Set(["operational", "in_progress"]);
  const vehiclesByCampaign = new Map<string, number>();
  for (const row of applications.data ?? []) {
    const campaignId = String((row as { campaign_id?: string }).campaign_id ?? "");
    if (!campaignId || !running.has(String((row as { status?: string }).status ?? ""))) continue;
    vehiclesByCampaign.set(campaignId, (vehiclesByCampaign.get(campaignId) ?? 0) + 1);
  }

  const ongoingStatuses = new Set(["preparing", "recruiting", "in_progress"]);
  const ongoingByAdvertiser = new Map<string, number>();
  const latestByCampaign = new Map<string, string>();
  for (const row of advertiserSettlements.data ?? []) {
    const item = row as Record<string, unknown>;
    latestByCampaign.set(String(item.campaign_id ?? ""), monthLabel(item.settlement_month));
  }

  const campaignRows = (campaigns.data ?? []).map((row: Record<string, unknown>) => {
    const advertiser = record(row.advertisers);
    const advertiserId = String(row.advertiser_id ?? "");
    if (ongoingStatuses.has(String(row.status ?? ""))) {
      ongoingByAdvertiser.set(advertiserId, (ongoingByAdvertiser.get(advertiserId) ?? 0) + 1);
    }
    return {
      id: String(row.id),
      status: String(row.status ?? ""),
      name: shown(row.name),
      companyName: shown(advertiser?.company_name),
      period: period(row.starts_on, row.ends_on),
      contactName: shown(row.contact_name),
      contactPhone: shown(row.contact_phone),
      vehicles: vehiclesByCampaign.get(String(row.id)) ?? 0,
      recruitment: String(row.recruitment_status ?? ""),
      appliedAt: day(row.applied_at).at,
      latestReport: latestByCampaign.get(String(row.id)) ?? "—",
    };
  });

  return {
    error: "",
    advertisers: (advertisers.data ?? []).map((row: Record<string, unknown>) => {
      const when = day(row.registered_at);
      return {
        id: String(row.id),
        status: String(row.status ?? ""),
        companyName: shown(row.company_name),
        email: shown(row.email),
        companyPhone: shown(row.company_phone),
        contactName: shown(row.contact_name),
        contactPhone: shown(row.contact_phone),
        registeredOn: when.on,
        registeredAt: when.at,
      };
    }),
    partners: (partners.data ?? []).map((row: Record<string, unknown>) => {
      const when = day(row.registered_at);
      return {
        id: String(row.id),
        memberNumber: shown(row.member_number),
        name: shown(row.name),
        phone: shown(row.phone),
        vehicleNumber: shown(row.vehicle_number),
        vehicleType: shown(row.vehicle_type),
        fixedLocation: typeof row.fixed_operating_location === "boolean" ? row.fixed_operating_location : null,
        region: shown(row.region_label),
        status: String(row.status ?? ""),
        registeredOn: when.on,
        registeredAt: when.at,
      };
    }),
    applications: (applications.data ?? []).map((row: Record<string, unknown>) => {
      const partner = partnerOf(row.cargo_partners);
      const when = day(row.applied_at);
      return {
        id: String(row.id),
        status: String(row.status ?? ""),
        memberNumber: shown(partner?.member_number),
        name: shown(partner?.name),
        phone: shown(partner?.phone),
        vehicleNumber: shown(partner?.vehicle_number),
        vehicleType: shown(partner?.vehicle_type),
        fixedLocation: typeof partner?.fixed_operating_location === "boolean" ? partner.fixed_operating_location : null,
        region: shown(row.region_label || partner?.region_label),
        registeredOn: when.on,
        registeredAt: when.at,
      };
    }),
    campaigns: campaignRows,
    partnerCampaigns: (applications.data ?? []).map((row: Record<string, unknown>) => {
      const partner = partnerOf(row.cargo_partners);
      const campaign = record(row.campaigns);
      return {
        id: String(row.id),
        status: String(row.status ?? ""),
        memberNumber: shown(partner?.member_number),
        name: shown(partner?.name),
        phone: shown(partner?.phone),
        vehicleNumber: shown(partner?.vehicle_number),
        vehicleType: shown(partner?.vehicle_type),
        adName: shown(campaign?.name),
        period: period(campaign?.starts_on, campaign?.ends_on),
        region: shown(row.region_label || partner?.region_label),
        appliedAt: day(row.applied_at).at,
      };
    }),
    cargoSettlements: (cargoSettlements.data ?? []).map((row: Record<string, unknown>) => {
      const partner = record(row.cargo_partners);
      return {
        id: String(row.id),
        status: String(row.status ?? ""),
        memberNumber: shown(partner?.member_number),
        name: shown(partner?.name),
        contact: shown(partner?.phone),
        vehicleType: shown(partner?.vehicle_type),
        operationCount: Number(row.operation_count ?? 0),
        distance: km(Number(row.distance_km ?? 0)),
        base: money(row.base_amount_krw),
        extras: money(row.additional_amount_krw),
        tax: money(row.tax_amount_krw),
        net: money(row.final_amount_krw),
        month: monthLabel(row.settlement_month),
      };
    }),
    advertiserSettlements: (advertiserSettlements.data ?? []).map((row: Record<string, unknown>) => {
      const campaign = record(row.campaigns);
      const advertiser = record(campaign?.advertisers);
      return {
        id: String(row.id),
        status: String(row.status ?? ""),
        companyName: shown(advertiser?.company_name),
        campaignName: shown(campaign?.name),
        period: period(campaign?.starts_on, campaign?.ends_on),
        type: String(row.coverage_type ?? ""),
        discount: percent(row.discount_rate),
        amount: money(row.final_amount_krw),
        contactName: shown(campaign?.contact_name),
        contact: shown(campaign?.contact_phone),
        appliedAt: day(campaign?.applied_at).at,
      };
    }),
    solo: (solo.data ?? []).map((row: Record<string, unknown>) => {
      const advertiser = record(row.advertisers);
      const when = day(advertiser?.registered_at);
      return {
        id: String(row.id),
        companyName: shown(advertiser?.company_name),
        email: shown(advertiser?.email),
        companyPhone: shown(advertiser?.company_phone),
        ongoing: ongoingByAdvertiser.get(String(advertiser?.id ?? "")) ?? 0,
        linked: row.linked === true,
        balance: money(row.balance_krw),
        contactName: shown(advertiser?.contact_name),
        contactPhone: shown(advertiser?.contact_phone),
        registeredAt: when.at,
      };
    }),
    faqs: (faqs.data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      category: String(row.category ?? ""),
      question: shown(row.question),
      exposed: row.exposed === true,
      registeredAt: day(row.created_at).at,
      author: shown(row.author_name),
    })),
    notices: (notices.data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      audience: String(row.audience ?? ""),
      title: shown(row.title),
      registeredAt: day(row.created_at).at,
      author: shown(row.author_name),
    })),
  };
}
