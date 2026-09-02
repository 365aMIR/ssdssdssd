import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { wooCommerceLoader } from './loaders/woocommerce';

// Credentials are read at build time only. Nothing prefixed PUBLIC_, so Astro
// will not leak them into the client bundle. See .env (gitignored).
const wooUrl = import.meta.env.WOO_API_URL ?? process.env.WOO_API_URL;
const wooKey =
    import.meta.env.WOO_CONSUMER_KEY ?? process.env.WOO_CONSUMER_KEY;
const wooSecret =
    import.meta.env.WOO_CONSUMER_SECRET ?? process.env.WOO_CONSUMER_SECRET;

// Products are plain JSON files in src/content/products.
// Drop a new file in there and it shows up in the shop automatically.
//
// This schema is the contract the shop renders against. When products start
// coming from WooCommerce, only the loader above changes — a loader that maps
// the Woo response into this same shape leaves Shopper.astro untouched.
const products = defineCollection({
    // With credentials present the catalogue comes from WooCommerce; without
    // them it is the local JSON files, so the site still builds on a machine
    // that has no store access.
    loader:
        wooUrl && wooKey && wooSecret
            ? wooCommerceLoader({
                  url: wooUrl,
                  consumerKey: wooKey,
                  consumerSecret: wooSecret,
                  fallbackBrand: 'nulnanul.nl',
                  currency: 'EUR',
              })
            : glob({ pattern: '**/*.json', base: './src/content/products' }),
    schema: z.object({
        // Ties a product to its counterpart in the store. WooCommerce matches
        // on SKU, so these have to agree with what is set there.
        sku: z.string(),
        title: z.string(),
        brand: z.string(),
        // Minor units — 3200 is €32,00. Integers only: money must never be a
        // float, and both WooCommerce and Stripe use this convention.
        price: z.number().int(),
        currency: z.string().default('EUR'),
        // Lower numbers hang first on the washing line
        order: z.number().default(0),
        // One entry per size. Stock is per-variant because S selling out is
        // not the same as the product selling out. null means untracked.
        variants: z
            .array(
                z.object({
                    size: z.string(),
                    sku: z.string(),
                    stock: z.number().int().nullable().default(null),
                    // WooCommerce variation id — the only thing the Store API
                    // needs to put a line in the cart. null for local JSON
                    // products, which therefore cannot be bought.
                    wooId: z.number().int().nullable().default(null),
                }),
            )
            .default([]),
        images: z.object({
            // Front doubles as the thumbnail and the main frame image
            front: z.string(),
            back: z.string().optional(),
            additional: z.array(z.string()).default([]),
        }),
    }),
});

export const collections = { products };
