import { db } from "@/lib/db";

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

export type ClientLists = {
  advertisers: AdvertiserRow[];
  partners: PartnerRow[];
  applications: ApplicationRow[];
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

function partnerOf(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
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

export async function loadClientLists(): Promise<ClientLists> {
  const [advertisers, partners, applications] = await Promise.all([
    db().from("advertisers").select("id, status, company_name, email, company_phone, contact_name, contact_phone, registered_at").order("registered_at", { ascending: false }),
    db().from("cargo_partners").select("id, member_number, name, phone, vehicle_number, vehicle_type, fixed_operating_location, region_label, status, registered_at").order("registered_at", { ascending: false }),
    db().from("campaign_applications").select("id, status, region_label, applied_at, cargo_partners(member_number, name, phone, vehicle_number, vehicle_type, fixed_operating_location, region_label)").order("applied_at", { ascending: false }),
  ]);

  const failed = [advertisers.error, partners.error, applications.error].find(Boolean);
  if (failed) {
    return { advertisers: [], partners: [], applications: [], error: failed.message };
  }

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
  };
}
