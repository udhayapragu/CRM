# Production deployment

## 1. What you need

- A Linux server or container platform that can run **Node.js 22** with a long-lived process (VPS, Docker host, Render, Railway, Fly.io, AWS ECS…)
- **PostgreSQL 14+** (managed recommended: Neon, Supabase, RDS, Cloud SQL…) with automated backups
- A domain with **HTTPS** (Caddy, nginx + Let's Encrypt, or your platform's TLS)
- A persistent disk or volume for onboarding document uploads (`UPLOAD_DIR`)

## 2. Environment variables

Copy `.env.example` to `.env` (never commit it). Set:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string. Use `?sslmode=require` for managed databases |
| `APP_URL` | ✅ | Public `https://` URL of the CRM. Used for webhook URLs and origin checks |
| `APP_ENCRYPTION_KEY` | ✅ | 32 random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Back it up**: losing it makes stored WordPress credentials unreadable (re-enter them) |
| `SETUP_TOKEN` | ✅ (first run) | Long random string, required to create the first Super Admin at `/setup` in production. Remove or rotate it afterwards |
| `CRON_SECRET` | if using external cron | Bearer token for `POST /api/cron/tick` |
| `TZ` | recommended | Business timezone for "today" metrics, e.g. `Asia/Kolkata` |
| `SESSION_TTL_HOURS` | optional | Default 12 |
| `UPLOAD_DIR`, `UPLOAD_MAX_MB` | optional | Default `./uploads`, 15 MB |
| `ALLOW_INSECURE_WORDPRESS_HTTP` | keep `false` | Only for local testing against `http://` sites |
| `WORKER_POLL_SECONDS` | optional | Default 30 |

## 3. Option A: Docker Compose (single server)

```bash
git clone <your repo> luxe-crm && cd luxe-crm
cp .env.example .env && nano .env          # fill the values above
docker compose up -d --build               # db + web (runs migrations on start) + worker
docker compose logs -f web worker
```

Put a TLS reverse proxy in front of port 3000, for example a `Caddyfile`:

```
crm.yourcompany.com {
  reverse_proxy localhost:3000
}
```

## 4. Option B: Node process manager (VPS)

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run build
# keep both processes alive, e.g. with pm2 or systemd:
pm2 start "npm start" --name luxe-web
pm2 start "npm run worker" --name luxe-worker
pm2 save
```

## 5. Option C: Serverless (e.g. Vercel) + managed Postgres

The web app runs on serverless platforms, but there is no long-lived worker. Instead:

- Schedule `POST https://<crm>/api/cron/tick` every 5 minutes with header `Authorization: Bearer $CRON_SECRET` (Vercel Cron, GitHub Actions, cron-job.org…).
- Use a connection-pooling `DATABASE_URL` (PgBouncer / Neon pooled URL).
- **Uploads:** serverless filesystems are ephemeral. Mount object storage, or replace `saveDocument`/`readDocument` in `src/server/services/onboarding.ts` with an S3-compatible client.
- The in-memory rate limiter is per instance (see limitations).

## 6. After deployment

1. Visit `https://<crm>/setup`, enter your `SETUP_TOKEN`, and create the Super Admin.
2. Settings → General: set business name, currency and dispatch SLA.
3. Settings → WordPress Sync: connect your site (see [WORDPRESS.md](WORDPRESS.md)).
4. Settings → Users & Roles: invite your team with least-privilege roles.
5. Start tracking physical stock: on each product page, **Track physical stock** with today's shelf count. Add packaging items under Inventory → New item, then define Packaging Rules.

## 7. Security checklist

- [x] HTTPS only. `Strict-Transport-Security` is sent in production, and session cookies are `Secure`, `HttpOnly` and `SameSite=Lax`
- [x] `APP_ENCRYPTION_KEY`, `SETUP_TOKEN`, `CRON_SECRET` are stored in a secret manager, not in git
- [x] Database is not publicly reachable; separate DB user with least privileges
- [x] Daily database backups with restore tested; back up `UPLOAD_DIR`
- [x] Use a **Read-only** WooCommerce key unless you need automatic webhook registration
- [x] Keep dependencies patched (`npm audit`, Dependabot)
- [x] Review the audit log periodically (Settings → Audit Log)

## 8. Scaling notes

- Run **one** worker. Multiple workers are safe (jobs are claimed with `FOR UPDATE SKIP LOCKED`) but unnecessary.
- Multiple web instances work; replace the in-memory login rate limiter (`src/lib/rate-limit.ts`) with a Redis-backed limiter so limits are shared.
- The inventory ledger table grows indefinitely by design (it is the audit trail). It is indexed by item and date. Archive to cold storage only if you have millions of rows.

## 9. Upgrades

```bash
git pull && npm ci && npm run db:migrate && npm run build && pm2 restart all
```

Migrations are additive and run in order. Always back up the database before upgrading.
