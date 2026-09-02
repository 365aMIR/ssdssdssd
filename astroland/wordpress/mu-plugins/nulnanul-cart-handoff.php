<?php
/**
 * Plugin Name: nulnanul — Store API cart handoff
 * Description: Adopts a Store API cart when the storefront sends a shopper to
 *              checkout. Upload to wp-content/mu-plugins/ alongside the CORS
 *              plugin. Nothing to activate.
 *
 * Why this is needed: the Store API cart and the frontend cart are different
 * stores. The API cart lives in the woocommerce_sessions table keyed by the
 * Cart-Token's `user_id`, while checkout reads the wp_woocommerce_session_*
 * cookie. Arriving from another domain there is no such cookie, so checkout
 * looks empty even though the cart exists. This reads the token, sets the
 * cookie for that session, and lets WooCommerce load it as normal.
 *
 * A token is deliberately used rather than a shared cookie: third-party
 * cookies between nulnanul.nl and loeihard.site are blocked outright by Safari,
 * so a cookie-based bridge would fail for most phone traffic.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Pulls the WooCommerce session id out of a Store API cart token.
 *
 * @param string $token Raw JWT.
 * @return string|null Session id, or null when the token is unusable.
 */
function nulnanul_session_id_from_token( $token ) {
	$parts = explode( '.', $token );
	if ( 3 !== count( $parts ) ) {
		return null;
	}

	// Verify with WooCommerce's own validator when it is available, so a forged
	// token cannot be used to adopt an arbitrary session.
	$validator = '\Automattic\WooCommerce\StoreApi\Utilities\JsonWebToken';
	if ( class_exists( $validator ) && method_exists( $validator, 'validate' ) ) {
		if ( ! $validator::validate( $token, '@' . wp_salt() ) ) {
			return null;
		}
	}

	$payload = json_decode(
		base64_decode( strtr( $parts[1], '-_', '+/' ) ), // phpcs:ignore
		true
	);

	if ( empty( $payload['user_id'] ) ) {
		return null;
	}

	// Expired tokens must not resurrect a stale cart
	if ( ! empty( $payload['exp'] ) && time() > (int) $payload['exp'] ) {
		return null;
	}

	return (string) $payload['user_id'];
}

add_action(
	'template_redirect',
	function () {
		if ( empty( $_GET['cart-token'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}

		if ( ! function_exists( 'WC' ) || ! WC()->session ) {
			return;
		}

		$token      = sanitize_text_field( wp_unslash( $_GET['cart-token'] ) ); // phpcs:ignore WordPress.Security.NonceVerification
		$session_id = nulnanul_session_id_from_token( $token );

		if ( ! $session_id ) {
			return;
		}

		// Point the live session handler at the Store API's session, then let
		// WooCommerce write its own cookie — going through its method rather
		// than hand-rolling the cookie format keeps this correct across
		// WooCommerce versions.
		$session    = WC()->session;
		$reflection = new ReflectionObject( $session );

		if ( ! $reflection->hasProperty( '_customer_id' ) ) {
			return;
		}

		$property = $reflection->getProperty( '_customer_id' );
		$property->setAccessible( true );
		$property->setValue( $session, $session_id );

		$session->set_customer_session_cookie( true );

		// Redirect so the next request reads the cookie and loads the cart
		wp_safe_redirect( wc_get_checkout_url() );
		exit;
	},
	1
);
