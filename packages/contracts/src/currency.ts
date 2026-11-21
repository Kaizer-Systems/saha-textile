import { z } from 'zod';

import { IsoDateTime } from './common';

/**
 * Currency configuration (admin-editable). INR is canonical (rateFromINR = 1).
 * PayPal markup fields drive the gross-up math for non-INR currencies.
 */
export const Currency = z.object({
	/** ISO 4217 code, e.g. `INR`, `USD`. */
	code: z.string().length(3),
	symbol: z.string().min(1),
	enabled: z.boolean(),
	/** Multiplier applied to the canonical INR price. INR itself = 1. */
	rateFromINR: z.number().finite().positive(),
	/** Whether PayPal is the active gateway for this currency. */
	paypalActive: z.boolean().default(false),
	/** PayPal percentage fee (e.g. 0.044 for 4.4%) used in the gross-up. */
	paypalPct: z.number().min(0).max(1).default(0),
	/** PayPal fixed fee in this currency (e.g. 0.30 USD). */
	paypalFixed: z.number().min(0).default(0),
	/** Who set the rate last (brief fx01): the daily fetch, or staff typing it. */
	rateSetBy: z.enum(['fetch', 'staff']).nullable().default(null),
	rateSetById: z.string().nullable().default(null),
	rateSetAt: IsoDateTime.nullable().default(null),
	updatedAt: IsoDateTime.optional(),
});
export type Currency = z.infer<typeof Currency>;

/**
 * A currency as the shop prices in it (`GET /currency`): `shopRateFromINR` is the stored rate with
 * the PayPal markup on top for every currency but rupees (brief fx01), the same figure the checkout
 * quote charges, so browsing prices and the checkout agree.
 */
export const ShopCurrency = Currency.extend({ shopRateFromINR: z.number().finite().positive() });
export type ShopCurrency = z.infer<typeof ShopCurrency>;
