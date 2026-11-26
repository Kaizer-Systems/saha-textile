import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { ProductStatus } from './product';

/**
 * Product drafts (product bulk actions brief § 7, approved 2026-11-19).
 *
 * Save as draft keeps whatever is on the product form at any moment, mistakes included, and runs no
 * checks. A draft is kept apart from products, so the shop, search, sitemap, sales and stock never
 * see it. It ends only when the product is saved or the draft is discarded; nothing deletes it
 * on a timer.
 *
 * - `new`: a product not created yet. Save Product runs every check, creates it, and removes the draft.
 * - `edit`: changes to an existing product, one per product per person. The product is untouched until
 *   Update Product, which runs every check and writes the changed fields only.
 */

export const ProductDraftKind = z.enum(['new', 'edit']);
export type ProductDraftKind = z.infer<typeof ProductDraftKind>;

/** The largest form a draft keeps, as JSON text. */
export const PRODUCT_DRAFT_MAX_BYTES = 512 * 1024;

/** The form as it was, unchecked: the form's own values, its language text and its lists. */
const DraftForm = z
	.record(z.string(), z.unknown())
	.refine((form) => JSON.stringify(form).length <= PRODUCT_DRAFT_MAX_BYTES, 'The draft is too large to keep');

/** One changed field of an `edit` draft, and its value in the product when the draft began. */
export const ProductDraftChange = z.object({
	path: z.string().min(1).max(300),
	from: z.unknown(),
});
export type ProductDraftChange = z.infer<typeof ProductDraftChange>;

export const ProductDraftWrite = z
	.object({
		kind: ProductDraftKind,
		/** The product an `edit` draft changes; null for `new`. */
		productId: Id.nullable().default(null),
		/** The English name as typed, for the Drafts list. */
		title: z.string().trim().max(300).default(''),
		/** The first picture on the form, for the Drafts list. */
		imageAssetId: Id.nullable().default(null),
		form: DraftForm,
		changes: z.array(ProductDraftChange).max(2_000).default([]),
		/** What still stops Save, counted on the form when the draft was saved. */
		toFix: z.number().int().nonnegative().max(10_000).default(0),
		/** The product's last save when an `edit` draft began, for the conflict check. */
		baseSavedAt: IsoDateTime.nullable().default(null),
	})
	.superRefine((draft, ctx) => {
		if (draft.kind === 'edit' && !draft.productId) {
			ctx.addIssue({ code: 'custom', path: ['productId'], message: 'A draft of changes names its product' });
		}
		if (draft.kind === 'new' && draft.productId) {
			ctx.addIssue({ code: 'custom', path: ['productId'], message: 'A new-product draft has no product yet' });
		}
	});
export type ProductDraftWrite = z.infer<typeof ProductDraftWrite>;

export const ProductDraft = z.object({
	id: Id,
	kind: ProductDraftKind,
	productId: Id.nullable(),
	title: z.string(),
	imageAssetId: Id.nullable(),
	form: z.record(z.string(), z.unknown()),
	changes: z.array(ProductDraftChange),
	toFix: z.number().int().nonnegative(),
	baseSavedAt: IsoDateTime.nullable(),
	createdBy: Id.nullable(),
	updatedBy: Id.nullable(),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type ProductDraft = z.infer<typeof ProductDraft>;

export const ProductDraftListQuery = z.object({
	/** `mine`: the signed-in admin's drafts. `everyone`: the team's, with who saved them. */
	scope: z.enum(['mine', 'everyone']).default('mine'),
	/** Only drafts of this product (the form's "you have a draft" notice). */
	productId: Id.optional(),
	search: z.string().trim().max(100).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type ProductDraftListQuery = z.infer<typeof ProductDraftListQuery>;

/** One row of Products › Drafts. */
export const ProductDraftRow = z.object({
	id: Id,
	kind: ProductDraftKind,
	productId: Id.nullable(),
	title: z.string(),
	thumbnailUrl: z.string().nullable(),
	/** The product an `edit` draft changes: its status and name now. */
	productStatus: ProductStatus.nullable(),
	productTitle: z.string().nullable(),
	/** True once that product has been live. */
	productWasLive: z.boolean().default(false),
	changedCount: z.number().int().nonnegative(),
	toFix: z.number().int().nonnegative(),
	updatedAt: IsoDateTime,
	/** Who saved it last, for Everyone's. */
	updatedByName: z.string().nullable(),
	mine: z.boolean(),
});
export type ProductDraftRow = z.infer<typeof ProductDraftRow>;

export const ProductDraftList = z.object({
	items: z.array(ProductDraftRow),
	total: z.number().int().nonnegative(),
	/** The signed-in admin's drafts, for the menu badge. */
	mine: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	pageSize: z.number().int().min(1),
});
export type ProductDraftList = z.infer<typeof ProductDraftList>;
