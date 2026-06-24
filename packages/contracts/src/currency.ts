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
	updatedAt: IsoDateTime.optional(),
});
export type Currency = z.infer<typeof Currency>;
