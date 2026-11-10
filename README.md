# Arshith Group Finance ERP

Multi-company financial management for **ArshithFresh**, **ArshithInfotech** and **Codelekho** — double-entry ledger, GST-aware invoicing, payables/receivables, cash & bank, budgets, payroll, 15 exportable reports, role-based access, and an append-only audit log. UI follows the Dasher (Bootstrap 5) reference theme.

Full explanation of how everything works: [`docs/Arshith-ERP-How-It-Works.pdf`](docs/Arshith-ERP-How-It-Works.pdf)

| Layer | Stack |
|-------|-------|
| UI | Next.js 15 · React 19 · TypeScript · Dasher theme (Bootstrap 5 + SCSS) · ApexCharts |
| API | Next.js route handlers (`app/api/[[...path]]` → `lib/api.ts` router) |
| DB | PostgreSQL 14+ (numeric money, constraints, triggers, row level security) |
| Exports | ExcelJS · PDFKit · CSV |

## Quick start (Windows)

```bash
npm install
# local PostgreSQL cluster on port 5434 (first time only)
initdb -D .pgdata -U postgres --auth=trust -E UTF8
pg_ctl -D .pgdata -o "-p 5434" -l .pgdata/server.log start
createdb -h localhost -p 5434 -U postgres erp

cp .env.example .env.local          # edit DATABASE_URL / SESSION_SECRET
npm run db:migrate                  # schema, triggers, RLS
npm run db:seed                     # 3 companies, users, ~1 year of demo activity
npm run dev -- -p 3100              # http://localhost:3100
```

`npm run db:reset` drops everything and re-seeds (development only).

### Demo logins (seed)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@arshith.test | Admin@12345 |
| Company Admin (ArshithFresh) | fresh.admin@arshith.test | Demo@12345 |
| Accountant (Infotech + Codelekho) | accountant@arshith.test | Demo@12345 |
| Viewer (Infotech) | viewer@arshith.test | Demo@12345 |

Seeded company details (GSTIN, address, bank) are **sample values** — edit in *Settings → Company profile*. Change every password and `SESSION_SECRET` before real use.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run verify` | Accounting integrity suite (ledger balance, statements, scenarios, RLS isolation) — 68 checks |
| `npm run e2e` | HTTP end-to-end suite against the running server (`BASE=http://localhost:3100`) — auth, roles, approvals, exports, uploads, periods, backup |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` / `npm run start` | Production build / server |
| `npm run guide` | Regenerates the PDF guide |

## Configuration (`.env.local`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection (owner role; the app switches to `erp_app` per request) |
| `SESSION_SECRET` | Reserved for signing; use a long random string |
| `UPLOAD_DIR`, `BACKUP_DIR` | Receipt storage / `pg_dump` output (default `./storage/...`) |
| `SMTP_*` | **Not implemented/configured** — password-reset links are logged to the server console |

## What is deliberately *not* included

GST return filing / GST portal and e-invoice integration, SMTP e-mail delivery, bank-feed import, stock quantities, multi-currency, statutory payroll computation, Supabase (no credentials were supplied; auth/storage are self-hosted). See section 11 of the PDF.

## Accounting rules in one paragraph

Every posting goes through `lib/ledger.ts → post()` and creates balanced journal lines. Reports and the dashboard read only the ledger. Posted records are never edited or deleted: corrections are reversal entries. Transfers between own accounts, capital and loans never affect profit; an invoice is revenue once and its payments only move Receivable to Bank.
