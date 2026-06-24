import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * A shipping rate quote. Captures BOTH the value AND its currency, so the
 * backend can convert/gross-up correctly (PayPal gross-up only when international).
 */
export const ShippingQuote = z.object({
	id: Id.optional(),
	provider: z.string().min(1),
	serviceName: z.string().optional(),
	destinationCountry: z.string().min(2),
	destinationPincode: z.string().optional(),
	value: z.number().nonnegative(),
	currency: z.string().length(3),
	estimatedDays: z.number().int().nonnegative().optional(),
	isInternational: z.boolean().default(false),
	fetchedAt: IsoDateTime.optional(),
});
export type ShippingQuote = z.infer<typeof ShippingQuote>;
