import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AuditLog,
	MediaAsset,
	MediaProfile,
	MediaProfileRefresh,
	MediaProfileRefreshStarted,
	MediaReplaceRequest,
	MediaReplaceStatus,
	MediaReplaceUpload,
	MediaVersion,
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
	olderVersions,
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
const REFUSALS = {
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
	rename_waits: 'Wait until this photo’s versions are made or its Replace is done, then change its web file name',
} as const;
type RefusalCode = keyof typeof REFUSALS;
/** Every refusal has its own words: checkReplace answers only codes listed here. */
const refuse = (code: RefusalCode, detail?: string) =>
	domainRefusal(code, detail ? `${REFUSALS[code]}: ${detail}` : REFUSALS[code]);

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
			throw refuse(
				check.refusal as RefusalCode,
				check.versions.map((row) => `${row.versionId} (${row.refusal})`).join(', '),
			);
		}
		// checkReplace refuses a photo without versions, so it has its list here.
		const versions = (asset.versions as MediaVersion[]).length;
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

	/**
	 * Whether a new web file name goes through the Replace machinery (R5-6): a photo with versions. Refused while its
	 * versions are being made or a Replace runs, before anything is saved.
	 */
	renames(asset: MediaAsset): boolean {
		if (asset.kind !== 'image' || !asset.originalStorageKey || !(asset.versions ?? []).length) return false;
		if (
			(asset.replacing && asset.replacing.phase !== 'failed') ||
			// The line above returned for a photo without versions.
			(asset.versions as MediaVersion[]).some((version) => version.state === 'making')
		) {
			throw refuse('rename_waits');
		}
		return true;
	}

	/**
	 * A new web file name (R5-6): every file is made again under it from the same original, the pages switch when the
	 * new files are in place, and the old files are kept 7 days, as after a Replace. The name changes with the files.
	 */
	async rename(actor: string, id: string, slug: string, now = new Date()): Promise<MediaReplaceStatus> {
		const asset = await this.photo(id);
		if (!this.renames(asset) || !asset.originalStorageKey || !asset.width || !asset.height) {
			throw refuse('not_a_photo');
		}
		const bytes = asset.derivatives.reduce((sum, row) => sum + row.byteSize, 0);
		await this.storageCheck.admit(actor, bytes, undefined, holdId(id), now);
		const started = await this.assets.startReplace(id, {
			key: asset.originalStorageKey,
			contentType: asset.originalFormat,
			byteSize: asset.originalByteSize,
			width: asset.width,
			height: asset.height,
			sha256: asset.sha256 ?? null,
			phase: 'queued',
			reason: 'rename',
			slug,
			made: 0,
			total: 0,
			error: null,
			startedAt: now.toISOString(),
			by: actor,
		});
		await this.storageCheck.release(holdId(id));
		if (!started) throw refuse('rename_waits');
		await this.queue.enqueue({ type: 'replace', assetId: id });
		await this.record(actor, 'media.rename', { name: fileName(asset), from: asset.slug, to: slug }, id);
		return this.status(id);
	}

	/**
	 * “Bring older versions up to date” (F02), before it starts: the photos whose versions of this profile were made
	 * with earlier settings and that today's settings can still make, with an estimate of the bytes.
	 */
	async refreshPreview(key: string): Promise<MediaProfileRefresh> {
		const profile = await this.profile(key);
		let photos = 0;
		let versions = 0;
		let bytes = 0;
		await this.eachOlder(profile, async (asset, older) => {
			photos += 1;
			versions += older.length;
			bytes += estimateVersionBytes(asset.originalByteSize, older.length);
		});
		const counts = await this.assets.refreshCounts(profile.key, profile.version);
		return { photos, versions, bytes, running: counts.running, failed: counts.failed };
	}

	/**
	 * Starts bringing a profile's older versions up to date: one storage check for the whole run, then each photo runs
	 * like a Replace on its own original (only those versions are remade, the pages switch when each photo is done,
	 * the old files are kept 7 days). A photo busy with versions or a Replace is left for a later run.
	 */
	async refresh(actor: string, key: string, now = new Date()): Promise<MediaProfileRefreshStarted> {
		const profile = await this.profile(key);
		const preview = await this.refreshPreview(key);
		if (!preview.photos) return { started: 0, busy: 0 };
		const hold = `res_refresh_${profile.key}`;
		await this.storageCheck.admit(actor, preview.bytes, undefined, hold, now);
		let started = 0;
		let busy = 0;
		try {
			await this.eachOlder(profile, async (asset) => {
				if (!asset.originalStorageKey || !asset.width || !asset.height) return;
				const ok = await this.assets.startReplace(asset.id, {
					key: asset.originalStorageKey,
					contentType: asset.originalFormat,
					byteSize: asset.originalByteSize,
					width: asset.width,
					height: asset.height,
					sha256: asset.sha256 ?? null,
					phase: 'queued',
					reason: 'refresh',
					profileKey: profile.key,
					made: 0,
					total: 0,
					error: null,
					startedAt: now.toISOString(),
					by: actor,
				});
				if (!ok) {
					busy += 1;
					return;
				}
				started += 1;
				await this.queue.enqueue({ type: 'replace', assetId: asset.id });
			});
		} finally {
			await this.storageCheck.release(hold);
		}
		await this.record(actor, 'media.profile.refresh', { profile: profile.key, started, busy }, profile.key);
		return { started, busy };
	}

	private async profile(key: string): Promise<MediaProfile> {
		const profile = await this.profiles.findByKey(key);
		if (!profile) throw new NotFoundException('Image profile not found');
		return profile;
	}

	/** Every photo with versions of this profile that today's settings can make again, page by page. */
	private async eachOlder(
		profile: MediaProfile,
		visit: (asset: MediaAsset, older: MediaVersion[]) => Promise<void>,
	): Promise<void> {
		let after: string | null = null;
		for (;;) {
			const page = await this.assets.listWithOlderVersions({
				profileKey: profile.key,
				version: profile.version,
				after,
				limit: REFRESH_PAGE,
			});
			for (const asset of page) {
				const older = olderVersions(asset, profile);
				if (older.length) await visit(asset, older);
			}
			if (page.length < REFRESH_PAGE) return;
			// A full page has a last row.
			after = (page[page.length - 1] as MediaAsset).id;
		}
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

/** Photos read at a time while bringing a profile up to date. */
const REFRESH_PAGE = 200;

/** The storage hold a Replace runs under, given back when the upload finishes or is cancelled. */
const holdId = (id: string) => `res_replace_${id}`;
