import { z } from 'zod';

import { CatalogStatus } from './catalog';
import { I18nString, Id, IsoDateTime } from './common';

/**
 * Where an FAQ entry is shown. Owner lock: FAQ is admin-authored editorial content that
 * may target global, category, product, or a MIX of category and product surfaces, with
 * dedupe and preview in the admin UI.
 */
export const FaqScope = z.enum(['global', 'category', 'product', 'mixed']);
export type FaqScope = z.infer<typeof FaqScope>;

/**
 * An admin-authored FAQ entry (`faqEntries`).
 *
 * Separate from product Q&A: FAQ is editorial and never customer-submitted. Dedupe (the
 * same entry resolving twice on one page through different targets) is a read-time
 * concern the resolver owns; this schema guarantees each target list is itself clean.
 */
export const FaqEntry = z
	.object({
		id: Id,
		question: I18nString,
		answer: I18nString,
		scope: FaqScope,
		categoryIds: z.array(Id).default([]),
		productIds: z.array(Id).default([]),
		displayOrder: z.number().int().default(0),
		status: CatalogStatus.default('draft'),
		createdAt: IsoDateTime.optional(),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((faq, ctx) => {
		const needsCategories = faq.scope === 'category' || faq.scope === 'mixed';
		const needsProducts = faq.scope === 'product' || faq.scope === 'mixed';

		if (needsCategories && faq.categoryIds.length === 0) {
			ctx.addIssue({
				code: 'custom',
				message: `scope \`${faq.scope}\` requires at least one category`,
				path: ['categoryIds'],
			});
		}
		if (needsProducts && faq.productIds.length === 0) {
			ctx.addIssue({
				code: 'custom',
				message: `scope \`${faq.scope}\` requires at least one product`,
				path: ['productIds'],
			});
		}
		if (faq.scope === 'global' && (faq.categoryIds.length > 0 || faq.productIds.length > 0)) {
			ctx.addIssue({
				code: 'custom',
				message: 'a global FAQ entry may not also target categories or products',
				path: ['scope'],
			});
		}
		if (faq.scope === 'category' && faq.productIds.length > 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'use scope `mixed` to target products as well',
				path: ['productIds'],
			});
		}
		if (faq.scope === 'product' && faq.categoryIds.length > 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'use scope `mixed` to target categories as well',
				path: ['categoryIds'],
			});
		}
		if (new Set(faq.categoryIds).size !== faq.categoryIds.length) {
			ctx.addIssue({ code: 'custom', message: 'duplicate category target', path: ['categoryIds'] });
		}
		if (new Set(faq.productIds).size !== faq.productIds.length) {
			ctx.addIssue({ code: 'custom', message: 'duplicate product target', path: ['productIds'] });
		}
	});
export type FaqEntry = z.infer<typeof FaqEntry>;

export const QuestionStatus = z.enum(['pending', 'answered', 'rejected']);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

/**
 * A customer or guest question on a product (`productQuestions`).
 *
 * Owner locks: login is NOT required; a guest supplies name and email; a logged-in
 * identity is prefilled but editable; "stay anonymous" hides the public identity but
 * never the admin-visible one — which is why `askerName`/`askerEmail` are always stored
 * and `isAnonymous` only governs rendering. An admin answer publishes the Q&A and
 * triggers the answer email.
 */
export const ProductQuestion = z
	.object({
		id: Id,
		productId: Id,
		question: z.string().min(1).max(2000),
		/** Null for a guest submission. */
		userId: Id.nullable().default(null),
		/** Always retained for admin; hidden publicly when `isAnonymous`. */
		askerName: z.string().min(1).max(120),
		askerEmail: z.email(),
		isAnonymous: z.boolean().default(false),
		answer: z.string().min(1).max(4000).nullable().default(null),
		answeredByUserId: Id.nullable().default(null),
		answeredAt: IsoDateTime.nullable().default(null),
		status: QuestionStatus.default('pending'),
		createdAt: IsoDateTime.optional(),
	})
	.superRefine((question, ctx) => {
		if (question.status === 'answered' && !question.answer?.trim()) {
			ctx.addIssue({ code: 'custom', message: 'an answered question must carry an answer', path: ['answer'] });
		}
		if (question.answer && !question.answeredByUserId) {
			ctx.addIssue({ code: 'custom', message: 'an answer must record who wrote it', path: ['answeredByUserId'] });
		}
	});
export type ProductQuestion = z.infer<typeof ProductQuestion>;

/** Public projection of a Q&A: anonymity applied, email never exposed. */
export const PublicProductQuestion = z.object({
	id: Id,
	productId: Id,
	question: z.string(),
	/** `null` when the asker chose to stay anonymous. */
	askerName: z.string().nullable(),
	answer: z.string().nullable(),
	answeredAt: IsoDateTime.nullable(),
	createdAt: IsoDateTime.optional(),
});
export type PublicProductQuestion = z.infer<typeof PublicProductQuestion>;

/**
 * Projects a stored question to its public shape — the single place anonymity and email
 * suppression are applied, so no endpoint can forget one of them.
 */
export const toPublicQuestion = (question: ProductQuestion): PublicProductQuestion => ({
	id: question.id,
	productId: question.productId,
	question: question.question,
	askerName: question.isAnonymous ? null : question.askerName,
	answer: question.answer,
	answeredAt: question.answeredAt,
	createdAt: question.createdAt,
});

export const ReviewStatus = z.enum(['pending', 'approved', 'rejected']);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/**
 * A product review (`reviews`).
 *
 * Owner locks: a review requires a LOGGED-IN customer with a VERIFIED PURCHASE (hence
 * `userId` and `orderId` are both required); content is a star rating, text, and optional
 * images; every review needs admin moderation before public display; and rating
 * aggregates plus review SEO use APPROVED, verified reviews only.
 */
export const Review = z.object({
	id: Id,
	productId: Id,
	/** Required: reviews are never anonymous or guest-submitted. */
	userId: Id,
	/** Required: the order proving the purchase being reviewed. */
	orderId: Id,
	rating: z.number().int().min(1).max(5),
	title: z.string().max(200).nullable().default(null),
	body: z.string().min(1).max(5000),
	imageAssetIds: z.array(Id).default([]),
	status: ReviewStatus.default('pending'),
	moderatedByUserId: Id.nullable().default(null),
	moderatedAt: IsoDateTime.nullable().default(null),
	moderationNote: z.string().max(1000).nullable().default(null),
	createdAt: IsoDateTime.optional(),
});
export type Review = z.infer<typeof Review>;

/**
 * Persisted rating aggregate for a product.
 *
 * Recomputed from approved verified reviews only — never a live scan, and never
 * including pending or rejected reviews. `buckets` powers the star-filter facet.
 */
export const RatingAggregate = z
	.object({
		productId: Id,
		average: z.number().min(0).max(5),
		count: z.number().int().nonnegative(),
		buckets: z
			.object({
				1: z.number().int().nonnegative().default(0),
				2: z.number().int().nonnegative().default(0),
				3: z.number().int().nonnegative().default(0),
				4: z.number().int().nonnegative().default(0),
				5: z.number().int().nonnegative().default(0),
			})
			.default({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((aggregate, ctx) => {
		const bucketTotal = Object.values(aggregate.buckets).reduce((sum, value) => sum + value, 0);
		if (bucketTotal !== aggregate.count) {
			ctx.addIssue({ code: 'custom', message: 'rating buckets must sum to `count`', path: ['buckets'] });
		}
		if (aggregate.count === 0 && aggregate.average !== 0) {
			ctx.addIssue({ code: 'custom', message: 'an empty aggregate must have a zero average', path: ['average'] });
		}
	});
export type RatingAggregate = z.infer<typeof RatingAggregate>;
