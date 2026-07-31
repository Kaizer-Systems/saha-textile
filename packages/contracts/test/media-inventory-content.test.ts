import { describe, expect, it } from 'vitest';

import {
	BASE_VIDEO_RENDITIONS,
	FaqEntry,
	InventoryAdjustmentRequest,
	InventoryCostLayer,
	InventoryLedgerEntry,
	InventoryReasonCode,
	MediaAsset,
	MediaAttachmentSet,
	MediaRole,
	ProductQuestion,
	RatingAggregate,
	Review,
	hlsRenditionsFor,
	toPublicQuestion,
} from '../src/index';

describe('media roles and the HLS ladder', () => {
	it('carries exactly the locked role keys, with pixel sizes left to config', () => {
		expect(MediaRole.options).toEqual(['thumb', 'card', 'gallery', 'zoom', 'swatch_image', 'swatch_image_v2']);
	});

	it('always produces 480/720/1080', () => {
		expect(BASE_VIDEO_RENDITIONS).toEqual([480, 720, 1080]);
		expect(hlsRenditionsFor(1080)).toEqual([480, 720, 1080]);
		expect(hlsRenditionsFor(720)).toEqual([480, 720, 1080]);
	});

	it('adds 1440 only for a 1440p source', () => {
		expect(hlsRenditionsFor(1440)).toEqual([480, 720, 1080, 1440]);
	});

	it('adds 2160 for a 2160p source and skips 1440 in that case (owner lock)', () => {
		expect(hlsRenditionsFor(2160)).toEqual([480, 720, 1080, 2160]);
		expect(hlsRenditionsFor(2160)).not.toContain(1440);
	});

	it('rejects a nonsense source height', () => {
		expect(() => hlsRenditionsFor(0)).toThrow(RangeError);
		expect(() => hlsRenditionsFor(Number.NaN)).toThrow(RangeError);
	});
});

describe('MediaAsset', () => {
	const image = (overrides: Record<string, unknown> = {}) => ({
		id: 'media_1',
		kind: 'image' as const,
		originalStorageKey: 'products/saree-001/original.jpg',
		originalFormat: 'image/jpeg',
		originalByteSize: 2_400_000,
		width: 3000,
		height: 4000,
		...overrides,
	});

	it('applies defaults and starts unpublished', () => {
		const parsed = MediaAsset.parse(image());
		expect(parsed.status).toBe('draft');
		expect(parsed.derivatives).toEqual([]);
		expect(parsed.deletedAt).toBeNull();
		expect(parsed.text).toEqual({ alt: {}, title: {}, caption: {} });
	});

	it('accepts only JPEG/PNG uploads — AVIF is deliberately absent', () => {
		expect(MediaAsset.safeParse(image({ originalFormat: 'image/png' })).success).toBe(true);
		expect(MediaAsset.safeParse(image({ originalFormat: 'image/avif' })).success).toBe(false);
		expect(MediaAsset.safeParse(image({ originalFormat: 'image/webp' })).success).toBe(false);
	});

	it('emits WebP derivatives only, one per role', () => {
		const derivative = {
			role: 'card',
			storageKey: 'products/saree-001/card.webp',
			width: 600,
			height: 800,
			byteSize: 40_000,
			format: 'image/webp',
		};
		expect(MediaAsset.safeParse(image({ derivatives: [derivative] })).success).toBe(true);
		expect(MediaAsset.safeParse(image({ derivatives: [derivative, derivative] })).success).toBe(false);
		expect(MediaAsset.safeParse(image({ derivatives: [{ ...derivative, format: 'image/jpeg' }] })).success).toBe(
			false,
		);
	});

	it('keeps image and video shapes from bleeding into each other', () => {
		expect(
			MediaAsset.safeParse(
				image({ renditions: [{ height: 720, storageKey: 'k', bitrateKbps: 2500, byteSize: 1 }] }),
			).success,
		).toBe(false);

		const video = {
			id: 'media_2',
			kind: 'video' as const,
			originalStorageKey: null,
			originalFormat: 'video/mp4',
			originalByteSize: 90_000_000,
			renditions: [
				{ height: 480, storageKey: 'v/480.m3u8', bitrateKbps: 900, byteSize: 10 },
				{ height: 1080, storageKey: 'v/1080.m3u8', bitrateKbps: 4500, byteSize: 40 },
			],
			hlsPlaylistKey: 'v/master.m3u8',
		};
		// originalStorageKey null models the hot master deleted after a successful transcode.
		expect(MediaAsset.safeParse(video).success).toBe(true);
		expect(MediaAsset.safeParse({ ...video, renditions: [video.renditions[0], video.renditions[0]] }).success).toBe(
			false,
		);
		expect(MediaAsset.safeParse({ ...video, fullWebpStorageKey: 'x.webp' }).success).toBe(false);
	});
});

describe('MediaAttachmentSet — contiguous, attachment-owned, #1 is primary', () => {
	const attachment = (assetId: string, sortOrder: number) => ({ assetId, sortOrder });

	it('accepts a contiguous ordering starting at 1', () => {
		expect(MediaAttachmentSet.safeParse([attachment('a', 1), attachment('b', 2), attachment('c', 3)]).success).toBe(
			true,
		);
		expect(MediaAttachmentSet.safeParse([]).success).toBe(true);
	});

	it('rejects a gap, a zero/!1 start, duplicate orders, and a repeated asset', () => {
		expect(MediaAttachmentSet.safeParse([attachment('a', 1), attachment('b', 3)]).success).toBe(false);
		expect(MediaAttachmentSet.safeParse([attachment('a', 2), attachment('b', 3)]).success).toBe(false);
		expect(MediaAttachmentSet.safeParse([attachment('a', 1), attachment('b', 1)]).success).toBe(false);
		expect(MediaAttachmentSet.safeParse([attachment('a', 1), attachment('a', 2)]).success).toBe(false);
	});
});

describe('inventory reason codes', () => {
	it('carries the ten locked codes', () => {
		expect(InventoryReasonCode.options).toEqual([
			'damage',
			'lost_missing',
			'manual_recount_correction',
			'supplier_shortage',
			'return_restocked',
			'return_not_restocked',
			'internal_use_sample',
			'photoshoot_display_use',
			'system_migration_correction',
			'other',
		]);
	});

	it('makes a note optional for the first nine and mandatory for `other`', () => {
		const base = { variantId: 'var_1', quantityDelta: -2 };
		expect(InventoryAdjustmentRequest.safeParse({ ...base, reasonCode: 'damage' }).success).toBe(true);
		expect(InventoryAdjustmentRequest.safeParse({ ...base, reasonCode: 'other' }).success).toBe(false);
		expect(InventoryAdjustmentRequest.safeParse({ ...base, reasonCode: 'other', note: '   ' }).success).toBe(false);
		expect(InventoryAdjustmentRequest.safeParse({ ...base, reasonCode: 'other', note: 'stocktake' }).success).toBe(
			true,
		);
	});

	it('rejects a no-op adjustment', () => {
		expect(
			InventoryAdjustmentRequest.safeParse({ variantId: 'var_1', quantityDelta: 0, reasonCode: 'damage' })
				.success,
		).toBe(false);
	});
});

describe('InventoryLedgerEntry', () => {
	const entry = (overrides: Record<string, unknown> = {}) => ({
		id: 'led_1',
		variantId: 'var_1',
		productId: 'prod_1',
		quantityDelta: -1,
		balanceAfter: 4,
		source: 'order_placed',
		createdAt: '2026-08-01T10:00:00.000Z',
		...overrides,
	});

	it('records system provenance without a reason code', () => {
		const parsed = InventoryLedgerEntry.parse(entry());
		expect(parsed.reasonCode).toBeNull();
		expect(parsed.actorUserId).toBeNull();
	});

	it('requires a reason code on a manual adjustment, and a note when it is `other`', () => {
		expect(InventoryLedgerEntry.safeParse(entry({ source: 'manual_adjustment' })).success).toBe(false);
		expect(
			InventoryLedgerEntry.safeParse(entry({ source: 'manual_adjustment', reasonCode: 'damage' })).success,
		).toBe(true);
		expect(
			InventoryLedgerEntry.safeParse(entry({ source: 'manual_adjustment', reasonCode: 'other' })).success,
		).toBe(false);
	});

	it('rejects a zero-delta row', () => {
		expect(InventoryLedgerEntry.safeParse(entry({ quantityDelta: 0 })).success).toBe(false);
	});
});

describe('InventoryCostLayer (FIFO — never customer-facing)', () => {
	it('rejects a remaining quantity above what was received', () => {
		const layer = {
			id: 'layer_1',
			variantId: 'var_1',
			unitCostINR: 800,
			quantityReceived: 10,
			receivedAt: '2026-08-01T10:00:00.000Z',
		};
		expect(InventoryCostLayer.safeParse({ ...layer, quantityRemaining: 10 }).success).toBe(true);
		expect(InventoryCostLayer.safeParse({ ...layer, quantityRemaining: 11 }).success).toBe(false);
	});
});

describe('FaqEntry targeting', () => {
	const faq = (overrides: Record<string, unknown> = {}) => ({
		id: 'faq_1',
		question: { en: 'Do you ship internationally?' },
		answer: { en: 'Yes.' },
		scope: 'global',
		...overrides,
	});

	it('accepts a global entry with no targets', () => {
		expect(FaqEntry.safeParse(faq()).success).toBe(true);
	});

	it('requires targets matching the scope', () => {
		expect(FaqEntry.safeParse(faq({ scope: 'category' })).success).toBe(false);
		expect(FaqEntry.safeParse(faq({ scope: 'category', categoryIds: ['cat_1'] })).success).toBe(true);
		expect(FaqEntry.safeParse(faq({ scope: 'product', productIds: ['prod_1'] })).success).toBe(true);
		expect(FaqEntry.safeParse(faq({ scope: 'mixed', categoryIds: ['cat_1'] })).success).toBe(false);
		expect(
			FaqEntry.safeParse(faq({ scope: 'mixed', categoryIds: ['cat_1'], productIds: ['prod_1'] })).success,
		).toBe(true);
	});

	it('rejects targets that contradict the scope, and duplicates', () => {
		expect(FaqEntry.safeParse(faq({ categoryIds: ['cat_1'] })).success).toBe(false);
		expect(FaqEntry.safeParse(faq({ scope: 'category', categoryIds: ['cat_1'], productIds: ['p'] })).success).toBe(
			false,
		);
		expect(FaqEntry.safeParse(faq({ scope: 'category', categoryIds: ['cat_1', 'cat_1'] })).success).toBe(false);
	});
});

describe('ProductQuestion — guests may ask; anonymity is public-only', () => {
	const question = (overrides: Record<string, unknown> = {}) => ({
		id: 'q_1',
		productId: 'prod_1',
		question: 'Is the blouse piece included?',
		askerName: 'Riya',
		askerEmail: 'riya@example.com',
		createdAt: '2026-08-01T10:00:00.000Z',
		...overrides,
	});

	it('accepts a guest submission without a user id', () => {
		const parsed = ProductQuestion.parse(question());
		expect(parsed.userId).toBeNull();
		expect(parsed.status).toBe('pending');
		expect(parsed.isAnonymous).toBe(false);
	});

	it('requires name and a valid email from anyone', () => {
		expect(ProductQuestion.safeParse(question({ askerName: '' })).success).toBe(false);
		expect(ProductQuestion.safeParse(question({ askerEmail: 'nope' })).success).toBe(false);
	});

	it('requires an answered question to carry an answer and an author', () => {
		expect(ProductQuestion.safeParse(question({ status: 'answered' })).success).toBe(false);
		expect(ProductQuestion.safeParse(question({ answer: 'Yes it is.' })).success).toBe(false);
		expect(
			ProductQuestion.safeParse(
				question({ status: 'answered', answer: 'Yes it is.', answeredByUserId: 'admin_1' }),
			).success,
		).toBe(true);
	});

	it('hides the identity publicly but keeps it for admin, and never exposes the email', () => {
		const anonymous = ProductQuestion.parse(question({ isAnonymous: true }));
		const publicView = toPublicQuestion(anonymous);
		expect(anonymous.askerName).toBe('Riya'); // retained for admin
		expect(publicView.askerName).toBeNull(); // hidden publicly
		expect('askerEmail' in publicView).toBe(false);

		const named = toPublicQuestion(ProductQuestion.parse(question()));
		expect(named.askerName).toBe('Riya');
	});
});

describe('Review — logged-in, verified purchase, moderated', () => {
	const review = (overrides: Record<string, unknown> = {}) => ({
		id: 'rev_1',
		productId: 'prod_1',
		userId: 'user_1',
		orderId: 'ord_1',
		rating: 5,
		body: 'Beautiful weave.',
		...overrides,
	});

	it('starts unapproved — moderation precedes public display', () => {
		expect(Review.parse(review()).status).toBe('pending');
	});

	it('requires the purchase proof: both a user and an order', () => {
		const { userId: _userId, ...withoutUser } = review();
		const { orderId: _orderId, ...withoutOrder } = review();
		expect(Review.safeParse(withoutUser).success).toBe(false);
		expect(Review.safeParse(withoutOrder).success).toBe(false);
	});

	it('bounds the rating to 1–5 whole stars', () => {
		expect(Review.safeParse(review({ rating: 0 })).success).toBe(false);
		expect(Review.safeParse(review({ rating: 6 })).success).toBe(false);
		expect(Review.safeParse(review({ rating: 4.5 })).success).toBe(false);
	});
});

describe('RatingAggregate', () => {
	it('requires buckets to sum to the count', () => {
		expect(
			RatingAggregate.safeParse({
				productId: 'prod_1',
				average: 4.5,
				count: 2,
				buckets: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 },
			}).success,
		).toBe(true);

		expect(
			RatingAggregate.safeParse({
				productId: 'prod_1',
				average: 4.5,
				count: 5,
				buckets: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 },
			}).success,
		).toBe(false);
	});

	it('rejects a non-zero average with no reviews', () => {
		expect(RatingAggregate.safeParse({ productId: 'prod_1', average: 4.5, count: 0 }).success).toBe(false);
		expect(RatingAggregate.safeParse({ productId: 'prod_1', average: 0, count: 0 }).success).toBe(true);
	});
});
