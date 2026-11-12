# MOAD AI Admin Assistant

A full-stack Next.js prototype that lets MOAD administrators run approved campaign and cargo-user operations through natural language. The assistant identifies the correct record, asks for explicit confirmation before any write, and records the outcome in an audit log.

**Target users:** MOAD administrators who manage campaigns and cargo user information  
**Duration:** November 12–18, 2026  
**Status:** Prototype. It uses a synthetic database and does not connect to the MOAD production database or APIs.

The existing admin interface already supports several campaign operations. Whether an additional AI interface is useful will be judged by an actual administrator, using measured prototype usage and recorded task times. No production efficiency gain is assumed in advance.

## Problem

Administrators perform operations such as changing campaign status, stopping a campaign, and updating cargo user information. Those actions currently require navigating separate screens. Incorrect record identification or an accidental update can change operational data.

This prototype tests whether the same approved operations can be requested in natural language, with the server still in control of every database read and write.

## Intent

Demonstrate a working AI-assisted workflow with reliable record identification and controlled database operations.

| Outcome | Target |
| --- | --- |
| Write operations identify a unique record before execution | 100% |
| Write operations require explicit administrator confirmation | 100% |
| Database modifications from ambiguous, cancelled, or refused actions | 0 |
| Confirmation, cancellation, and refusal events written to the audit log | 100% |
| Chat responses match the database result returned by the backend | 100% |

Selected tasks will also be timed on the existing admin interface and on this prototype. Results will be recorded as measurements. Improvement will be claimed only after that testing is done.

## What the prototype supports

The first actions are:

- Change a campaign’s status
- Stop a campaign
- Change a cargo user’s name
- Query and filter counts across campaign and cargo user records

The demo will include **10–15 approved actions** on the same architecture: lookups, filtered counts, and a small set of confirmed writes. New actions are added as predefined server functions. The model selects a function and extracts parameters. It does not invent new database operations.

## How it works

The app is one Next.js project. The UI and the API live together. The browser talks only to this app’s routes. The AI API key and database credentials stay on the server.

```text
Administrator
    │
    ▼
Next.js UI (chat + confirmation)
    │
    ▼
Next.js route handlers
    ├── Interpret the message (AI function calling)
    ├── Run a predefined server function
    ├── Resolve the record (or return every match)
    ├── Store a pending write until it is confirmed
    └── Write the audit event
    │
    ▼
Synthetic database
    │
    ▼
AI turns the server result into the chat reply
```

The model is used for two jobs only.

1. **Understand the request.** Read the message, choose a predefined function, extract parameters such as record ID, name, and status, and ask for anything still missing.
2. **Write the reply.** Take the result the backend actually returned and state success, a refusal, or an error in plain language.

The model does not generate or run SQL, does not see database credentials, and does not modify records.

## Safety

Every database query and modification goes through a predefined server function.

- A name that matches more than one campaign or cargo user returns every match. The administrator picks an ID. A confirmation card appears only after one record is identified.
- Each write is stored as a pending action. It runs only after the administrator confirms it.
- Cancelling or refusing a pending action leaves the stored record unchanged.
- Confirm, cancel, and refusal each create an audit record.
- The chat reply reports the records or update result the server returned.

## Stack

- Next.js (App Router) — UI and server routes in one TypeScript project
- TypeScript
- Ant Design
- Tailwind CSS
- AI API with function calling
- A separate synthetic database of realistic campaign and cargo user records

## Boundaries

- Synthetic data only. The prototype does not call MOAD production databases or APIs.
- Secrets stay in server environment variables and are never shipped to the client.
- If the team later approves it, the same function, confirmation, and audit shape can be pointed at the real MOAD Admin backend.

## Acceptance criteria

- A shared campaign or cargo user name lists every matching record and does not open a confirmation card.
- A write starts only after a unique record ID is identified and the administrator confirms.
- Campaign status changes, campaign stops, and cargo user name changes all use that confirmation flow.
- A cancelled or refused write leaves the stored record unchanged.
- The chat response matches the records or update result returned by the server.
- Confirm, cancel, and refusal each create an audit record.
- The AI API key and database credentials do not appear in frontend code.
- The prototype does not access a production MOAD database or API.
- The demo exposes 10–15 approved actions through the same server functions.

## Deliverables

- This Next.js application (UI and backend)
- Synthetic campaign and cargo user data
- Natural-language interpretation via function calling
- The write actions above, plus query and filtered counts, expanded to 10–15 demo actions
- Duplicate-record handling, confirmation, cancellation, server-side validation, and audit logging
- Test evidence for successful, ambiguous, cancelled, and refused actions
- A short Loom of the full workflow
- The MOAD administrator or team who reviews and tests the prototype, plus any usage feedback that is available
