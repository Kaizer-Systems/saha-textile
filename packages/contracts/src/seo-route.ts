import { z } from 'zod';

import { Id, LocaleCode } from './common';

/** One public address in one language. Filtered, private, and gone URLs are not rows. */
export const SeoRoute = z.object({
	id: Id,
	path: z.string().min(1),
	locale: LocaleCode,
	title: z.string().min(1),
	description: z.string().default(''),
	canonicalPath: z.string().min(1),
	robots: z.string().default('index,follow'),
	indexable: z.boolean().default(true),
	entityType: z.string().min(1).optional(),
	entityId: Id.optional(),
});
export type SeoRoute = z.infer<typeof SeoRoute>;
