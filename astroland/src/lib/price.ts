/**
 * Prices are stored as integer minor units (3200 === €32,00) so no arithmetic
 * ever touches a float. Formatting is the only place they become a string.
 */
export function formatPrice(minorUnits: number, currency: string): string {
    return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency,
    }).format(minorUnits / 100);
}
