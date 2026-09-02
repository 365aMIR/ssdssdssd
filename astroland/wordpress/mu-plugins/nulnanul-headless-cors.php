<?php
/**
 * Plugin Name: nulnanul — headless CORS for the Store API
 * Description: Allows the Astro storefront to call the WooCommerce Store API
 *              from the browser. Upload to wp-content/mu-plugins/ (must-use
 *              plugins load automatically; there is nothing to activate).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Origins permitted to talk to the Store API.
 *
 * An allow-list, not '*', for two reasons: the cart carries credentials, and
 * the CORS spec forbids pairing a wildcard origin with
 * Access-Control-Allow-Credentials. Add a new storefront domain here.
 */
function nulnanul_allowed_origins() {
	return array(
		'http://localhost:4321',
		'http://127.0.0.1:4321',
		'https://nulnanul.nl',
		'https://www.nulnanul.nl',
	);
}

/**
 * Whether an origin is a dev server on the local network.
 *
 * Needed to test on a phone, where the site is reached by LAN IP rather than
 * localhost, and that address changes whenever DHCP reassigns it.
 *
 * Only a browser can set an Origin header, and only a page actually served
 * from that address carries it — so this cannot be reached from the public
 * internet. Delete this function and its call below once you stop testing
 * against a dev server.
 *
 * @param string $origin Origin header.
 * @return bool
 */
function nulnanul_is_lan_dev_origin( $origin ) {
	// Private ranges only: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
	$pattern = '#^http://(192\.168\.\d{1,3}|10\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3})\.\d{1,3}:\d+$#';

	return 1 === preg_match( $pattern, $origin );
}

/**
 * Emits the CORS headers when the caller is on the allow-list.
 *
 * @return bool Whether the origin was recognised.
 */
function nulnanul_send_cors_headers() {
	$origin = get_http_origin();

	if ( ! $origin ) {
		return false;
	}

	$allowed = in_array( $origin, nulnanul_allowed_origins(), true )
		|| nulnanul_is_lan_dev_origin( $origin );

	if ( ! $allowed ) {
		return false;
	}

	// Echo the caller's origin rather than a wildcard, so credentials are allowed.
	header( 'Access-Control-Allow-Origin: ' . $origin );
	header( 'Access-Control-Allow-Credentials: true' );
	header( 'Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS' );
	header( 'Access-Control-Allow-Headers: Authorization, Content-Type, Nonce, Cart-Token, X-WP-Nonce' );

	// Without exposing these the browser hides them from JS, and Cart-Token is
	// how a guest cart is identified between requests.
	header( 'Access-Control-Expose-Headers: Cart-Token, Nonce, X-WP-Total, X-WP-TotalPages, Link' );

	// Responses differ per origin, so caches must not share them.
	header( 'Vary: Origin' );

	return true;
}

/**
 * Replace WordPress's own CORS handling for REST requests.
 */
add_action(
	'rest_api_init',
	function () {
		remove_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );

		add_filter(
			'rest_pre_serve_request',
			function ( $served ) {
				nulnanul_send_cors_headers();
				return $served;
			}
		);
	},
	15
);

/**
 * Answer the preflight before WordPress routes it.
 *
 * Browsers send OPTIONS ahead of any request carrying a Cart-Token header, and
 * that check has to succeed before the real call is even attempted.
 */
add_action(
	'init',
	function () {
		if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'OPTIONS' !== $_SERVER['REQUEST_METHOD'] ) {
			return;
		}

		if ( nulnanul_send_cors_headers() ) {
			status_header( 200 );
			exit;
		}
	},
	5
);
