import { randomUUID } from 'node:crypto';

import {
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	type OnApplicationBootstrap,
	UnprocessableEntityException,
} from '@nestjs/common';
import type {
	AuditLog,
	MediaAsset,
	MediaAssetTextUpdate,
	MediaLibraryItem,
	MediaLibraryQuery,
	MediaLibraryResponse,
	MediaPresignRequest,
	MediaPresignResponse,
	MediaPurpose,
	MediaRoleDefinition,
	MediaRoleUpdate,
	MediaUploadRules,
	MediaUploadStatus,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	MEDIA_INGEST_POLICY,
	type MediaAssetRepository,
	type MediaJobQueuePort,
	type MediaRoleRepository,
	SEEDED_MEDIA_ROLES,
	type StoragePort,
	checkIngest,
	mediaSlug,
	originalStorageKey,
	resolveImage,
	staleRolesOf,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	AUDIT_LOG_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_JOB_QUEUE,
	MEDIA_ROLE_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';

/** Who is uploading: an operator in admin, or a customer attaching review photos. */
export type MediaUploader = { type: 'admin'; id: string } | { type: 'customer'; id: string };

const REFUSAL_MESSAGES: Record<string, string> = {
	type_not_accepted: 'Upload a JPEG or PNG image.',
	too_large: 'The file is larger than 25 MB.',
	too_many_pixels: 'The image is larger than 8000 px on its long edge or 50 megapixels.',
	below_minimum: 'Product and category photos need at least 1600 px on the short edge.',
};

/**
 * The media library and upload lifecycle (owner log § Media).
 *
 * Upload: presign (policy checked against the browser-decoded size, original written
 * private) → the browser PUTs straight to Spaces → finalize (queues processing) → the worker
 * decodes, validates again, and renders every role → the uploader polls status.
 */
@Injectable()
export class MediaService implements OnApplicationBootstrap {
	private readonly logger = new Logger(MediaService.name);

	constructor(
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(MEDIA_ROLE_REPOSITORY) private readonly roles: MediaRoleRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		@Inject(MEDIA_JOB_QUEUE) private readonly queue: MediaJobQueuePort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	/** Seeds missing roles; never overwrites an operator's edits. Non-fatal without Mongo. */
	async onApplicationBootstrap(): Promise<void> {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1') return;
		try {
			const inserted = await this.roles.insertMissing(SEEDED_MEDIA_ROLES);
			if (inserted > 0) this.logger.log(`Seeded ${inserted} media role(s)`);
		} catch (error) {
			this.logger.warn(`Media roles not seeded (${(error as Error).message})`);
		}
	}

	uploadRules(): MediaUploadRules {
		const policy = MEDIA_INGEST_POLICY;
		return {
			maxBytes: policy.maxBytes,
			maxLongEdge: policy.maxLongEdge,
			maxMegapixels: policy.maxMegapixels,
			minShortEdge: { ...policy.minShortEdge },
			aspectWarnTolerance: policy.aspectWarnTolerance,
			targetAspect: { ...policy.targetAspect },
			reviewWarnBelowLongEdge: policy.reviewWarnBelowLongEdge,
			maxReviewPhotos: policy.maxReviewPhotos,
			acceptedTypes: [...policy.acceptedTypes],
		};
	}

	/** Creates the asset record and a presigned PUT for its private original. */
	async presign(
		uploader: MediaUploader,
		request: Omit<MediaPresignRequest, 'kind'> & { slug?: string },
	): Promise<MediaPresignResponse> {
		const check = checkIngest({
			purpose: request.purpose,
			contentType: request.contentType,
			byteSize: request.byteSize,
			width: request.width,
			height: request.height,
		});
		if (check.refusal) {
			throw new UnprocessableEntityException({
				code: check.refusal.code,
				message: REFUSAL_MESSAGES[check.refusal.code],
			});
		}

		const id = `med_${randomUUID()}`;
		const asset: MediaAsset = {
			id,
			kind: 'image',
			purpose: request.purpose,
			originalStorageKey: originalStorageKey(id, request.contentType),
			originalFormat: request.contentType,
			originalByteSize: request.byteSize,
			width: request.width,
			height: request.height,
			slug: request.slug ?? mediaSlug(request.fileName),
			derivatives: [],
			dominantColor: null,
			thumbHash: null,
			// Customer uploads are quarantined until a moderator approves them.
			visibility: uploader.type === 'customer' ? 'private' : 'public',
			processing: { state: 'awaiting_upload', attempts: 0, error: null, processedAt: null },
			warnings: check.warnings,
			servesAsPrimary: false,
			maxDisplayWidth: request.maxDisplayWidth ?? null,
			renditions: [],
			hlsPlaylistKey: null,
			durationSeconds: null,
			text: { alt: {}, title: {}, caption: {} },
			status: 'draft',
			uploadedBy: uploader,
			deletedAt: null,
		};
		await this.assets.create(asset);

		const ttl = MEDIA_INGEST_POLICY.uploadUrlTtlSeconds;
		const signed = await this.storage.createSignedUploadUrl({
			key: asset.originalStorageKey ?? '',
			contentType: request.contentType,
			expiresInSeconds: ttl,
			visibility: 'private',
		});
		return {
			assetId: id,
			uploadUrl: signed.url,
			headers: signed.headers ?? {},
			expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
			warnings: check.warnings,
		};
	}

	/** The browser finished its PUT: queue processing. Idempotent per asset. */
	async finalize(uploader: MediaUploader, assetId: string): Promise<MediaUploadStatus> {
		const asset = await this.ownedAsset(uploader, assetId);
		if (asset.processing.state === 'awaiting_upload') {
			await this.assets.update({ ...asset, processing: { ...asset.processing, state: 'queued' } });
			await this.queue.enqueue({ type: 'process', assetId });
		}
		return this.status(uploader, assetId);
	}

	async status(uploader: MediaUploader, assetId: string): Promise<MediaUploadStatus> {
		const asset = await this.ownedAsset(uploader, assetId);
		return {
			assetId,
			state: asset.processing.state,
			error: asset.processing.error,
			warnings: asset.warnings,
			previewUrl: await this.previewUrl(asset),
		};
	}

	async library(query: MediaLibraryQuery): Promise<MediaLibraryResponse> {
		const page = await this.assets.list({
			kind: 'image',
			purpose: query.purpose,
			search: query.search,
			page: query.page,
			pageSize: query.pageSize,
		});
		const versions = await this.roleVersions();
		const items = await Promise.all(page.items.map((asset) => this.libraryItem(asset, versions)));
		return { items, total: page.total, page: page.page, pageSize: page.pageSize };
	}

	async get(assetId: string): Promise<MediaLibraryItem> {
		return this.libraryItem(await this.requireAsset(assetId), await this.roleVersions());
	}

	/** SEO identity edits. A new slug renames every derivative, so it queues a reprocess. */
	async updateText(actorId: string, assetId: string, update: MediaAssetTextUpdate): Promise<MediaLibraryItem> {
		const asset = await this.requireAsset(assetId);
		const slugChanged = update.slug !== undefined && update.slug !== asset.slug;
		const next: MediaAsset = {
			...asset,
			slug: update.slug ?? asset.slug,
			text: {
				alt: update.alt ?? asset.text.alt,
				title: update.title ?? asset.text.title,
				caption: update.caption ?? asset.text.caption,
			},
		};
		await this.assets.update(next);
		if (slugChanged && asset.processing.state === 'ready') {
			await this.queue.enqueue({ type: 'reprocess', assetId, reason: 'slug' });
		}
		await this.record(actorId, 'media.asset.text.update', assetId, { slugChanged });
		return this.get(assetId);
	}

	async reprocess(actorId: string, assetId: string): Promise<MediaLibraryItem> {
		const asset = await this.requireAsset(assetId);
		if (!asset.originalStorageKey) {
			throw new ConflictException('This image has no retained original to regenerate from.');
		}
		await this.queue.enqueue({ type: 'reprocess', assetId, reason: 'manual' });
		await this.record(actorId, 'media.asset.reprocess', assetId, {});
		return this.get(assetId);
	}

	/**
	 * Library delete. Refused while anything still uses the asset; otherwise a soft delete —
	 * the daily GC removes the files after the 30-day grace, so a mistaken delete is undoable.
	 */
	async remove(actorId: string, assetId: string): Promise<void> {
		await this.requireAsset(assetId);
		const usage = await this.assets.countReferences(assetId);
		if (usage > 0) {
			throw new ConflictException({ code: 'in_use', message: `This image is used in ${usage} place(s).` });
		}
		await this.assets.softDelete(assetId, new Date().toISOString());
		await this.record(actorId, 'media.asset.delete', assetId, {});
	}

	listRoles(): Promise<MediaRoleDefinition[]> {
		return this.roles.list();
	}

	/**
	 * Ladder edit. Changing widths or quality bumps the role's version, which marks every
	 * derivative of the old version stale; the 15-minute sweep then reprocesses them in
	 * batches, deleting and purging the old files as it goes (owner lock 4.2).
	 */
	async updateRole(actorId: string, key: string, update: MediaRoleUpdate): Promise<MediaRoleDefinition> {
		const role = await this.roles.findByKey(key);
		if (!role) throw new NotFoundException('No such media role');
		const sameWidths =
			!update.widths ||
			[...update.widths].sort((a, b) => a - b).join() === [...role.widths].sort((a, b) => a - b).join();
		const sameQuality = update.quality === undefined || update.quality === role.quality;
		const next: MediaRoleDefinition = {
			...role,
			label: update.label ?? role.label,
			widths: update.widths ? [...new Set(update.widths)].sort((a, b) => a - b) : role.widths,
			quality: update.quality ?? role.quality,
			version: sameWidths && sameQuality ? role.version : role.version + 1,
		};
		await this.roles.save(next);
		await this.record(actorId, 'media.role.update', key, {
			from: role.widths,
			to: next.widths,
			version: next.version,
		});
		return next;
	}

	private async libraryItem(asset: MediaAsset, versions: ReadonlyMap<string, number>): Promise<MediaLibraryItem> {
		return {
			asset,
			preview: resolveImage({
				asset,
				getUrl: (key) => this.storage.getUrl(key),
				locale: 'en',
				fallbackLocale: 'en',
			}),
			usageCount: await this.assets.countReferences(asset.id),
			staleRoles: staleRolesOf(asset, versions),
		};
	}

	/** Smallest visual: a public thumbnail, or a short-lived signed one for a private photo. */
	private async previewUrl(asset: MediaAsset): Promise<string | null> {
		const order = ['thumb', 'review_thumb', 'card', 'banner', 'blog', 'category_icon', 'avatar'];
		const candidates = [...asset.derivatives].sort(
			(a, b) => (order.indexOf(a.role) + 1 || 99) - (order.indexOf(b.role) + 1 || 99) || b.width - a.width,
		);
		const pick = candidates[0];
		if (!pick) return null;
		if (asset.visibility === 'public') return this.storage.getUrl(pick.storageKey);
		return this.storage.createSignedDownloadUrl({
			key: pick.storageKey,
			expiresInSeconds: MEDIA_INGEST_POLICY.signedPreviewTtlSeconds,
		});
	}

	/** BOLA: a customer can only see or finalize an upload they started. */
	private async ownedAsset(uploader: MediaUploader, assetId: string): Promise<MediaAsset> {
		const asset = await this.assets.findById(assetId);
		const owned =
			asset &&
			(uploader.type === 'admin'
				? asset.uploadedBy?.type !== 'customer'
				: asset.uploadedBy?.type === 'customer' && asset.uploadedBy.id === uploader.id);
		if (!asset || !owned) throw new NotFoundException('No such upload');
		return asset;
	}

	private async requireAsset(assetId: string): Promise<MediaAsset> {
		const asset = await this.assets.findById(assetId);
		if (!asset || asset.deletedAt) throw new NotFoundException('No such media asset');
		return asset;
	}

	private async roleVersions(): Promise<Map<string, number>> {
		return new Map((await this.roles.list()).map((role) => [role.key, role.version]));
	}

	private async record(actorId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actorId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'mediaAsset',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}

	/** Purposes an operator may upload from the admin library. */
	static readonly ADMIN_PURPOSES: readonly MediaPurpose[] = [
		'product',
		'category',
		'banner',
		'blog',
		'avatar',
		'icon',
	];

	/** For tests and health: the active locale list. */
	get activeLocales(): string[] {
		return this.config.locales;
	}
}
