import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AuditLog,
	MediaAsset,
	MediaProfile,
	MediaReplaceRequest,
	MediaReplaceStatus,
	MediaReplaceUpload,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type MediaAssetRepository,
	type MediaBrowseRepository,
	type MediaJobQueuePort,
	type MediaProfileRepository,
	MEDIA_INGEST_POLICY,
	type StoragePort,
	checkReplace,
	estimateVersionBytes,
	replacementOriginalKey,
} from '@saha-textile/core-domain';

import { domainRefusal } from '../auth/domain-refusal';
import {
	AUDIT_LOG_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_BROWSE_REPOSITORY,
	MEDIA_JOB_QUEUE,
	MEDIA_PROFILE_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';
import { fileName } from './media-library.service';
import { MediaStorageService } from './media-storage.service';

/** English fallbacks; the Media page names each refusal in its own words. */
const REFUSALS: Readonly<Record<string, string>> = {
	not_a_photo: 'Only photos can be replaced here',
	no_versions: 'This photo has no versions to remake',
	replacing: 'This photo is already being replaced',
	versions_making: 'Wait until this photo’s versions are made',
	photo_type_waits: 'Only JPEG and PNG photos can replace a photo now',
	type_not_accepted: 'Only JPEG and PNG photos are processed',
	too_large: 'The photo is over 25 MB',
	too_many_pixels: 'The photo is larger than 8192 px on its long edge or 50 megapixels',
	versions_refused: 'The new photo can’t make every version this photo has',
	not_uploading: 'There is no upload waiting to finish',
	not_cancellable: 'This Replace is already under way',
	focal_waits: 'Wait until this photo’s versions are made or its Replace is done',
};
const refuse = (code: string, detail?: string) =>
	domainRefusal(code, detail ? `${REFUSALS[code] ?? 'Not allowed'}: ${detail}` : (REFUSALS[code] ?? 'Not allowed'));

/**
 * Replace a photo (media step 3b; brief S7, C05, C08; S6's “Replace the existing file”, B12, B13). The new photo
 * uploads beside the old one; the worker remakes every version from it and swaps it in at once, so every page using
 * the photo switches together. The old files are kept 7 days (decision 11), then swept.
 */
@Injectable()
export class MediaReplaceService {
	constructor(
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(MEDIA_BROWSE_REPOSITORY) private readonly files: Pick<MediaBrowseRepository, 'whereUsed'>,
		@Inject(MEDIA_PROFILE_REPOSITORY) private readonly profiles: Pick<MediaProfileRepository, 'findByKey'>,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		@Inject(MEDIA_JOB_QUEUE) private readonly queue: MediaJobQueuePort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		private readonly storageCheck: MediaStorageService,
	) {}

	/**
	 * Starts a Replace (C05 → C08 step 1): the new photo is checked against every version before a byte moves, the
	 * storage check counts it and every version to remake, and an upload address beside the old original comes back.
	 */
	async start(
		actor: string,
		id: string,
		request: MediaReplaceRequest,
		now = new Date(),
	): Promise<MediaReplaceUpload> {
		const asset = await this.photo(id);
		const profiles = new Map<string, MediaProfile>();
		for (const key of new Set((asset.versions ?? []).map((version) => version.profileKey))) {
			const profile = await this.profiles.findByKey(key);
			if (profile) profiles.set(key, profile);
		}
		const check = checkReplace({ asset, profiles, photo: request });
		if (check.refusal) {
			throw refuse(check.refusal, check.versions.map((row) => `${row.versionId} (${row.refusal})`).join(', '));
		}
		const versions = asset.versions?.length ?? 0;
		const bytes = request.byteSize + estimateVersionBytes(request.byteSize, versions);
		await this.storageCheck.admit(actor, bytes, request.reservationId, holdId(id), now);
		const key = replacementOriginalKey(id, request.contentType, now);
		const started = await this.assets.startReplace(id, {
			key,
			contentType: request.contentType,
			byteSize: request.byteSize,
			width: request.width,
			height: request.height,
			sha256: request.sha256 ?? null,
			phase: 'uploading',
			reason: 'replace',
			made: 0,
			total: 0,
			error: null,
			startedAt: now.toISOString(),
			by: actor,
		});
		if (!started) {
			await this.storageCheck.release(holdId(id));
			throw refuse('replacing');
		}
		const ttl = MEDIA_INGEST_POLICY.uploadUrlTtlSeconds;
		const signed = await this.storage.createSignedUploadUrl({
			key,
			contentType: request.contentType,
			expiresInSeconds: ttl,
			visibility: 'private',
		});
		return {
			uploadUrl: signed.url,
			headers: signed.headers ?? {},
			expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
		};
	}

	/**
	 * A photo's focal point (S10, C06): saved, then its Crop versions are remade around it (new files; the old ones
	 * are kept 7 days). Other versions and the original are untouched. A photo with no Crop version just keeps the
	 * point for crops made later.
	 */
	async setFocal(
		actor: string,
		id: string,
		focal: { x: number; y: number } | null,
		now = new Date(),
	): Promise<MediaReplaceStatus> {
		const asset = await this.photo(id);
		if (asset.kind !== 'image' || !asset.originalStorageKey) throw refuse('not_a_photo');
		const versions = asset.versions ?? [];
		if (
			(asset.replacing && asset.replacing.phase !== 'failed') ||
			versions.some((version) => version.state === 'making')
		) {
			throw refuse('focal_waits');
		}
		await this.assets.setFocal(id, focal);
		await this.record(actor, 'media.focal', { name: fileName(asset), focal }, id);
		const crops = versions.filter((version) => version.fill === 'crop');
		if (!crops.length || !asset.width || !asset.height) return this.status(id);
		await this.storageCheck.admit(
			actor,
			estimateVersionBytes(asset.originalByteSize, crops.length),
			undefined,
			holdId(id),
			now,
		);
		const started = await this.assets.startReplace(id, {
			key: asset.originalStorageKey,
			contentType: asset.originalFormat,
			byteSize: asset.originalByteSize,
			width: asset.width,
			height: asset.height,
			sha256: asset.sha256 ?? null,
			phase: 'queued',
			reason: 'focal',
			made: 0,
			total: 0,
			error: null,
			startedAt: now.toISOString(),
			by: actor,
		});
		await this.storageCheck.release(holdId(id));
		if (!started) throw refuse('focal_waits');
		await this.queue.enqueue({ type: 'replace', assetId: id });
		return this.status(id);
	}

	/** The upload finished (C08 step 2 starts): the worker takes it from here. */
	async finish(actor: string, id: string): Promise<MediaReplaceStatus> {
		const asset = await this.assets.moveReplace(id, ['uploading'], { phase: 'queued' });
		if (!asset?.replacing) throw refuse('not_uploading');
		await this.queue.enqueue({ type: 'replace', assetId: id });
		await this.storageCheck.release(holdId(id));
		await this.record(
			actor,
			'media.replace',
			{ name: fileName(asset), bytes: asset.replacing.byteSize, versions: (asset.versions ?? []).length },
			id,
		);
		return this.status(id);
	}

	/** C08: where the Replace has got. `done` when nothing is running (it finished, or there was none). */
	async status(id: string): Promise<MediaReplaceStatus> {
		const asset = await this.assets.findById(id);
		if (!asset || asset.deletedAt) throw new NotFoundException('File not found');
		const places = ((await this.files.whereUsed([id])).get(id) ?? []).length;
		const next = asset.replacing;
		// Done: every size the photo now has was made by the Replace, so that is the count C08 ends on.
		if (!next) {
			const sizes = asset.derivatives.length;
			return { phase: 'done', made: sizes, total: sizes, error: null, places };
		}
		return { phase: next.phase, made: next.made, total: next.total, error: next.error, places };
	}

	/** Stops a Replace still uploading, or clears one that failed; the new photo's bytes go. */
	async cancel(id: string): Promise<void> {
		const asset = await this.assets.findById(id);
		if (!asset || asset.deletedAt) throw new NotFoundException('File not found');
		const key = asset.replacing?.key;
		const cleared = await this.assets.moveReplace(id, ['uploading', 'failed'], null);
		if (!cleared) {
			if (!asset.replacing) return;
			throw refuse('not_cancellable');
		}
		if (key) await this.storage.delete(key).catch(() => undefined);
		await this.storageCheck.release(holdId(id));
	}

	private async photo(id: string): Promise<MediaAsset> {
		const asset = await this.assets.findById(id);
		if (!asset || asset.deletedAt || asset.trashedAt) throw new NotFoundException('File not found');
		return asset;
	}

	private async record(actor: string, action: string, metadata: Record<string, unknown>, entityId: string) {
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor === 'system' ? null : actor,
			targetUserId: null,
			audience: actor === 'system' ? 'system' : 'admin',
			action,
			entityType: 'media',
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
}

/** The storage hold a Replace runs under, given back when the upload finishes or is cancelled. */
const holdId = (id: string) => `res_replace_${id}`;
