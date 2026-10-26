# REST API reference

All endpoints live under `/api`, exchange JSON, and (except where noted) require a session cookie. **Mutating requests (POST/PUT/PATCH/DELETE) must send `x-luxe-csrf: 1`**. Errors are returned as `{ "error": string, "code": string, "details"?: object }` with an appropriate status (400 validation, 401 unauthenticated, 403 forbidden/CSRF, 404, 409 conflict/business rule, 429 rate limited, 500).

Public endpoints: `POST /api/auth/login`, `POST /api/setup` (only while no users exist), `POST /api/webhooks/woocommerce/{connectionId}` (HMAC-signed), `POST /api/cron/tick` (Bearer `CRON_SECRET`).

| Method | Path | Permission |
|---|---|---|
| GET | `/api/audit` | audit:view |
| POST | `/api/auth/login` | public / own auth |
| POST | `/api/auth/logout` | public / own auth |
| POST | `/api/cron/tick` | public / own auth |
| GET | `/api/dashboard` | dashboard:view |
| POST | `/api/demo` | settings:manage |
| DELETE | `/api/demo` | settings:manage |
| GET | `/api/dispatch` | dispatch:view |
| POST | `/api/integration/enable` | integration:manage |
| POST | `/api/integration/jobs/{id}/retry` | integration:manage |
| GET | `/api/integration/jobs/{id}` | integration:view |
| GET | `/api/integration/jobs` | integration:view |
| GET | `/api/integration` | integration:view |
| PUT | `/api/integration` | integration:manage |
| POST | `/api/integration/sync` | integration:manage |
| POST | `/api/integration/test` | integration:manage |
| POST | `/api/integration/webhooks` | integration:manage |
| GET | `/api/inventory/items/{id}` | inventory:view |
| PATCH | `/api/inventory/items/{id}` | inventory:manage |
| GET | `/api/inventory/items/{id}/verify` | inventory:view |
| POST | `/api/inventory/items/{id}/verify` | inventory:manage |
| GET | `/api/inventory/items` | inventory:view |
| POST | `/api/inventory/items` | inventory:manage |
| GET | `/api/inventory/locations` | inventory:view |
| POST | `/api/inventory/locations` | inventory:manage |
| GET | `/api/inventory/movements` | inventory:view |
| POST | `/api/inventory/movements` | inventory:adjust |
| GET | `/api/inventory/receipts` | inventory:view |
| POST | `/api/inventory/receipts` | inventory:adjust |
| DELETE | `/api/inventory/rules/{id}` | inventory:manage |
| GET | `/api/inventory/rules` | inventory:view |
| POST | `/api/inventory/rules` | inventory:manage |
| POST | `/api/inventory/transfers` | inventory:adjust |
| POST | `/api/me/password` | signed-in user |
| GET | `/api/me` | signed-in user |
| GET | `/api/mlm/commissions` | mlm:view |
| POST | `/api/mlm/commissions` | mlm:approve |
| GET | `/api/mlm/members/{id}` | mlm:view |
| PATCH | `/api/mlm/members/{id}` | mlm:manage |
| GET | `/api/mlm/members` | mlm:view |
| POST | `/api/mlm/members` | mlm:manage |
| GET | `/api/mlm/payouts` | mlm:view |
| POST | `/api/mlm/payouts` | mlm:pay |
| POST | `/api/mlm/recalculate` | mlm:manage |
| PATCH | `/api/mlm/rules/{id}` | mlm:manage |
| GET | `/api/mlm/rules` | mlm:view |
| POST | `/api/mlm/rules` | mlm:manage |
| POST | `/api/notifications/read` | notifications:view |
| GET | `/api/notifications` | notifications:view |
| POST | `/api/onboarding/{id}/comments` | onboarding:manage |
| POST | `/api/onboarding/{id}/documents` | onboarding:manage |
| GET | `/api/onboarding/{id}` | onboarding:view |
| PATCH | `/api/onboarding/{id}` | onboarding:manage |
| POST | `/api/onboarding/{id}/tasks` | onboarding:manage |
| GET | `/api/onboarding/documents/{docId}` | onboarding:view |
| DELETE | `/api/onboarding/documents/{docId}` | onboarding:manage |
| GET | `/api/onboarding` | onboarding:view |
| POST | `/api/onboarding` | onboarding:manage |
| PATCH | `/api/onboarding/stages/{id}` | settings:manage |
| POST | `/api/onboarding/stages` | settings:manage |
| PATCH | `/api/onboarding/tasks/{taskId}` | onboarding:manage |
| DELETE | `/api/onboarding/tasks/{taskId}` | onboarding:manage |
| POST | `/api/orders/{id}/member` | mlm:manage |
| POST | `/api/orders/{id}/notes` | orders:view |
| POST | `/api/orders/{id}/pack` | dispatch:manage |
| POST | `/api/orders/{id}/payment` | orders:edit |
| POST | `/api/orders/{id}/resolve` | orders:edit |
| POST | `/api/orders/{id}/return` | [orders:edit, inventory:adjust] |
| GET | `/api/orders/{id}` | orders:view |
| PATCH | `/api/orders/{id}` | orders:edit |
| POST | `/api/orders/{id}/status` | orders:edit |
| GET | `/api/orders` | orders:view |
| GET | `/api/products/{id}` | products:view |
| PATCH | `/api/products/{id}` | products:edit |
| POST | `/api/products/{id}/track` | inventory:manage |
| GET | `/api/products` | products:view |
| GET | `/api/reports/{key}` | reports:view |
| GET | `/api/reports` | reports:view |
| GET | `/api/settings` | signed-in user |
| PATCH | `/api/settings` | settings:manage |
| POST | `/api/setup` | public / own auth |
| POST | `/api/shipments/{id}/cancel` | dispatch:manage |
| POST | `/api/shipments/{id}/deliver` | dispatch:manage |
| POST | `/api/shipments/{id}/dispatch` | dispatch:manage |
| POST | `/api/shipments/{id}/pickup` | dispatch:manage |
| PATCH | `/api/suppliers/{id}` | inventory:manage |
| GET | `/api/suppliers` | inventory:view |
| POST | `/api/suppliers` | inventory:manage |
| PATCH | `/api/users/{id}` | users:manage |
| GET | `/api/users` | users:manage |
| POST | `/api/users` | users:manage |
| POST | `/api/webhooks/woocommerce/{connectionId}` | public / own auth |

## Examples

```bash
# Record a stock-in (cookie from a browser session)
curl -X POST https://crm.example.com/api/inventory/movements \
  -H 'content-type: application/json' -H 'x-luxe-csrf: 1' -b 'luxe_session=…' \
  -d '{"itemId":"…","kind":"STOCK_IN","quantity":200,"reason":"Supplier delivery INV-1182"}'

# Export a report as Excel
curl -b 'luxe_session=…' -o dispatched.xlsx 'https://crm.example.com/api/reports/dispatched?format=xlsx&from=2026-10-01&to=2026-10-26'

# Trigger the scheduler (external cron)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.com/api/cron/tick
```

Report keys: `daily-sales`, `monthly-sales`, `product-inventory`, `packaging-inventory`, `stock-movements`, `pending-dispatch`, `dispatched`, `delivered-returned`, `low-stock`, `onboarding-progress`, `supplier-purchases`, `mlm-commissions`. Query: `format=json|csv|xlsx`, `from`, `to` (YYYY-MM-DD), `q`.
