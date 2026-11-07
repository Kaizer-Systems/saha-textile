import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/** One week's saved analytics. Storefront cards read these results, never live joins. */
export const ProductInsightSet = z.object({
	id: Id,
	generatedAt: IsoDateTime,
	bestseller: z.array(Id).default([]),
	trending: z.array(Id).default([]),
	relations: z.number().int().nonnegative().default(0),
});
export type ProductInsightSet = z.infer<typeof ProductInsightSet>;
