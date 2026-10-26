# Luxe CRM — CRM & Inventory Management for WordPress / WooCommerce

A premium, production-oriented operations suite that connects to an **existing WordPress website** and gives you one dashboard for products, orders, physical stock, bottles/labels/packaging, dispatch, product onboarding, reports and an optional direct-selling module.

- **Next.js 15 (App Router) + TypeScript + Tailwind CSS** — dark/light luxury UI, responsive down to phones
- **PostgreSQL + Prisma** — migrations, DB-level integrity guards
- **WooCommerce REST API** integration (plus a products-only fallback for non-WooCommerce sites), scheduled sync, signed webhooks, retries, logs
- **Auditable inventory ledger** — physical stock is never a free-edited number
- **Session auth + role-based access control**, CSRF protection, encrypted credentials, audit log

> The CRM **only reads** from your website. It never writes products, orders or stock back to WordPress.

---

## Quick start (local development)

Requirements: Node.js ≥ 20.9, PostgreSQL ≥ 14.

```bash
cp .env.example .env
# 1. set DATABASE_URL
# 2. generate an encryption key and paste it into APP_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm install
npm run db:migrate        # apply migrations
npm run db:seed           # reference data only (onboarding stages, default warehouse)
npm run dev               # http://localhost:3000
npm run worker            # (second terminal) scheduled sync, retries, periodic alerts
```

Or with Docker (PostgreSQL + web + worker): `cp .env.example .env`, fill in the secrets, then `docker compose up -d --build`.

### First launch

1. Open the app and you are redirected to **/setup** to create the first **Super Admin** (in production this requires the `SETUP_TOKEN` from your environment).
2. On **Settings → General** choose:
   - **Load demo data** to explore every module with sample data. Demo records are flagged `isDemo`, a gold *DEMO ENVIRONMENT* banner is shown on every page, and each demo row carries a *DEMO* badge.
   - Or go straight to **Settings → WordPress Sync** to connect your site.
3. Demo data must be **cleared before real synchronisation can be enabled** (enforced server-side), so demo and real data can never be mixed.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run worker` | Background worker (scheduled sync, job retries, delayed-shipment & low-stock checks) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create a new migration during development |
| `npm run db:seed` | Seed reference data (no users, no business data) |
| `npm test` | Run the test suite (needs a PostgreSQL test database, see below) |
| `npm run typecheck` / `npm run lint` | Static checks |

## Documentation

- [docs/WORDPRESS.md](docs/WORDPRESS.md) — connecting WordPress/WooCommerce, API keys, webhooks, field mapping, status mapping
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production deployment, environment variables, HTTPS, backups, scaling
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data model, inventory ledger, sync design, security
- [docs/API.md](docs/API.md) — REST API reference
- [docs/TESTING.md](docs/TESTING.md) — how to run tests, latest results, **known limitations**

## Modules at a glance

| Module | Highlights |
|---|---|
| Dashboard | 16 live KPIs, orders vs dispatches, weekly/monthly sales, status distribution, lowest stock, fast movers, low-stock trend rebuilt from the ledger, attention list, activity feed, auto-refresh |
| Products | Synced catalogue with images, categories, prices, variants; physical vs website stock side by side; stock filters; inventory history & related orders |
| Inventory | Products, bottles, labels, caps, boxes, packaging, raw materials, custom; stock in/out, adjustments, damage, returns, transfers between locations, goods received (GRN), suppliers, reorder levels |
| Packaging rules | Explicit bill-of-materials: dispatching 1 unit consumes N of each material — and only where a rule exists |
| Orders | Separate order / payment / shipping statuses, 11 workflow states, visual fulfilment timeline, notes, returns |
| Dispatch | Awaiting packing → ready → awaiting pickup → in transit → delivered, delayed view, courier & tracking, daily dispatch reports |
| Onboarding | Configurable stages (11 defaults), Kanban drag-and-drop + table, tasks, assignees, deadlines, notes, document uploads |
| Direct selling (optional) | Members, referral codes, sponsor tree, sales-only commission rules gated by legal review, approvals, clawbacks, payouts |
| Reports | 12 reports with date range + search, CSV and Excel export, formula-injection safe, PII only for authorised roles |
| Admin | Users & 7 roles, audit log, notifications, WordPress connection & sync logs |
