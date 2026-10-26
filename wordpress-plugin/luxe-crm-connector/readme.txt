=== Luxe CRM Connector (optional) ===
Requires at least: 5.6
Requires PHP: 7.4
License: GPLv2 or later

Optional helper for Luxe CRM.

WooCommerce stores: you do NOT need this plugin. Create a WooCommerce REST API key instead
(WooCommerce → Settings → Advanced → REST API).

Non-WooCommerce sites: install this plugin, open Settings → Luxe CRM, choose the post type that
holds your products and the meta keys for SKU / price / stock. Then, in the CRM, choose
"WordPress REST API — custom post type" and authenticate with an Application Password.

The plugin is read-only: it never changes products, orders or stock.
