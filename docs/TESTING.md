# Testing, verification results & known limitations

## Running the tests

The suite runs against a **real PostgreSQL database**. The guarantees that matter most (row locks, unique constraints, the ledger trigger, CHECK constraints) live in the database, so they are tested there rather than mocked.

```bash
createdb luxe_crm_test                 # once; the name must contain "test" (a safety check refuses anything else)
export TEST_DATABASE_URL="postgresql://USER:PASS@localhost:5432/luxe_crm_test?schema=public"
npm test                               # applies migrations to the test DB, then runs all suites
```

WordPress/WooCommerce is simulated by an in-memory fake (`tests/fake-woo.ts`) implementing the REST endpoints, pagination headers, Basic and query-string auth, 401/404/429/5xx responses and non-JSON responses.

## Latest results (2026-10-26, Node 22, PostgreSQL 16)

```
✓ tests/sync.test.ts             (17 tests)
✓ tests/dispatch.test.ts         (11 tests)
✓ tests/ledger.test.ts            (9 tests)
✓ tests/mlm.test.ts               (6 tests)
✓ tests/permissions.test.ts      (20 tests)
✓ tests/reports.test.ts           (6 tests)
✓ tests/wordpress-client.test.ts (10 tests)
✓ tests/mappers.test.ts          (11 tests)
✓ tests/serverless.test.ts        (4 tests)   time-boxed sync resume, phased demo, readiness, pooled URLs
Test Files  9 passed (9)
     Tests  94 passed (94)
```

`npm run typecheck` ✔ · `npm run lint` ✔ (0 warnings) · `npm run build` ✔

### Coverage of the requested areas

| Area | Tests (file) |
|---|---|
| WordPress connection failures | unreachable host + retries, timeout, HTML/firewall response, WooCommerce missing, invalid credentials, header-stripping host → query auth, 429 retry then success, persistent 5xx (wordpress-client); failed test → connection `ERROR` (sync) |
| Product synchronisation | multi-page import, variations, idempotent re-sync, CRM thresholds/physical stock never overwritten, removed-at-source flagged not deleted (sync) |
| Duplicate order prevention | double sync, 6 concurrent upserts of one order (webhook + sync race), webhook replay with same delivery ID, queued job de-duplication (sync) |
| Stock calculations | spec example 1000 + 200 − 150 − 10 = 1040, available = on hand − reserved, ledger/cache verification (ledger) |
| Inventory adjustments | reason required, signed adjustments, audit entries, negative stock refused, append-only trigger blocks UPDATE/DELETE, transfers (ledger) |
| Order dispatch | packing moves no stock; dispatch deducts product + packaging rules once; second dispatch rejected; 5 concurrent dispatches → one deduction; atomic rollback on packaging shortfall; delivery confirmation; manual Dispatched/Delivered refused (dispatch) |
| Returns & cancellations | cancel releases reservations and unpacks; cannot cancel after dispatch; restock vs damaged returns; over-return refused (dispatch); website cancel/complete conflicts flagged (sync) |
| Concurrent stock updates | 12 concurrent stock-outs on 100 units → exactly 6 succeed, no duplicate balances; 8 concurrent identical idempotent events → one entry (ledger) |
| Role permissions | full matrix checks, viewer cannot write/see PII, 401 unauthenticated, CSRF header and Origin enforcement, stock/credentials/commission endpoints per role, viewer can preview but not export reports, validation errors don't leak internals (permissions) |
| Reports & exports | CSV quoting and formula-injection neutralisation, Excel round-trip with demo warning sheet, daily sales maths (paid only, net of refunds, date range), low-stock and packaging reports, PII columns per role, MLM report gated (reports) |
| MLM rules | registration never pays, nothing before verified sale, level commissions only under reviewed rules, unreviewed rules pay nothing, returns resize/claw back, disabled module inert (mlm) |

### End-to-end verification in a real browser (production build)

Beyond the unit and integration suites, the production build (`next build && next start`) was driven through the UI with Playwright (Chromium), against a local **fake WooCommerce HTTP server**:

1. Login → clear demo data.
2. Settings → WordPress Sync: save URL, consumer key and secret → **Test connection** (REST API found, WooCommerce 9.3.0 detected, 30 products and 12 orders readable).
3. **Enable sync & import**: background job succeeded (30 products, 12 orders imported).
4. Track physical stock for a synced product (opening 10).
5. Webhook-created order: Confirm → reserved 1 (available 9) → Pack → Dispatch with tracking → **on hand 9, dispatched 1, reserved 0** → Confirm delivery → order *Delivered / Paid / Delivered*, full timeline recorded.
6. Signed webhook accepted (200), bad signature rejected (401), replay ignored (`duplicate: true`).
7. Report CSV export downloaded.

All 24 application pages rendered with HTTP 200 and no browser console errors, in dark and light themes, at 1440 px and 390 px widths (no horizontal overflow).

**Not done:** no test was run against *your* real WordPress site, because no credentials were available. The first real connection test will happen when you enter them on the setup screen. Use **Test connection**: it reports each step individually.

## Known limitations

1. **Not yet tested against a live WooCommerce store.** The integration follows the documented WooCommerce REST API v3 and was verified against a faithful simulator. Real stores can differ (security plugins, custom order statuses, very large catalogues), and the connection test and sync logs are designed to surface this.
2. **Custom WooCommerce order statuses** (from plugins) are imported with their raw status, without changing the CRM status. Map them manually or extend `decideStatusFromWc`.
3. **Quantities are whole numbers.** Track liquids and powders in base units (ml, g).
4. **Physical stock is not pushed back to WooCommerce** (by design: read-only integration). Website and physical stock are compared and mismatches raise notifications.
5. **Rate limiting is in-memory per process.** With multiple web instances, use a shared store (Redis); see DEPLOYMENT.md.
6. **Uploads are stored on local disk.** Use a persistent volume, or swap in S3 for serverless hosting. On Vercel, uploads go to `/tmp` and are **not permanent**.
13. **Vercel Hobby cron runs once a day.** Use webhooks plus an external scheduler (see DEPLOYMENT.md) for frequent scheduled syncs.
7. **Email/WhatsApp notifications are not implemented.** In-app notifications are complete. `.env.example` reserves `SMTP_URL` / `WHATSAPP_WEBHOOK_URL`, but no sender is wired up, because no credentials or provider were specified.
8. **Variations:** physical stock can be tracked per variant, but packaging consumption rules are defined per parent product.
9. **Demo data** back-dates opening stock and orders, but ledger entries for demo dispatches carry the load time, so the demo low-stock trend is flat before that day.
10. **Dependency advisories:** `npm audit` reports transitive advisories in `zod@3`, `uuid` (via exceljs), `postcss` (bundled in Next.js) and `deepmerge-ts` (via Prisma tooling). The fixes require major-version upgrades, so they were not forced. Review and upgrade as part of normal maintenance.
11. **MLM legal compliance** is your responsibility. The software enforces sales-only, reviewed-rule commissions, but a lawyer must review the actual plan for your jurisdiction.
12. **Accessibility:** keyboard navigation, labels, focus rings and a table view for every chart are provided, but no formal WCAG audit was performed.
