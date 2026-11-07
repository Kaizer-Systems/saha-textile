import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/** One customer waiting on one variant. The pair is unique, so a repeat click changes nothing. */
export const StockAlert = z.object({
	id: Id,
	customerId: Id,
	productId: Id,
	variantId: Id,
	createdAt: IsoDateTime,
	notifiedAt: IsoDateTime.nullable().default(null),
	lastError: z.string().nullable().default(null),
});
export type StockAlert = z.infer<typeof StockAlert>;
