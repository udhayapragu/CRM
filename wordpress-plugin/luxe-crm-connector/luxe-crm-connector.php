<?php
/**
 * Plugin Name:       Luxe CRM Connector (optional)
 * Description:       Optional helper for Luxe CRM. Adds a read-only status endpoint and, for sites WITHOUT WooCommerce, exposes chosen product meta fields to the WordPress REST API. WooCommerce stores do not need this plugin.
 * Version:           1.0.0
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * Text Domain:       luxe-crm-connector
 *
 * Safety: this plugin never modifies products, orders, or stock. It only reads and exposes data
 * to authenticated users who have the `manage_options` / `edit_posts` capability.
 */

if (!defined('ABSPATH')) {
    exit;
}

const LUXE_CRM_OPTION = 'luxe_crm_connector';

function luxe_crm_settings() {
    $defaults = ['post_type' => 'product', 'meta_keys' => 'sku,price,stock'];
    return wp_parse_args(get_option(LUXE_CRM_OPTION, []), $defaults);
}

/**
 * GET /wp-json/luxe-crm/v1/status — environment details for the CRM's connection test.
 * Requires an administrator (authenticate with an Application Password).
 */
add_action('rest_api_init', function () {
    register_rest_route('luxe-crm/v1', '/status', [
        'methods'             => 'GET',
        'permission_callback' => function () {
            return current_user_can('manage_options');
        },
        'callback'            => function () {
            global $wp_version;
            return [
                'plugin_version'     => '1.0.0',
                'wordpress_version'  => $wp_version,
                'woocommerce_active' => class_exists('WooCommerce'),
                'woocommerce_version'=> defined('WC_VERSION') ? WC_VERSION : null,
                'pretty_permalinks'  => (bool) get_option('permalink_structure'),
                'https'              => is_ssl(),
                'timezone'           => wp_timezone_string(),
                'exposed_post_type'  => luxe_crm_settings()['post_type'],
            ];
        },
    ]);

    // Expose the configured meta keys on the configured post type (read-only for the CRM).
    $s = luxe_crm_settings();
    $post_type = sanitize_key($s['post_type']);
    foreach (array_filter(array_map('trim', explode(',', $s['meta_keys']))) as $key) {
        register_post_meta($post_type, sanitize_key($key), [
            'type'          => 'string',
            'single'        => true,
            'show_in_rest'  => true,
            'auth_callback' => function () {
                return current_user_can('edit_posts');
            },
        ]);
    }
});

// Settings page: Settings → Luxe CRM
add_action('admin_menu', function () {
    add_options_page('Luxe CRM Connector', 'Luxe CRM', 'manage_options', 'luxe-crm-connector', 'luxe_crm_render_settings');
});

add_action('admin_init', function () {
    register_setting('luxe_crm', LUXE_CRM_OPTION, [
        'sanitize_callback' => function ($in) {
            return [
                'post_type' => sanitize_key($in['post_type'] ?? 'product'),
                'meta_keys' => implode(',', array_filter(array_map('sanitize_key', explode(',', $in['meta_keys'] ?? '')))),
            ];
        },
    ]);
});

function luxe_crm_render_settings() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $s = luxe_crm_settings();
    ?>
    <div class="wrap">
        <h1>Luxe CRM Connector</h1>
        <p><?php echo class_exists('WooCommerce')
            ? esc_html__('WooCommerce is active — the CRM uses the WooCommerce REST API directly. The settings below are only needed for non-WooCommerce catalogues.', 'luxe-crm-connector')
            : esc_html__('WooCommerce is not active. Choose which post type holds your products and which meta keys hold SKU, price and stock.', 'luxe-crm-connector'); ?></p>
        <form method="post" action="options.php">
            <?php settings_fields('luxe_crm'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="luxe_pt">Product post type</label></th>
                    <td><input id="luxe_pt" name="<?php echo esc_attr(LUXE_CRM_OPTION); ?>[post_type]" value="<?php echo esc_attr($s['post_type']); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th scope="row"><label for="luxe_mk">Meta keys to expose</label></th>
                    <td><input id="luxe_mk" name="<?php echo esc_attr(LUXE_CRM_OPTION); ?>[meta_keys]" value="<?php echo esc_attr($s['meta_keys']); ?>" class="regular-text" />
                        <p class="description">Comma-separated, e.g. <code>sku,price,stock</code>. Enter the same keys in the CRM's connection settings.</p></td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}
