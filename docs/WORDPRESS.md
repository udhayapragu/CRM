# Connecting your WordPress website

The CRM supports two integration modes. **Test Connection** tells you which applies to your site: it inspects `/wp-json/` and only uses WooCommerce once the `wc/v3` namespace has actually been detected.

| Your site | Mode | Data available |
|---|---|---|
| WordPress + **WooCommerce** | *WooCommerce REST API* (recommended) | Products, variations, website stock, orders, customers, refunds, webhooks |
| WordPress without WooCommerce | *WordPress REST API — custom post type* | Products only (from a post type + meta fields). No orders: core WordPress has none |

Nothing is installed on or written to your website by default. The CRM only issues `GET` requests, except when you explicitly click **Register webhooks automatically**.

---

## A. WooCommerce stores

### 1. Create an API key (WooCommerce → Settings → Advanced → REST API → Add key)

- **Description:** `Luxe CRM`
- **User:** an administrator or shop manager
- **Permissions:**
  - **Read**: recommended. Sync works fully.
  - **Read/Write**: only needed if you want the CRM to create the webhooks for you. The CRM still never modifies products, orders or stock.

Copy the **Consumer key** (`ck_…`) and **Consumer secret** (`cs_…`). WooCommerce shows the secret only once.

### 2. Enter it in the CRM (Settings → WordPress Sync)

1. **Website URL:** `https://www.yourstore.com`. HTTPS is required so credentials are encrypted in transit.
2. **Integration type:** WooCommerce REST API.
3. Paste the key and secret, then click **Save settings**. Both are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY`; only the last four characters are ever shown again.
4. Click **Test connection**. The CRM checks:
   1. the website is reachable and serves the WordPress REST API (it falls back to `?rest_route=` when pretty permalinks are off);
   2. WooCommerce (`wc/v3`) is present;
   3. the key can read products. If your host strips the `Authorization` header, the CRM automatically retries with query-string authentication, which WooCommerce supports over HTTPS;
   4. the key can read orders;
   5. WordPress/WooCommerce versions (optional; needs admin rights).
5. Click **Enable sync & import**. A full initial import runs in the background (products first, then orders), page by page.

### 3. Real-time webhooks (recommended)

Webhooks push changes instantly. The scheduled sync remains as a safety net. Choose one of:

- **Automatic:** click **Register webhooks automatically** (needs a Read/Write key, and `APP_URL` must be a public `https://` address).
- **Manual:** WooCommerce → Settings → Advanced → Webhooks → Add webhook, once per topic:
  - Topics: `order.created`, `order.updated`, `order.deleted`, `product.created`, `product.updated`, `product.deleted`
  - Delivery URL: shown on the CRM page (`https://<your-crm>/api/webhooks/woocommerce/<connection-id>`)
  - Secret: click **Show secret** in the CRM and paste it
  - API version: WP REST API Integration v3

Every delivery is checked against the HMAC-SHA256 signature (`X-WC-Webhook-Signature`). Unsigned or invalid requests are rejected with 401, and repeated deliveries (same `X-WC-Webhook-Delivery-ID`) are ignored.

### 4. Scheduled synchronisation

- Runs every *N* minutes (default 15) via `npm run worker`, or via `POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` from any scheduler.
- **Incremental:** uses WooCommerce's `modified_after` with a 5-minute overlap. The cursor only advances when every record in the run succeeded, so failed records are re-fetched next time.
- **Rate limits:** a 250 ms pause between pages; HTTP 429/5xx and network errors are retried with exponential backoff (honouring `Retry-After`). If a whole job fails, it is re-queued with backoff up to 4 attempts, then marked **Failed**, and a notification is raised.
- **Sync now**, **Products only**, **Orders only** and **Full re-import** buttons are on the same page, and every job's log is viewable there.
- Data is flagged **stale** (banner plus status pill) when the last successful sync is older than three sync intervals.

### What is synchronised, and what is never overwritten

| From the website (overwritten on each sync) | CRM-owned (never touched by sync) |
|---|---|
| Product name, SKU, images, categories, prices, status, *website* stock quantity/status, variations | Physical stock and the entire inventory ledger, reservations |
| Order number, customer & addresses, totals, refunds, payment method, customer note, WooCommerce status | Fulfilment progress (packing, dispatch, delivery), expected dispatch date, internal notes |
| | Low-stock thresholds, consumption rules, onboarding, MLM data |

Website stock and physical stock are shown **side by side**. The CRM never changes your website's stock. If they diverge significantly, a *Stock mismatch* notification is raised.

### Duplicate prevention

- Unique `(connection, external id)` on products and orders, with upserts.
- A per-record PostgreSQL advisory lock serialises concurrent writers (e.g. a webhook and a scheduled sync touching the same order at the same moment).
- Webhook deliveries are de-duplicated by delivery ID, and queued jobs of the same type are not stacked.

### How WooCommerce statuses map to CRM statuses

A WooCommerce status is applied **only when an order is first imported or when its WooCommerce status changes**. A sync that re-reads an unchanged order never resets local progress (e.g. *Ready to Pack*).

| WooCommerce | Order status | Payment status | Notes |
|---|---|---|---|
| `pending` | Pending Payment | Pending | |
| `failed` | Pending Payment | Failed | |
| `processing` | New (awaiting confirmation) | Paid | Later CRM stages are preserved |
| `on-hold` | On Hold | Pending (or Paid) | After dispatch: flagged for attention instead |
| `completed` | Dispatched | Paid | **Never Delivered**: WooCommerce doesn't track delivery. If no CRM shipment exists, the order is flagged: *"Record the shipment so physical stock is deducted"* |
| `cancelled` | Cancelled (reservations released) | unchanged | After dispatch: flagged, a return must be recorded |
| `refunded` | Cancelled | Refunded | After dispatch: flagged |
| `checkout-draft` / `draft` | not imported | | |

Orders are only ever marked **Dispatched** or **Delivered** by the dispatch workflow (an authorised user) or, for *Dispatched* only, by WooCommerce's own `completed` status.

---

## B. WordPress without WooCommerce (products only)

1. Optional: install the companion plugin in `wordpress-plugin/luxe-crm-connector/` (zip the folder, then Plugins → Add New → Upload). In **Settings → Luxe CRM**, choose the post type that holds your products and the meta keys for SKU, price and stock. The plugin exposes those fields to the REST API (read-only) and adds `/wp-json/luxe-crm/v1/status`. If you already expose the fields (e.g. via ACF with "Show in REST"), you don't need the plugin.
2. Create an **Application Password** (Users → Profile → Application Passwords).
3. In the CRM choose **WordPress REST API — custom post type**, then enter the username, application password, post type and meta keys. Save, then test.

---

## Troubleshooting

| Test result | Likely cause / fix |
|---|---|
| *Could not reach the website* | Wrong URL, DNS, or the server firewall blocks the CRM's IP |
| *non-JSON response… security plugin or firewall* | Wordfence, Cloudflare or a host WAF is blocking `/wp-json/`. Allow-list the CRM server's IP or the REST API |
| *WooCommerce REST API (wc/v3) was not found* | WooCommerce is inactive, or REST is disabled by a plugin |
| *Authentication failed* | Wrong key/secret, the key was revoked, or the site is not on HTTPS |
| *Access denied* | The key lacks Read permission, or a firewall returns 403 |
| Jobs stuck in *retry* | The host is rate-limiting. Lower *Records per API page* or increase the sync interval |
