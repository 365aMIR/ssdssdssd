/**
 * Client for the WooCommerce Store API cart.
 *
 * The cart lives on the WooCommerce server, not here. That is deliberate:
 * totals, stock checks and tax are computed by Woo, so nothing in the browser
 * can be tampered with to change a price. This module only moves messages
 * back and forth and reports what Woo says.
 */

const API = `${import.meta.env.PUBLIC_WOO_URL}/wp-json/wc/store/v1`;

// A guest cart is identified by a JWT the Store API hands back. Cookies are
// unreliable cross-origin, so the token is kept in localStorage instead.
const TOKEN_KEY = 'woo-cart-token';

export interface CartItem {
    key: string;
    id: number;
    name: string;
    quantity: number;
    variation: Array<{ attribute: string; value: string }>;
    images: Array<{ src: string; thumbnail: string; alt: string }>;
    // Woo's own bounds — respected so the input cannot ask for a rejected qty
    quantity_limits: { minimum: number; maximum: number };
    totals: { line_total: string; currency_code: string };
}

export interface Cart {
    items: CartItem[];
    items_count: number;
    totals: {
        total_price: string;
        total_items: string;
        currency_code: string;
        currency_minor_unit: number;
    };
}

let nonce: string | null = null;

function readToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        // Private browsing can throw on storage access
        return null;
    }
}

function storeToken(value: string | null) {
    if (!value) return;
    try {
        localStorage.setItem(TOKEN_KEY, value);
    } catch {
        /* not fatal — the cart just will not survive a reload */
    }
}

async function request(path: string, init: RequestInit = {}): Promise<Cart> {
    const token = readToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string>),
    };
    if (token) headers['Cart-Token'] = token;
    if (nonce) headers['Nonce'] = nonce;

    const response = await fetch(`${API}${path}`, { ...init, headers });

    // Woo rotates both on most responses; hold on to whatever it last sent
    storeToken(response.headers.get('Cart-Token'));
    nonce = response.headers.get('Nonce') ?? nonce;

    const body = await response.json();
    if (!response.ok) {
        throw new Error(body?.message ?? `Cart request failed (${response.status})`);
    }
    return body as Cart;
}

export const getCart = () => request('/cart');

/** `variationId` is the WooCommerce variation id carried on each size button. */
export const addItem = (variationId: number, quantity = 1) =>
    request('/cart/add-item', {
        method: 'POST',
        body: JSON.stringify({ id: variationId, quantity }),
    });

export const updateItem = (key: string, quantity: number) =>
    request('/cart/update-item', {
        method: 'POST',
        body: JSON.stringify({ key, quantity }),
    });

export const removeItem = (key: string) =>
    request('/cart/remove-item', {
        method: 'POST',
        body: JSON.stringify({ key }),
    });

/**
 * Hands the shopper to WooCommerce's own checkout carrying this cart.
 *
 * Payment stays on Woo on purpose: iDEAL redirects out to a bank and back, and
 * owning that round trip badly means taking money without recording an order.
 */
export function checkoutUrl(): string {
    const token = readToken();
    const base = `${import.meta.env.PUBLIC_WOO_URL}/checkout/`;
    return token ? `${base}?cart-token=${encodeURIComponent(token)}` : base;
}

/** Formats Store API minor units (1000 -> "€ 10,00"). */
export function formatCartPrice(minor: string, currency: string): string {
    return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency,
    }).format(Number(minor) / 100);
}
