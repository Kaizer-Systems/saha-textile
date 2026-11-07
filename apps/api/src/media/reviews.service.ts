import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type {
	AdminReviewListQuery,
	AdminReviewListResponse,
	MediaPresignResponse,
	Review,
	ReviewModerationRequest,
	ReviewPhotoPresignRequest,
	ReviewSubmitRequest,
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
	checkReviewPhotos,
	discardReviewPhotos,
	publishReviewPhotos,
	reviewPhotoSlug,
} from '@saha-textile/core-domain';

import { mediaRefusal } from './media-refusal';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	CUSTOMER_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_JOB_QUEUE,
	ORDER_REPOSITORY,
	PRODUCT_REPOSITORY,
	REVIEW_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';
import { MediaService } from './media.service';

const REVIEWABLE_ORDER_STATUSES = new Set(['delivered']);
const REVIEW_PHOTO_ALT: Record<string, string> = { en: 'customer photo', fr: 'photo client' };

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

	async submit(customerId: string, request: ReviewSubmitRequest): Promise<Review> {
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

		const moderated = await this.reviews.moderate({
			reviewId,
			status: request.decision === 'approve' ? 'approved' : 'rejected',
			moderatedByUserId: actorId,
			moderatedAt: new Date().toISOString(),
			note: request.note ?? undefined,
			...(request.decision === 'reject' ? { imageAssetIds: [] } : {}),
		});
		await this.reviews.recomputeAggregate(review.productId);
		if (!moderated) throw new NotFoundException('No such review');
		return moderated;
	}

	/** Thumb and full URLs per photo: public when approved, short-lived signed while private. */
	private async previews(assetIds: readonly string[]) {
		const assets = await this.assets.findManyByIds(assetIds);
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
