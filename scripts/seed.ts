import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import ws from "ws";

function loadEnv() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

const advertisers = [
  ["11111111-1111-4111-8111-111111111111", "Han River Media", "hello@hanriver.example", "02-000-1000", "Nari Seo", "010-0000-1001", "100-00-10001", "approved"],
  ["22222222-2222-4222-8222-222222222222", "Blue Depot", "seoul@bluedepot.example", "02-000-2000", "Jisoo Park", "010-0000-2001", "200-00-20001", "approved"],
  ["33333333-3333-4333-8333-333333333333", "Blue Depot", "busan@bluedepot.example", "051-000-3000", "Mina Cho", "010-0000-3001", "300-00-30001", "pending_approval"],
  ["44444444-4444-4444-8444-444444444444", "Northline Ads", "team@northline.example", "02-000-4000", "Owen Blake", "010-0000-4001", "400-00-40001", "rejected"],
  ["55555555-5555-4555-8555-555555555555", "Paper Kite", "ads@paperkite.example", "02-000-5000", "Hana Cho", "010-0000-5001", "500-00-50001", "blacklist"],
  ["11111111-1111-4111-8111-111111111116", "Morning Paper", "hello@morningpaper.example", "02-000-6000", "Sora Lee", "010-0000-6001", "600-00-60001", "pending_approval"],
  ["11111111-1111-4111-8111-111111111117", "Seoul Lights Co", "ads@seoullights.example", "02-000-7000", "Mina Kang", "010-0000-7001", "700-00-70001", "pending_approval"],
  ["11111111-1111-4111-8111-111111111118", "Busan Harbor Ads", "team@busanharbor.example", "051-000-8000", "Joon Park", "010-0000-8001", "800-00-80001", "pending_approval"],
  ["11111111-1111-4111-8111-111111111119", "Mapo Studio", "hello@mapostudio.example", "02-000-9000", "Hana Yoon", "010-0000-9001", "900-00-90001", "pending_approval"],
  ["11111111-1111-4111-8111-11111111111a", "Night Owl Media", "ads@nightowl.example", "02-000-1100", "Rin Cho", "010-0000-1101", "110-00-11001", "blacklist"],
  ["11111111-1111-4111-8111-11111111111b", "Grey Market Co", "team@greymarket.example", "02-000-1200", "Sofia Han", "010-0000-1201", "120-00-12001", "blacklist"],
  ["11111111-1111-4111-8111-11111111111c", "Closed Banner", "hello@closedbanner.example", "02-000-1300", "Jae Min", "010-0000-1301", "130-00-13001", "blacklist"],
  ["11111111-1111-4111-8111-11111111111d", "Old Pier Ads", "ads@oldpier.example", "051-000-1400", "Elena Cho", "010-0000-1401", "140-00-14001", "blacklist"],
] as const;

const partners = [
  ["66666666-6666-4666-8666-666666666661", "4321-100-001", "Minho Park", "010-1000-0001", "서울01가1001", "Top / Large", true, "Seoul > Gangnam-gu", "approved"],
  ["66666666-6666-4666-8666-666666666662", "4321-100-002", "Minho Park", "010-1000-0002", "서울02가1002", "Top / Medium", false, "Seoul > Gangbuk-gu", "approved"],
  ["66666666-6666-4666-8666-666666666663", "4321-200-010", "Sora Kim", "010-2000-0010", "부산10나2010", "Top / Extra Large", true, "Busan > All", "approved"],
  ["66666666-6666-4666-8666-666666666664", "4321-200-011", "Hana Cho", "010-2000-0011", "경기11다2011", "Cargo / Large", false, "Gyeonggi > Seongnam-si", "under_review"],
  ["66666666-6666-4666-8666-666666666665", "4321-300-020", "Deniz Aksoy", "010-3000-0020", "서울20라3020", "Top / Small", true, "Seoul > Mapo-gu", "rejected"],
  ["66666666-6666-4666-8666-666666666666", "4321-300-021", "Owen Blake", "010-3000-0021", "인천21마3021", "Cargo / Extra Small", false, "Incheon > All", "blacklist"],
  ["66666666-6666-4666-8666-666666666667", "4321-400-030", "Aera Moon", "010-4000-0030", null, null, false, "Seoul > Jongno-gu", "approved"],
  ["66666666-6666-4666-8666-666666666668", "4321-400-031", "Bora Lee", "010-4000-0031", null, null, true, "Busan > Haeundae-gu", "approved"],
  ["66666666-6666-4666-8666-666666666669", "4321-400-032", "Kenji Sato", "010-4000-0032", null, null, false, "Incheon > Jung-gu", "under_review"],
  ["66666666-6666-4666-8666-66666666666a", "4321-400-033", "Yuna Choi", "010-4000-0033", null, null, true, "Gyeonggi > Suwon-si", "approved"],
  ["66666666-6666-4666-8666-66666666666b", "4321-400-034", "Noah Kim", "010-4000-0034", null, null, false, "Seoul > Yongsan-gu", "approved"],
  ["66666666-6666-4666-8666-66666666666c", "4321-500-040", "Rin Park", "010-5000-0040", "서울40바5040", "Top / Large", true, "Seoul > Songpa-gu", "blacklist"],
  ["66666666-6666-4666-8666-66666666666d", "4321-500-041", "Sofia Han", "010-5000-0041", "부산41사5041", "Top / Small", false, "Busan > All", "blacklist"],
  ["66666666-6666-4666-8666-66666666666e", "4321-500-042", "Jae Min", "010-5000-0042", "인천42아5042", "Cargo / Large", true, "Incheon > All", "blacklist"],
  ["66666666-6666-4666-8666-66666666666f", "4321-500-043", "Elena Cho", "010-5000-0043", "경기43자5043", "Top / Medium", false, "Gyeonggi > Seongnam-si", "blacklist"],
] as const;

const campaigns = [
  ["77777777-7777-4777-8777-777777777771", "11111111-1111-4111-8111-111111111111", "Harbor Night", "in_progress", "2026-11-01", "2026-12-15", "Nari Seo", "010-0000-1001", "active", "national"],
  ["77777777-7777-4777-8777-777777777772", "22222222-2222-4222-8222-222222222222", "City Wrap", "recruiting", "2026-11-12", "2027-01-12", "Jisoo Park", "010-0000-2001", "active", "regional"],
  ["77777777-7777-4777-8777-777777777773", "33333333-3333-4333-8333-333333333333", "City Wrap", "preparing", "2026-11-20", "2026-12-20", "Mina Cho", "010-0000-3001", "inactive", "regional"],
  ["77777777-7777-4777-8777-777777777774", "11111111-1111-4111-8111-111111111111", "Weekend Dock", "paused", "2026-10-01", "2026-12-01", "Nari Seo", "010-0000-1001", "inactive", "national"],
  ["77777777-7777-4777-8777-777777777775", "22222222-2222-4222-8222-222222222222", "River Archive", "ended", "2026-06-01", "2026-08-31", "Jisoo Park", "010-0000-2001", "inactive", "national"],
  ["77777777-7777-4777-8777-777777777776", "11111111-1111-4111-8111-111111111111", "Night Market", "under_review", "2026-12-01", "2027-01-31", "Nari Seo", "010-0000-1001", "active", "regional"],
  ["77777777-7777-4777-8777-777777777777", "11111111-1111-4111-8111-111111111111", "Harbor Lights", "in_progress", "2026-11-05", "2026-12-31", "Nari Seo", "010-0000-1001", "active", "national"],
  ["77777777-7777-4777-8777-777777777778", "55555555-5555-4555-8555-555555555555", "School Run", "rejected", "2026-09-01", "2026-10-01", "Hana Cho", "010-0000-5001", "inactive", "regional"],
  ["77777777-7777-4777-8777-777777777779", "22222222-2222-4222-8222-222222222222", "Depot Weekly", "ended", "2026-04-01", "2026-06-30", "Jisoo Park", "010-0000-2001", "inactive", "national"],
  ["77777777-7777-4777-8777-77777777777a", "33333333-3333-4333-8333-333333333333", "Busan Intro", "recruiting", "2026-11-18", "2027-02-01", "Mina Cho", "010-0000-3001", "active", "regional"],
] as const;

const applications = [
  ["88888888-8888-4888-8888-888888888881", "77777777-7777-4777-8777-777777777771", "66666666-6666-4666-8666-666666666661", "in_progress", "Seoul > Gangnam-gu"],
  ["88888888-8888-4888-8888-888888888882", "77777777-7777-4777-8777-777777777771", "66666666-6666-4666-8666-666666666663", "operational", "Busan > All"],
  ["88888888-8888-4888-8888-888888888883", "77777777-7777-4777-8777-777777777772", "66666666-6666-4666-8666-666666666662", "under_review", "Seoul > Gangbuk-gu"],
  ["88888888-8888-4888-8888-888888888884", "77777777-7777-4777-8777-777777777776", "66666666-6666-4666-8666-666666666664", "under_review", "Gyeonggi > Seongnam-si"],
  ["88888888-8888-4888-8888-888888888885", "77777777-7777-4777-8777-777777777774", "66666666-6666-4666-8666-666666666663", "preparing", "Busan > All"],
  ["88888888-8888-4888-8888-888888888886", "77777777-7777-4777-8777-777777777777", "66666666-6666-4666-8666-666666666667", "under_review", "Seoul > Jongno-gu"],
  ["88888888-8888-4888-8888-888888888887", "77777777-7777-4777-8777-777777777777", "66666666-6666-4666-8666-666666666668", "under_review", "Busan > Haeundae-gu"],
  ["88888888-8888-4888-8888-888888888888", "77777777-7777-4777-8777-77777777777a", "66666666-6666-4666-8666-666666666669", "under_review", "Incheon > Jung-gu"],
] as const;

const settlements = [
  ["99999999-9999-4999-8999-999999999991", "66666666-6666-4666-8666-666666666663", "2026-11-01", "before_settlement", 18, 246, 28, 40, 180000, 110000, 9570, 280430, "November route notes"],
  ["99999999-9999-4999-8999-999999999992", "66666666-6666-4666-8666-666666666661", "2026-11-01", "settlement_confirmed", 12, 160, 28, 40, 120000, 0, 3960, 116040, ""],
  ["99999999-9999-4999-8999-999999999993", "66666666-6666-4666-8666-666666666664", "2026-11-01", "before_settlement", 4, 36, 10, 40, 20000, 20000, 1320, 38680, ""],
] as const;

async function must<T>(label: string, result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function seed(supabase: SupabaseClient) {
  const passwordHash = await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD || "Moad@123", 10);
  await must("admin", await supabase.from("admin_users").upsert({
    name: process.env.BOOTSTRAP_ADMIN_NAME || "MOAD Admin",
    phone: process.env.BOOTSTRAP_ADMIN_PHONE || "+82 10-0000-0000",
    country: process.env.BOOTSTRAP_ADMIN_COUNTRY || "South Korea",
    username: (process.env.BOOTSTRAP_ADMIN_USERNAME || "moad_ai_assistant").toLowerCase(),
    password_hash: passwordHash,
    is_active: true,
    is_primary: true,
  }, { onConflict: "username" }));

  await must("advertisers", await supabase.from("advertisers").upsert(advertisers.map((row) => ({
    id: row[0], company_name: row[1], email: row[2], company_phone: row[3], contact_name: row[4], contact_phone: row[5], business_registration_no: row[6], status: row[7],
  })), { onConflict: "id" }));

  await must("partners", await supabase.from("cargo_partners").upsert(partners.map((row) => ({
    id: row[0], member_number: row[1], name: row[2], phone: row[3], vehicle_number: row[4], vehicle_type: row[5], fixed_operating_location: row[6], region_label: row[7], status: row[8],
  })), { onConflict: "id" }));

  await must("campaigns", await supabase.from("campaigns").upsert(campaigns.map((row) => ({
    id: row[0], advertiser_id: row[1], name: row[2], status: row[3], starts_on: row[4], ends_on: row[5], contact_name: row[6], contact_phone: row[7], recruitment_status: row[8], coverage_type: row[9],
  })), { onConflict: "id" }));

  await must("applications", await supabase.from("campaign_applications").upsert(applications.map((row) => ({
    id: row[0], campaign_id: row[1], cargo_partner_id: row[2], status: row[3], region_label: row[4],
  })), { onConflict: "id" }));

  const distances = [];
  const harbor = "77777777-7777-4777-8777-777777777771";
  const sora = "66666666-6666-4666-8666-666666666663";
  const minho = "66666666-6666-4666-8666-666666666661";
  for (let day = 1; day <= 5; day += 1) {
    const date = `2026-11-${String(day).padStart(2, "0")}`;
    distances.push({ campaign_id: harbor, cargo_partner_id: sora, service_date: date, distance_km: 40 + day });
    distances.push({ campaign_id: harbor, cargo_partner_id: minho, service_date: date, distance_km: day === 3 ? 0 : 22 });
  }
  await must("distances", await supabase.from("daily_distances").upsert(distances, { onConflict: "campaign_id,cargo_partner_id,service_date" }));

  await must("settlements", await supabase.from("cargo_settlements").upsert(settlements.map((row) => ({
    id: row[0], cargo_partner_id: row[1], settlement_month: row[2], status: row[3], operation_count: row[4], distance_km: row[5], prorated_days: row[6], daily_cap_km: row[7], base_amount_krw: row[8], additional_amount_krw: row[9], tax_amount_krw: row[10], final_amount_krw: row[11], memo: row[12],
  })), { onConflict: "id" }));

  await must("clear lines", await supabase.from("cargo_settlement_lines").delete().in("settlement_id", settlements.map((row) => row[0])));
  await must("lines", await supabase.from("cargo_settlement_lines").insert([
    { settlement_id: settlements[0][0], fee_type: "visit", quantity: 1, unit_price_krw: 90000, amount_krw: 90000 },
    { settlement_id: settlements[0][0], fee_type: "fuel", quantity: 1, unit_price_krw: 20000, amount_krw: 20000 },
    { settlement_id: settlements[2][0], fee_type: "introduce", quantity: 1, unit_price_krw: 20000, amount_krw: 20000 },
  ]));

  await must("advertiser settlements", await supabase.from("advertiser_settlements").upsert([
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", campaign_id: campaigns[0][0], settlement_month: "2026-11-01", status: "before_payment", coverage_type: "national", discount_rate: 0, final_amount_krw: 1200000 },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", campaign_id: campaigns[1][0], settlement_month: "2026-11-01", status: "payment_confirmed", coverage_type: "regional", discount_rate: 10, final_amount_krw: 800000 },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", campaign_id: campaigns[3][0], settlement_month: "2026-11-01", status: "before_payment", coverage_type: "national", discount_rate: 0, final_amount_krw: 450000 },
  ], { onConflict: "id" }));

  await must("solo", await supabase.from("solo_pay_accounts").upsert([
    { advertiser_id: advertisers[0][0], linked: true, balance_krw: 25804, total_accumulated_krw: 69269, month_topup_krw: 12000, month_deduction_krw: 4000 },
    { advertiser_id: advertisers[1][0], linked: false, balance_krw: 0, total_accumulated_krw: 0, month_topup_krw: 0, month_deduction_krw: 0 },
    { advertiser_id: advertisers[2][0], linked: true, balance_krw: 10000, total_accumulated_krw: 10000, month_topup_krw: 10000, month_deduction_krw: 0 },
  ], { onConflict: "advertiser_id" }));

  await must("clear transactions", await supabase.from("solo_pay_transactions").delete().eq("advertiser_id", advertisers[0][0]));
  await must("transactions", await supabase.from("solo_pay_transactions").insert([
    { advertiser_id: advertisers[0][0], category: "recharge", detail: "SUT recharge", amount_krw: 10000, occurred_at: "2026-11-02T09:00:00Z" },
    { advertiser_id: advertisers[0][0], category: "recharge", detail: "SUT recharge bonus (20%)", amount_krw: 2000, occurred_at: "2026-11-02T09:00:01Z" },
    { advertiser_id: advertisers[0][0], category: "deduction", detail: "November campaign deduction", amount_krw: -4000, occurred_at: "2026-11-08T03:00:00Z" },
  ]));

  await must("faqs", await supabase.from("faqs").upsert([
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", category: "settlement", question: "How does monthly settlement work?", answer: "Operating partner settlements move from before settlement to settlement confirmed.", exposed: true, pinned: true, sort_order: 1, author_name: "MOAD Admin" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", category: "use_of_service", question: "How do I link Solo Pay?", answer: "Solo Pay linkage is stored on the advertiser wallet.", exposed: true, pinned: false, sort_order: 2, author_name: "MOAD Admin" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", category: "others", question: "What is a cargo partner?", answer: "A cargo partner drives the campaign vehicle.", exposed: true, pinned: false, sort_order: 3, author_name: "MOAD Admin" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", category: "others", question: "Draft FAQ hidden from the site", answer: "This post is not exposed.", exposed: false, pinned: false, sort_order: 4, author_name: "MOAD Admin" },
  ], { onConflict: "id" }));

  await must("notices", await supabase.from("notices").upsert([
    { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", audience: "both", post_type: "notice", title: "November maintenance window", body: "The assistant uses synthetic data during the prototype.", pinned: true, sort_order: 1, author_name: "MOAD Admin" },
    { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", audience: "cargo_owner", post_type: "notice", title: "Vehicle document check", body: "Check vehicle numbers before a campaign starts.", pinned: false, sort_order: 2, author_name: "MOAD Admin" },
    { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3", audience: "advertiser", post_type: "notice", title: "November billing reminder", body: "Advertiser bills stay before payment until confirmed.", pinned: false, sort_order: 3, author_name: "MOAD Admin" },
    { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4", audience: "landing_page", post_type: "notice", title: "Welcome to MOAD", body: "Public landing notice.", pinned: false, sort_order: 4, author_name: "MOAD Admin" },
  ], { onConflict: "id" }));
}

loadEnv();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local, run supabase/schema.sql, then npm run seed.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws as never },
});
seed(supabase)
  .then(() => console.log("Seeded the MOAD admin database."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
