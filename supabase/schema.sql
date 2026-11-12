-- MOAD Admin Assistant synthetic schema.
-- Run this in the Supabase SQL editor, then run `npm run seed`.
-- The service role is the only client. Row level security stays on with no anon policies.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  country text,
  username text not null unique,
  password_hash text not null,
  is_active boolean not null default true,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.advertisers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  email text not null unique,
  company_phone text,
  contact_name text,
  contact_phone text,
  business_registration_no text,
  status text not null check (status in ('pending_approval', 'approved', 'rejected', 'blacklist')),
  registered_at timestamptz not null default now()
);

create table if not exists public.cargo_partners (
  id uuid primary key default gen_random_uuid(),
  member_number text not null unique,
  name text not null,
  phone text,
  vehicle_number text,
  vehicle_type text,
  fixed_operating_location boolean,
  region_label text,
  status text not null check (status in ('under_review', 'approved', 'rejected', 'blacklist')),
  registered_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id),
  name text not null,
  status text not null check (status in ('under_review', 'preparing', 'recruiting', 'in_progress', 'paused', 'ended', 'rejected')),
  starts_on date not null,
  ends_on date not null,
  contact_name text,
  contact_phone text,
  recruitment_status text not null check (recruitment_status in ('active', 'inactive')),
  coverage_type text not null check (coverage_type in ('national', 'regional')),
  applied_at timestamptz not null default now()
);

create table if not exists public.campaign_applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  cargo_partner_id uuid not null references public.cargo_partners (id),
  status text not null check (status in ('under_review', 'preparing', 'operational', 'in_progress', 'ended')),
  region_label text,
  applied_at timestamptz not null default now(),
  unique (campaign_id, cargo_partner_id)
);

create table if not exists public.daily_distances (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  cargo_partner_id uuid not null references public.cargo_partners (id),
  service_date date not null,
  distance_km numeric not null default 0,
  unique (campaign_id, cargo_partner_id, service_date)
);

create table if not exists public.cargo_settlements (
  id uuid primary key default gen_random_uuid(),
  cargo_partner_id uuid not null references public.cargo_partners (id),
  settlement_month date not null,
  status text not null check (status in ('before_settlement', 'settlement_confirmed')),
  operation_count integer not null default 0,
  distance_km numeric not null default 0,
  prorated_days integer not null default 0,
  daily_cap_km numeric not null default 0,
  base_amount_krw integer not null default 0,
  additional_amount_krw integer not null default 0,
  tax_amount_krw integer not null default 0,
  final_amount_krw integer not null default 0,
  memo text,
  unique (cargo_partner_id, settlement_month)
);

create table if not exists public.cargo_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.cargo_settlements (id) on delete cascade,
  fee_type text not null check (fee_type in ('visit', 'detachment', 'event', 'introduce', 'fuel', 'interview', 'other')),
  quantity integer,
  unit_price_krw integer not null default 0,
  amount_krw integer not null default 0
);

create table if not exists public.advertiser_settlements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  settlement_month date not null,
  status text not null check (status in ('before_payment', 'payment_confirmed')),
  coverage_type text not null check (coverage_type in ('national', 'regional')),
  discount_rate numeric not null default 0,
  final_amount_krw integer not null default 0,
  unique (campaign_id, settlement_month)
);

create table if not exists public.solo_pay_accounts (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null unique references public.advertisers (id) on delete cascade,
  linked boolean not null default false,
  balance_krw integer not null default 0,
  total_accumulated_krw integer not null default 0,
  month_topup_krw integer not null default 0,
  month_deduction_krw integer not null default 0
);

create table if not exists public.solo_pay_transactions (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  category text not null check (category in ('recharge', 'deduction')),
  detail text not null,
  amount_krw integer not null
);

create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('use_of_service', 'settlement', 'others')),
  question text not null,
  answer text not null default '',
  exposed boolean not null default true,
  pinned boolean not null default false,
  sort_order integer not null default 0,
  author_name text not null default 'MOAD Admin',
  created_at timestamptz not null default now()
);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('both', 'cargo_owner', 'advertiser', 'landing_page')),
  post_type text not null default 'notice',
  title text not null,
  body text not null default '',
  pinned boolean not null default false,
  sort_order integer not null default 0,
  author_name text not null default 'MOAD Admin',
  created_at timestamptz not null default now()
);

create table if not exists public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_users (id),
  action_name text not null,
  args jsonb not null,
  target_type text not null,
  target_id uuid,
  summary text not null,
  before_data jsonb,
  status text not null check (status in ('pending', 'confirmed', 'cancelled', 'refused')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admin_users (id),
  pending_action_id uuid references public.pending_actions (id),
  event text not null check (event in ('confirm', 'cancel', 'refuse')),
  action_name text not null,
  target_type text,
  target_id uuid,
  summary text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists advertisers_status_idx on public.advertisers (status);
create index if not exists advertisers_company_idx on public.advertisers (company_name);
create index if not exists cargo_partners_name_idx on public.cargo_partners (name);
create index if not exists cargo_partners_status_idx on public.cargo_partners (status);
create index if not exists campaigns_status_idx on public.campaigns (status);
create index if not exists campaigns_name_idx on public.campaigns (name);
create index if not exists chat_messages_admin_idx on public.chat_messages (admin_id, created_at);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'admin_users',
    'advertisers',
    'cargo_partners',
    'campaigns',
    'campaign_applications',
    'daily_distances',
    'cargo_settlements',
    'cargo_settlement_lines',
    'advertiser_settlements',
    'solo_pay_accounts',
    'solo_pay_transactions',
    'faqs',
    'notices',
    'pending_actions',
    'audit_logs',
    'chat_messages'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end $$;
