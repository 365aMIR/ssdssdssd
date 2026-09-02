import type { Loader, LoaderContext } from 'astro/loaders';
import { glob } from 'astro/loaders';

/**
 * Build-time loader for the WooCommerce REST API (wc/v3).
 *
 * Runs on the server during `astro build` only — the consumer key/secret never
 * reach the browser. Products are baked into static HTML, so browsing the shop
 * has no runtime dependency on WordPress being awake.
 *
 * Falls back to the JSON files in src/content/products when the store is
 * unreachable or empty, so a WordPress outage cannot break a deploy. The
 * fallback is logged loudly rather than silently, so a broken integration
 * cannot hide in a green build.
 */

interface WooImage {
    src: string;
    alt: string;
}

interface WooAttribute {
    name: string;
    option?: string;
}

interface WooVariation {
    id: number;
    sku: string;
    stock_quantity: number | null;
    stock_status: string;
    manage_stock: boolean | string;
    attributes: WooAttribute[];
    menu_order: number;
}

interface WooProduct {
    id: number;
    name: string;
    slug: string;
    sku: string;
    type: string;
    price: string;
    stock_quantity: number | null;
    stock_status: string;
    manage_stock: boolean;
    menu_order: number;
    images: WooImage[];
    variations: number[];
    brands?: Array<{ name: string }>;
}

export interface WooLoaderOptions {
    /** Store root, e.g. https://amir.loeihard.site */
    url: string;
    consumerKey: string;
    consumerSecret: string;
    /** Used when a product has no brand assigned in WooCommerce */
    fallbackBrand: string;
    currency: string;
}

/** "32.00" -> 3200. Money is held as integer minor units, never a float. */
function toMinorUnits(price: string): number {
    const parsed = Number.parseFloat(price);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/**
 * WooCommerce tracks stock two different ways. With `manage_stock` on we get a
 * real count; with it off we only know in/out. Out-of-stock becomes 0 so the
 * size button disables, and anything untracked becomes null.
 */
function resolveStock(
    manageStock: boolean | string,
    quantity: number | null,
    status: string,
): number | null {
    if (manageStock === true) return quantity ?? null;
    return status === 'outofstock' ? 0 : null;
}

export function wooCommerceLoader(options: WooLoaderOptions): Loader {
    const auth = Buffer.from(
        `${options.consumerKey}:${options.consumerSecret}`,
    ).toString('base64');

    async function api<T>(path: string): Promise<T> {
        const response = await fetch(`${options.url}/wp-json/wc/v3${path}`, {
            headers: { Authorization: `Basic ${auth}` },
        });
        if (!response.ok) {
            throw new Error(
                `WooCommerce ${path} responded ${response.status} ${response.statusText}`,
            );
        }
        return (await response.json()) as T;
    }

    return {
        name: 'woocommerce',

        async load(context: LoaderContext) {
            const { store, logger, parseData } = context;

            let products: WooProduct[] = [];
            try {
                // per_page caps at 100; page through in case the catalogue grows
                for (let page = 1; ; page++) {
                    const batch = await api<WooProduct[]>(
                        `/products?per_page=100&status=publish&page=${page}`,
                    );
                    products.push(...batch);
                    if (batch.length < 100) break;
                }
            } catch (error) {
                logger.warn(
                    `WooCommerce unreachable (${error instanceof Error ? error.message : error}) — falling back to src/content/products`,
                );
                products = [];
            }

            if (products.length === 0) {
                logger.warn(
                    'WooCommerce returned no published products — falling back to src/content/products',
                );
                return glob({
                    pattern: '**/*.json',
                    base: './src/content/products',
                }).load(context);
            }

            store.clear();

            for (const product of products) {
                // Variable products keep their sizes in a separate endpoint;
                // simple ones become a single unnamed variant.
                let variants: Array<{
                    size: string;
                    sku: string;
                    stock: number | null;
                    wooId: number | null;
                }> = [];

                if (product.type === 'variable' && product.variations.length) {
                    const variations = await api<WooVariation[]>(
                        `/products/${product.id}/variations?per_page=100`,
                    );
                    variants = variations
                        .sort((a, b) => a.menu_order - b.menu_order)
                        .map((variation) => {
                            const size = variation.attributes.find((attr) =>
                                /size|maat/i.test(attr.name),
                            )?.option;
                            return {
                                size: size ?? 'one size',
                                sku:
                                    variation.sku ||
                                    `${product.sku}-${variation.id}`,
                                stock: resolveStock(
                                    variation.manage_stock,
                                    variation.stock_quantity,
                                    variation.stock_status,
                                ),
                                wooId: variation.id,
                            };
                        });
                } else {
                    variants = [
                        {
                            size: 'one size',
                            sku: product.sku || String(product.id),
                            stock: resolveStock(
                                product.manage_stock,
                                product.stock_quantity,
                                product.stock_status,
                            ),
                            wooId: product.id,
                        },
                    ];
                }

                const [front, ...rest] = product.images;

                const data = await parseData({
                    id: product.slug,
                    data: {
                        sku: product.sku || String(product.id),
                        title: product.name,
                        brand: product.brands?.[0]?.name ?? options.fallbackBrand,
                        price: toMinorUnits(product.price),
                        currency: options.currency,
                        order: product.menu_order,
                        variants,
                        images: {
                            front: front?.src ?? '',
                            additional: rest.map((image) => image.src),
                        },
                    },
                });

                store.set({ id: product.slug, data });
            }

            logger.info(`Loaded ${products.length} products from WooCommerce`);
        },
    };
}
