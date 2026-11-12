# MOAD AI Admin Assistant

A Next.js admin assistant for MOAD campaign, cargo partner, settlement, Solo Pay, FAQ, and notice operations. An administrator asks in plain language. The server runs one of 44 predefined functions against a synthetic Supabase database. The model never writes SQL and never sees the database credentials.

Writes identify one record, then wait for Confirm. Cancel and Refuse leave the row unchanged. Each of those three outcomes is stored in the audit log.

## Stack

- Next.js App Router and TypeScript
- Ant Design and Tailwind CSS
- Supabase, server-side only
- react-hot-toast
- Groq, OpenAI-compatible chat completions

## Sign in

There is no registration. The seed creates one active administrator:

- Name: MOAD Admin
- Username: `moad_ai_assistant`
- Password: `Moad@123`

That administrator can add other admins from the Admins drawer. The form asks for name, phone number, country, username, and password. Deactivated admins cannot sign in. You cannot deactivate yourself or the primary account.

## Setup

1. Create a Supabase project and open the SQL editor.
2. Run `supabase/schema.sql`.
3. Copy `.env.example` to `.env.local` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `AI_API_KEY`.
4. Install and seed:

```bash
npm install
npm run seed
npm run dev
```

Open http://localhost:3000.

The service role key and the AI key stay in `.env.local`. They are not sent to the browser.

## What the assistant can do

23 reads: search and count advertisers, cargo partners, campaigns, applications, settlements, Solo Pay, FAQs, and notices, plus distance totals, operating days, and the settlement summary cards.

21 writes: advertiser and cargo status, cargo name, create and stop a campaign, campaign and recruitment status, application status, settlement confirmation and fees, advertiser payment, Solo Pay deduction, and FAQ or notice create, delete, pin, exposure, and reorder.

A shared name such as Blue Depot, Minho Park, or City Wrap returns every match and does not open a confirmation card.

## Safety

- Synthetic records only. The app does not call the MOAD production database.
- A write is stored as a pending action until Confirm.
- Cancel and Refuse do not modify the business row.
- Confirm, cancel, and refuse each write an audit row. The Activity drawer shows them.
- If the record changes after the card was created, confirm is refused.
