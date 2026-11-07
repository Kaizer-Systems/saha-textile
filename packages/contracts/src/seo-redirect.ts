import { z } from 'zod';

import { Id, IsoDateTime } from './common';

export const SeoRedirectStatus = z.union([z.literal(301), z.literal(302), z.literal(410)]);
export type SeoRedirectStatus = z.infer<typeof SeoRedirectStatus>;

export const SeoRedirectReason = z.enum([
	'legacy_woo',
	'slug_change',
	'category_move',
	'product_archived',
	'category_archived',
	'manual',
]);
export type SeoRedirectReason = z.infer<typeof SeoRedirectReason>;

/**
 * One old address. The stored target is never itself a redirect: chains are
 * collapsed when the row is saved.
 */
export const SeoRedirect = z
	.object({
		id: Id,
		sourcePath: z.string().min(1),
		statusCode: SeoRedirectStatus,
		targetPath: z.string().min(1).optional(),
		reason: SeoRedirectReason,
		entityType: z.string().min(1).optional(),
		entityId: Id.optional(),
		createdAt: IsoDateTime.optional(),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((row, ctx) => {
		if ((row.statusCode === 301 || row.statusCode === 302) && !row.targetPath) {
			ctx.addIssue({ code: 'custom', message: 'a redirect needs a target path', path: ['targetPath'] });
		}
		if (row.statusCode === 410 && row.targetPath) {
			ctx.addIssue({ code: 'custom', message: 'a 410 has no target', path: ['targetPath'] });
		}
	});
export type SeoRedirect = z.infer<typeof SeoRedirect>;

export const SeoRedirectWrite = z
	.object({
		sourcePath: z.string().min(1),
		statusCode: SeoRedirectStatus,
		targetPath: z.string().min(1).optional(),
		reason: SeoRedirectReason,
		entityType: z.string().min(1).optional(),
		entityId: Id.optional(),
	})
	.superRefine((row, ctx) => {
		if ((row.statusCode === 301 || row.statusCode === 302) && !row.targetPath) {
			ctx.addIssue({ code: 'custom', message: 'a redirect needs a target path', path: ['targetPath'] });
		}
		if (row.statusCode === 410 && row.targetPath) {
			ctx.addIssue({ code: 'custom', message: 'a 410 has no target', path: ['targetPath'] });
		}
	});
export type SeoRedirectWrite = z.infer<typeof SeoRedirectWrite>;
