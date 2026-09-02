# WordPress-side files

These are not part of the Astro build. They belong on the WooCommerce install
at `amir.loeihard.site`.

## mu-plugins/nulnanul-headless-cors.php

Upload to `wp-content/mu-plugins/` (create the folder if it does not exist).
Must-use plugins load automatically — there is nothing to activate in wp-admin.

Without this, the browser blocks every Store API call from the storefront:
WordPress sends the other CORS headers but not `Access-Control-Allow-Origin`,
so cross-origin cart requests fail.

Add any new storefront domain to `nulnanul_allowed_origins()`.

### Verifying it worked

    curl -s -D - -o /dev/null \
      -H "Origin: http://localhost:4321" \
      https://amir.loeihard.site/wp-json/wc/store/v1/cart \
      | grep -i access-control-allow-origin

Should print `Access-Control-Allow-Origin: http://localhost:4321`.
Nothing printed means the plugin is not loading.

## mu-plugins/nulnanul-cart-handoff.php

Also goes in `wp-content/mu-plugins/`.

Without it, clicking checkout on the storefront lands on an empty cart: the
Store API cart and the frontend cart are separate stores, and arriving from
another domain there is no session cookie tying them together. This reads the
`?cart-token=` the storefront appends, adopts that session, and redirects to
checkout.

### Verifying it worked

Add something to the cart on the storefront, click checkout, and confirm the
items appear. If checkout is still empty, the token is being rejected — see
`nulnanul_session_id_from_token()`.
