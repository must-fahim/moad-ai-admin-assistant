export type GuideQuestion = {
  action: string;
  kind: "read" | "write";
  text: string;
};

export type GuideGroup = {
  id: string;
  title: string;
  summary: string;
  questions: GuideQuestion[];
};

export const GUIDE_GROUPS: GuideGroup[] = [
  {
    id: "advertisers",
    title: "Advertisers",
    summary: "Search or count companies, then change one company status. Statuses: pending approval, approved, rejected, blacklist.",
    questions: [
      { action: "count_advertisers", kind: "read", text: "How many advertisers are approved?" },
      { action: "search_advertisers", kind: "read", text: "List advertisers named Blue Depot" },
      { action: "change_advertiser_status", kind: "write", text: "Set Northline Ads to pending approval" },
    ],
  },
  {
    id: "cargo",
    title: "Cargo partners",
    summary: "Search or count partners by name, member number, status, vehicle, or region. A shared name such as Minho Park returns every match and does not open a confirmation card.",
    questions: [
      { action: "count_cargo_partners", kind: "read", text: "How many cargo partners are approved?" },
      { action: "search_cargo_partners", kind: "read", text: "Find cargo partners named Minho Park" },
      { action: "change_cargo_partner_status", kind: "write", text: "Approve cargo partner Hana Cho" },
      { action: "change_cargo_partner_name", kind: "write", text: "Change the name of member 4321-200-010 to Sora Kim" },
    ],
  },
  {
    id: "campaigns",
    title: "Campaigns",
    summary: "Count or list ads by status, company, recruitment, or coverage. Creating, pausing, stopping, or changing recruitment waits for Confirm. Statuses: under review, preparing, recruiting, in progress, paused, ended, rejected.",
    questions: [
      { action: "count_campaigns", kind: "read", text: "How many campaigns are in progress?" },
      { action: "search_campaigns", kind: "read", text: "List campaigns for Han River Media" },
      { action: "create_campaign", kind: "write", text: "Create a national campaign named Winter Dock for Han River Media from 2026-12-01 to 2027-01-15, recruitment active, contact Nari Seo, phone 010-0000-1001" },
      { action: "change_campaign_status", kind: "write", text: "Pause the Weekend Dock campaign" },
      { action: "stop_campaign", kind: "write", text: "Stop the Harbor Night campaign" },
      { action: "change_recruitment_status", kind: "write", text: "Set Harbor Lights recruitment to inactive" },
    ],
  },
  {
    id: "applications",
    title: "Campaign applications",
    summary: "These are cargo partners applied to a campaign. Statuses: under review, preparing, operational, in progress, ended.",
    questions: [
      { action: "count_applications", kind: "read", text: "How many applications are in progress?" },
      { action: "search_applications", kind: "read", text: "List applications for the Harbor Night campaign" },
      { action: "change_application_status", kind: "write", text: "Set Sora Kim's Harbor Night application to ended" },
    ],
  },
  {
    id: "distance",
    title: "Distance and operating days",
    summary: "Kilometres and days come from the daily distance records. Ask for a campaign, a partner, or a date range.",
    questions: [
      { action: "sum_distance", kind: "read", text: "How many kilometres did Harbor Night record from 2026-11-01 to 2026-11-05?" },
      { action: "count_operation_days", kind: "read", text: "How many operating days does Sora Kim have on Harbor Night?" },
    ],
  },
  {
    id: "cargo-settlements",
    title: "Operating-partner settlements",
    summary: "Month summaries, lists, and counts. Confirming a settlement or changing fees waits for Confirm, and only while the row is still before settlement.",
    questions: [
      { action: "summarize_cargo_settlements", kind: "read", text: "Summarize cargo settlements for 2026-11" },
      { action: "search_cargo_settlements", kind: "read", text: "List cargo settlements that are before settlement in 2026-11" },
      { action: "count_cargo_settlements", kind: "read", text: "How many cargo settlements are settlement confirmed for 2026-11?" },
      { action: "confirm_cargo_settlement", kind: "write", text: "Confirm Sora Kim's November 2026 settlement" },
      { action: "update_cargo_settlement_fees", kind: "write", text: "Set 1 visit and 1 fuel on Hana Cho's November 2026 settlement" },
    ],
  },
  {
    id: "advertiser-settlements",
    title: "Advertiser settlements",
    summary: "Bills by month, campaign, or company. Statuses: before payment, payment confirmed.",
    questions: [
      { action: "summarize_advertiser_settlements", kind: "read", text: "Summarize advertiser settlements for 2026-11" },
      { action: "search_advertiser_settlements", kind: "read", text: "List advertiser bills that are before payment" },
      { action: "count_advertiser_settlements", kind: "read", text: "How many advertiser settlements are payment confirmed?" },
      { action: "confirm_advertiser_payment", kind: "write", text: "Confirm payment for Harbor Night in 2026-11" },
    ],
  },
  {
    id: "solo-pay",
    title: "Solo Pay",
    summary: "Wallet counts, balances, and recharge or deduction history. A deduction needs a linked wallet with enough balance, then Confirm.",
    questions: [
      { action: "count_solo_pay", kind: "read", text: "How many Solo Pay accounts are linked?" },
      { action: "search_solo_pay", kind: "read", text: "List unlinked Solo Pay wallets" },
      { action: "get_solo_pay_history", kind: "read", text: "Show Solo Pay history for Han River Media" },
      { action: "deduct_solo_pay", kind: "write", text: "Deduct 1000 KRW from Han River Media Solo Pay for a test deduction" },
    ],
  },
  {
    id: "faqs",
    title: "FAQ",
    summary: "Categories: use of service, settlement, others. Creating, deleting, pinning, showing, hiding, or reordering waits for Confirm.",
    questions: [
      { action: "count_faqs", kind: "read", text: "How many FAQs are in the settlement category?" },
      { action: "search_faqs", kind: "read", text: "List pinned FAQs" },
      { action: "create_faq", kind: "write", text: "Create an FAQ in Others. Question: Where is the guide? Answer: Open Guide from the assistant." },
      { action: "set_faq_pin", kind: "write", text: "Pin the FAQ How do I link Solo Pay?" },
      { action: "set_faq_exposure", kind: "write", text: "Hide the FAQ What is a cargo partner?" },
      { action: "reorder_faqs", kind: "write", text: "Move the FAQ How does monthly settlement work? down" },
      { action: "delete_faq", kind: "write", text: "Delete the FAQ Draft FAQ hidden from the site" },
    ],
  },
  {
    id: "notices",
    title: "Notices",
    summary: "Audiences: both, cargo owner, advertiser, landing page. Creating, deleting, pinning, or reordering waits for Confirm.",
    questions: [
      { action: "count_notices", kind: "read", text: "How many notices are for cargo owners?" },
      { action: "search_notices", kind: "read", text: "List pinned notices" },
      { action: "create_notice", kind: "write", text: "Create a notice titled December schedule for both audiences. Body: Prototype schedule only." },
      { action: "set_notice_pin", kind: "write", text: "Pin the notice Vehicle document check" },
      { action: "reorder_notices", kind: "write", text: "Move the notice Welcome to MOAD up" },
      { action: "delete_notice", kind: "write", text: "Delete the notice Welcome to MOAD" },
    ],
  },
];

export const GUIDE_QUESTION_COUNT = GUIDE_GROUPS.reduce((total, group) => total + group.questions.length, 0);
