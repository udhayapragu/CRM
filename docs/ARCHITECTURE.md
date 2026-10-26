# Architecture

```
┌──────────────┐  HTTPS (read-only GET)   ┌──────────────────────────────────────────────┐
│ WordPress /  │◀────────────────────────│  Luxe CRM (Next.js, Node.js)                  │
│ WooCommerce  │  signed webhooks ──────▶│                                              │
└──────────────┘                          │  app/(app)/*      Server-rendered dashboard  │
                                          │  app/api/*        REST API (RBAC, CSRF, Zod) │
                                          │  server/services  Domain services            │
                                          │  server/integrations/wordpress               │
                                          │     client · adapters · mappers · sync       │
                                          │     webhooks · job-runner                    │
                                          └───────────────┬──────────────────────────────┘
                                                          │ Prisma
                       scripts/worker.ts ────────────────▶│ PostgreSQL
                       (or POST /api/cron/tick)           │ (ledger trigger, CHECK constraints)
```

## Source layout

| Path | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations` | Data model and migrations (incl. the ledger immutability trigger and CHECK constraints) |
| `src/lib/auth/*` | Password hashing (bcrypt, cost 12), DB-backed sessions, the role → permission matrix |
| `src/lib/api.ts` | Route wrapper: authentication, permissions, CSRF, error mapping (never leaks internals) |
| `src/lib/crypto.ts` | AES-256-GCM secret encryption, hashing, constant-time compare |
| `src/lib/validation.ts` | Zod schemas for every mutating endpoint |
| `src/server/services/inventory-ledger.ts` | **The only code that changes physical stock** |
| `src/server/services/inventory-ops.ts` | Items, movements, transfers, goods received, suppliers, consumption rules |
| `src/server/services/orders.ts`, `dispatch.ts` | Order state machine, reservations, pack → dispatch → deliver, returns |
| `src/server/services/onboarding.ts` | Configurable stages, tasks, notes, documents |
| `src/server/services/mlm.ts` | Optional direct-selling module (isolated; hooks via `mlm-hooks.ts`) |
| `src/server/services/dashboard.ts`, `reports.ts`, `queries.ts` | Read models, KPIs, charts, exports |
| `src/server/services/notifications.ts`, `periodic-checks.ts` | In-app notifications, scheduled alerts |
| `src/server/integrations/wordpress/*` | HTTP client, WooCommerce and post-type adapters, mappers, sync, webhooks, job queue |
| `src/components/*` | UI kit, layout shell, charts, feature components |
| `scripts/worker.ts` | Background worker |
| `wordpress-plugin/` | Optional companion plugin for non-WooCommerce sites |

## Data ownership & provenance

Every business record carries `source` (`WORDPRESS` | `MANUAL` | `DEMO`) and `isDemo`. Fields that come from the website are prefixed or grouped (`wpStockQuantity`, `wcStatus`, `externalUpdatedAt`, `syncedAt`) and are read-only in the UI. The UI labels them **Synced**, **Manual** or **DEMO**, and shows *web* next to any number that comes from website stock rather than the physical ledger.

## Inventory ledger

```
onHand    = opening + received − consumed − dispatched + returned − damaged ± adjustments (± transfers)
available = onHand − active reservations
```

- `InventoryLedgerEntry` is **append-only**. A PostgreSQL trigger rejects `UPDATE`, and rejects `DELETE` except for demo rows. Corrections are made with new entries.
- Each entry stores type, signed quantity, `balanceAfter`, reason (required), reference, user and timestamp.
- `postLedgerEntry` locks the item row (`SELECT … FOR UPDATE`), checks the idempotency key, refuses to go below zero at the location, inserts the entry and updates the cached totals, all in one transaction.
- Cached totals on `InventoryItem` / `StockLevel` exist only for speed. **Verify against ledger** on any item recomputes them from the ledger and can rebuild them.
- **Idempotency keys** (`shipment:<id>:dispatch:<line>:<item>`, `grn:<id>:<line>`, `return:<id>:<line>:in`, …) make retried business events no-ops. Together with the row lock and the `dispatchedQty ≤ packedQty ≤ quantity` CHECK constraint, stock cannot be deducted twice.

### Product ↔ packaging link

Products and packaging are **linked only through explicit `ConsumptionRule`s** (product, material, quantity per unit). On dispatch the product's `DISPATCH` entry and every rule's `CONSUMPTION` entry are posted in the same transaction. If any material is short, the whole dispatch rolls back.

## Order lifecycle

Three independent dimensions: **order status** (11 workflow states), **payment status** and **shipping status**.

```
NEW / PENDING_PAYMENT ─▶ CONFIRMED ─▶ PROCESSING ─▶ READY_TO_PACK ─(pack)▶ READY_TO_DISPATCH ─(dispatch)▶ DISPATCHED ─(confirm delivery)▶ DELIVERED
        └──────────── ON_HOLD / CANCELLED (manual, before dispatch) ────────────┘                     └──(return)▶ RETURNED
```

- Manual transitions are whitelisted (`MANUAL_TRANSITIONS`). Dispatched, Delivered and Returned can only be reached through their workflows.
- Stock is **reserved** when an order is confirmed (or new and paid), released on cancellation, and consumed at dispatch.

## Synchronisation

- **Adapters** implement `SourceAdapter` (`test`, `listProducts`, `listVariations`, `listOrders`, `registerWebhooks`).
- **Mappers** are pure functions (WooCommerce JSON → normalised records, WooCommerce status → CRM statuses) and are unit-tested.
- **Upserts** are wrapped in a transaction with `pg_advisory_xact_lock(hashtext('order:<conn>:<id>'))`.
- **Jobs** (`SyncJob`) are durable: claimed with `SKIP LOCKED`, one running job per connection, retried with exponential backoff for retryable errors, recovered after 30 minutes if a worker dies, and fully logged (`SyncLog`).

## Security

| Concern | Implementation |
|---|---|
| Authentication | bcrypt (cost 12); random 256-bit session tokens stored as SHA-256 hashes; `HttpOnly`, `SameSite=Lax`, `Secure` cookies; 12 h expiry; sessions revoked on role change, deactivation or password reset |
| Brute force | 10 login attempts / 15 min per IP; account lock for 15 min after 5 failures; constant-time response for unknown emails |
| Authorization | Permission checks in every API route (`apiRoute({ permission })`) and every page (`requirePageUser`); PII redacted server-side for roles without `orders:view_pii` |
| CSRF | SameSite cookies, required custom header `x-luxe-csrf` on mutations, Origin host check |
| Injection | Prisma parameterised queries; raw SQL uses tagged templates only; Zod validation on all inputs; React escaping; spreadsheet formula-injection neutralised in exports |
| Secrets | WordPress credentials AES-256-GCM encrypted, masked in the UI, never sent to the browser |
| Webhooks | HMAC-SHA256 signature verification with constant-time compare; replay de-duplication |
| SSRF | WordPress URL must be `https://`; private/internal addresses refused in production |
| Uploads | MIME allow-list, size limit, random storage keys, served as attachments with `nosniff` |
| Headers | HSTS (production), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Audit | `AuditLog` for stock changes, order and status changes, credential changes, exports, approvals, sign-ins |

## MLM module guard-rails

The module is off by default and separate from inventory and sync. Commissions are computed only from verified sales (paid, and delivered by default) attributed to ACTIVE members, under rules that are `active` **and** `legallyReviewed`; the API refuses to activate an unreviewed rule. Returns, refunds and cancellations resize or void pending commissions, or create negative clawback entries after payout. There is no code path that pays for recruitment, registration or activation.
