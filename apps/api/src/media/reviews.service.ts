import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type {
	AdminReviewListQuery,
	AdminReviewListResponse,
	MediaAsset,
	MediaPresignResponse,
	MyProductReview,
	ProductReviewsQuery,
	ProductReviewsResponse,
	Review,
	ReviewModerationRequest,
	ReviewPhoto,
	ReviewPhotoPresignRequest,
	ReviewSubmitRequest,
	ReviewUpdateRequest,
} from '@saha-textile/contracts';
import {
	MEDIA_INGEST_POLICY,
	type MediaAssetRepository,
	type MediaJobQueuePort,
	type CustomerRepository,
	type OrderRepository,
	type ProductRepository,
	type ReviewRepository,
	type StoragePort,
	type TransactionManagerPort,
	checkReviewPhotos,
	discardReviewPhotos,
	publishReviewPhotos,
	publicReviewerName,
	reviewPhotoSlug,
} from '@saha-textile/core-domain';

import { mediaRefusal } from './media-refusal';
import { localized } from '../catalog/catalog-locale';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	CUSTOMER_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_JOB_QUEUE,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
	REVIEW_REPOSITORY,
	STORAGE_PORT,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { MediaService } from './media.service';

const REVIEWABLE_ORDER_STATUSES = new Set(['delivered']);
const REVIEW_PHOTO_ALT: Record<string, string> = { en: 'customer photo', bn: 'গ্রাহকের ছবি' };

/**
 * Reviews with photos (owner log § Media → Review photos; § Reviews).
 *
 * Only a verified buyer may upload review photos at all — the upload path is not open image
 * hosting. Photos are processed private, shown to moderators through signed URLs, and become
 * public only on approval; a rejection deletes them and keeps the review text.
 */
@Injectable()
export class ReviewsService {
	constructor(
		@Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		@Inject(MEDIA_JOB_QUEUE) private readonly queue: MediaJobQueuePort,
		private readonly media: MediaService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Optional() @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort | null = null,
	) {}

	async presignPhoto(customerId: string, request: ReviewPhotoPresignRequest): Promise<MediaPresignResponse> {
		const product = await this.products.findById(request.productId);
		if (!product) throw new NotFoundException('No such product');
		if (!(await this.reviews.hasVerifiedPurchase({ userId: customerId, productId: request.productId }))) {
			throw mediaRefusal(
				HttpStatus.FORBIDDEN,
				'not_a_verified_buyer',
				'Only customers who bought this can add photos.',
			);
		}
		return this.media.presign(
			{ type: 'customer', id: customerId },
			{
				purpose: 'review',
				contentType: request.contentType,
				byteSize: request.byteSize,
				fileName: request.fileName,
				width: request.width,
				height: request.height,
				slug: reviewPhotoSlug(product.title.en),
			},
		);
	}

	/** Approved reviews for one live product, newest first, with the summary behind its stars. */
	async publicList(query: ProductReviewsQuery): Promise<ProductReviewsResponse> {
		const empty = { average: 0, count: 0, buckets: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
		const product = await this.products.findBySlug(query.productSlug, 'public');
		if (!product) return { summary: empty, items: [], total: 0, page: query.page, pageSize: query.pageSize };
		const [page, aggregate] = await Promise.all([
			this.reviews.listApprovedForProduct(product.id, { page: query.page, pageSize: query.pageSize }),
			this.reviews.getAggregate(product.id),
		]);
		const items = await Promise.all(
			page.items.map(async (review) => {
				const customer = await this.customers.findById(review.userId);
				return {
					id: review.id,
					rating: review.rating,
					title: review.title,
					body: review.body,
					authorName: publicReviewerName(customer?.displayName),
					createdAt: review.createdAt ?? null,
					photos: await this.photosOf(review.imageAssetIds, true),
				};
			}),
		);
		const summary = aggregate
			? {
					average: aggregate.average,
					count: aggregate.count,
					buckets: { ...empty.buckets, ...aggregate.buckets },
				}
			: empty;
		return { summary, items, total: page.total, page: page.page, pageSize: page.pageSize };
	}

	/** What this customer may do on one product page: review, wait for delivery, or edit. */
	async mine(customerId: string, productId: string): Promise<MyProductReview> {
		const own = await this.reviews.findByUserAndProduct({ userId: customerId, productId });
		if (own) {
			return {
				state: 'reviewed',
				review: {
					id: own.id,
					rating: own.rating,
					title: own.title,
					body: own.body,
					status: own.status,
					createdAt: own.createdAt ?? null,
					photos: await this.photosOf(own.imageAssetIds, false),
				},
			};
		}
		const orderId = await this.reviews.findReviewableOrderId({ userId: customerId, productId });
		return orderId ? { state: 'can_review', orderId } : { state: 'needs_delivery' };
	}

	/**
	 * The author's edit goes back to moderation (owner decision 2026-11-08). Photos dropped from
	 * the review are deleted; new ones must be the customer's own processed uploads. When the
	 * review was approved, the public rating is recomputed in the same step.
	 */
	async update(customerId: string, reviewId: string, request: ReviewUpdateRequest): Promise<Review> {
		const current = await this.reviews.findById(reviewId);
		if (!current || current.userId !== customerId) throw new NotFoundException('No such review');
		const kept = new Set(current.imageAssetIds);
		const added = request.imageAssetIds.filter((id) => !kept.has(id));
		if (added.length) {
			const photos = await checkReviewPhotos({ assets: this.assets }, { customerId, assetIds: added });
			if (photos.refusal) {
				throw mediaRefusal(
					HttpStatus.UNPROCESSABLE_ENTITY,
					`photos_${photos.refusal}`,
					'One of the photos cannot be attached.',
				);
			}
		}
		const next = [...new Set(request.imageAssetIds)];
		const dropped = current.imageAssetIds.filter((id) => !next.includes(id));
		if (dropped.length) {
			await discardReviewPhotos({ assets: this.assets, storage: this.storage, queue: this.queue }, dropped);
		}
		const save = async () => {
			const saved = await this.reviews.updateByAuthor({
				reviewId,
				userId: customerId,
				rating: request.rating,
				title: request.title,
				body: request.body,
				imageAssetIds: next,
			});
			if (!saved) throw new NotFoundException('No such review');
			if (current.status === 'approved') await this.reviews.recomputeAggregate(current.productId);
			return saved;
		};
		return this.transactions ? this.transactions.withTransaction(save) : save();
	}

	async submit(customerId: string, request: ReviewSubmitRequest): Promise<Review> {
		if (await this.reviews.findByUserAndProduct({ userId: customerId, productId: request.productId })) {
			throw mediaRefusal(HttpStatus.CONFLICT, 'already_reviewed', 'You have already reviewed this product.');
		}
		const order = await this.orders.findById(request.orderId);
		const bought =
			order &&
			order.userId === customerId &&
			REVIEWABLE_ORDER_STATUSES.has(order.status) &&
			order.lines.some((line) => line.productId === request.productId);
		if (!bought)
			throw mediaRefusal(HttpStatus.FORBIDDEN, 'not_a_verified_buyer', 'Only a delivered order can be reviewed.');

		const photos = await checkReviewPhotos(
			{ assets: this.assets },
			{ customerId, assetIds: request.imageAssetIds },
		);
		if (photos.refusal) {
			throw mediaRefusal(
				HttpStatus.UNPROCESSABLE_ENTITY,
				`photos_${photos.refusal}`,
				'One of the photos cannot be attached.',
			);
		}

		// Alt text is generated for every active locale and names the product, never the customer.
		const product = await this.products.findById(request.productId);
		const alt = Object.fromEntries(
			this.config.locales.map((locale) => {
				const name = product?.title[locale] || product?.title.en || '';
				const label = REVIEW_PHOTO_ALT[locale] ?? REVIEW_PHOTO_ALT.en;
				return [locale, `${name} — ${label}`.replace(/^ — /, '')];
			}),
		);
		for (const asset of photos.assets) await this.assets.update({ ...asset, text: { ...asset.text, alt } });

		const review: Review = {
			id: `rev_${randomUUID()}`,
			productId: request.productId,
			userId: customerId,
			orderId: request.orderId,
			rating: request.rating,
			title: request.title,
			body: request.body,
			imageAssetIds: [...new Set(request.imageAssetIds)],
			status: 'pending',
			moderatedByUserId: null,
			moderatedAt: null,
			moderationNote: null,
			createdAt: new Date().toISOString(),
		};
		return this.reviews.create(review);
	}

	async adminList(query: AdminReviewListQuery): Promise<AdminReviewListResponse> {
		const page = await this.reviews.list({
			status: query.status,
			productId: query.productId,
			page: query.page,
			pageSize: query.pageSize,
		});
		const items = await Promise.all(
			page.items.map(async (review) => {
				const [product, customer] = await Promise.all([
					this.products.findById(review.productId, 'admin'),
					this.customers.findById(review.userId),
				]);
				return {
					review,
					productName: product?.title.en ?? null,
					customerName: customer?.displayName ?? customer?.email ?? null,
					photos: await this.previews(review.imageAssetIds),
				};
			}),
		);
		return { items, total: page.total, page: page.page, pageSize: page.pageSize };
	}

	async moderate(actorId: string, reviewId: string, request: ReviewModerationRequest): Promise<Review> {
		const review = await this.reviews.findById(reviewId);
		if (!review) throw new NotFoundException('No such review');
		const deps = { assets: this.assets, storage: this.storage, queue: this.queue };
		if (request.decision === 'approve') await publishReviewPhotos(deps, review.imageAssetIds);
		else await discardReviewPhotos(deps, review.imageAssetIds);

		// The decision and the rating it changes commit together, so the public rating never
		// disagrees with the approved reviews behind it.
		const decide = async () => {
			const moderated = await this.reviews.moderate({
				reviewId,
				status: request.decision === 'approve' ? 'approved' : 'rejected',
				moderatedByUserId: actorId,
				moderatedAt: new Date().toISOString(),
				note: request.note ?? undefined,
				...(request.decision === 'reject' ? { imageAssetIds: [] } : {}),
			});
			if (!moderated) throw new NotFoundException('No such review');
			await this.reviews.recomputeAggregate(review.productId);
			return moderated;
		};
		return this.transactions ? this.transactions.withTransaction(decide) : decide();
	}

	/**
	 * Photos for the shop. `publicOnly` drops anything not yet approved, so a public read can
	 * never hand out a signed link; the author's own view gets signed previews of pending photos.
	 */
	private async photosOf(assetIds: readonly string[], publicOnly: boolean): Promise<ReviewPhoto[]> {
		if (!assetIds.length) return [];
		const assets = await this.assets.findManyByIds(assetIds);
		const shown = publicOnly ? assets.filter((asset) => asset.visibility === 'public') : assets;
		const previews = await this.previewsOf(shown);
		return previews.map((preview) => {
			const asset = shown.find((row) => row.id === preview.assetId);
			return { ...preview, alt: asset ? localized(asset.text.alt) : '' };
		});
	}

	/** Thumb and full URLs per photo: public when approved, short-lived signed while private. */
	private async previews(assetIds: readonly string[]) {
		return this.previewsOf(await this.assets.findManyByIds(assetIds));
	}

	private async previewsOf(assets: readonly MediaAsset[]) {
		return Promise.all(
			assets.map(async (asset) => {
				const pick = (role: string) =>
					[...asset.derivatives]
						.filter((derivative) => derivative.role === role)
						.sort((a, b) => b.width - a.width)[0];
				const url = async (role: string) => {
					const derivative = pick(role);
					if (!derivative) return null;
					return asset.visibility === 'public'
						? this.storage.getUrl(derivative.storageKey)
						: this.storage.createSignedDownloadUrl({
								key: derivative.storageKey,
								expiresInSeconds: MEDIA_INGEST_POLICY.signedPreviewTtlSeconds,
							});
				};
				return { assetId: asset.id, thumbUrl: await url('review_thumb'), fullUrl: await url('review_full') };
			}),
		);
	}
}
