const ALIASES: Record<string, string> = {
  "pending approval": "pending_approval",
  pending: "pending_approval",
  approved: "approved",
  rejected: "rejected",
  reject: "rejected",
  blacklist: "blacklist",
  blacklisted: "blacklist",
  blocked: "blacklist",
  block: "blacklist",
  "under review": "under_review",
  preparing: "preparing",
  recruiting: "recruiting",
  operational: "operational",
  "in progress": "in_progress",
  paused: "paused",
  pause: "paused",
  ended: "ended",
  stopped: "ended",
  stop: "ended",
  active: "active",
  inactive: "inactive",
  "before settlement": "before_settlement",
  "settlement confirmed": "settlement_confirmed",
  "before payment": "before_payment",
  "payment confirmed": "payment_confirmed",
  national: "national",
  regional: "regional",
  "use of service": "use_of_service",
  settlement: "settlement",
  others: "others",
  both: "both",
  "cargo owner": "cargo_owner",
  advertiser: "advertiser",
  "landing page": "landing_page",
  recharge: "recharge",
  deduction: "deduction",
  notice: "notice",
};

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function canonical(value: unknown): string {
  const raw = text(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return ALIASES[raw] ?? raw.replace(/ /g, "_");
}

export function labelize(value: unknown): string {
  const raw = text(value);
  if (!raw) return "—";
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

export function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const raw = text(value).toLowerCase();
  if (["true", "yes", "y", "1", "pin", "pinned", "show", "shown", "expose", "exposed", "link", "linked"].includes(raw)) {
    return true;
  }
  if (["false", "no", "n", "0", "unpin", "unpinned", "hide", "hidden", "unlink", "unlinked"].includes(raw)) {
    return false;
  }
  return null;
}

export function like(value: string): string {
  return `%${value.replace(/[%_\\]/g, "")}%`;
}

export function monthStart(value: unknown): string | null {
  const match = text(value).match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01`;
}

export function day(value: unknown): string | null {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function krw(value: number): string {
  return `${new Intl.NumberFormat("en-US").format(value)} KRW`;
}

export function km(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} km`;
}
