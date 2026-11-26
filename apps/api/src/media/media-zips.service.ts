import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AuditLog,
	MediaFileAddress,
	MediaZip,
	MediaZipList,
	MediaZipPlan,
	MediaZipRequest,
} from '@saha-textile/contracts';
import {
	ZIP_KEEP_HOURS,
	publicZip,
	zipContents,
	zipPlan,
	zipStorageKey,
	type AuditLogRepository,
	type MediaAssetRepository,
	type MediaBrowseRepository,
	type MediaFolderRepository,
	type MediaJobQueuePort,
	type MediaZipRecord,
	type MediaZipRepository,
	type StorageLedgerRepository,
	type StoragePort,
} from '@saha-textile/core-domain';

import {
	AUDIT_LOG_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_BROWSE_REPOSITORY,
	MEDIA_FOLDER_REPOSITORY,
	MEDIA_JOB_QUEUE,
	MEDIA_ZIP_REPOSITORY,
	STORAGE_LEDGER_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';
import { mediaRefusal } from './media-refusal';
import { MediaStorageService } from './media-storage.service';

/** How long a download link works once asked for: the five-minute hand-over Media uses everywhere. */
const LINK_SECONDS = 300;
/** The tray lists a person's .zip files from this far back: a ready one's whole 24 hours, and a little more. */
const LIST_HOURS = ZIP_KEEP_HOURS + 2;

/**
 * Folder downloads as .zip (media step 5; brief A30, A30B, A48). The plan answers what a .zip would hold, so the
 * Media page can run the storage check (R4-7); the .zip is then made by the worker and counts against storage, under
 * a hold of its own, for the 24 hours it is kept. Each person sees, cancels and downloads only their own.
 */
@Injectable()
export class MediaZipsService {
	constructor(
		@Inject(MEDIA_ZIP_REPOSITORY) private readonly zips: MediaZipRepository,
		@Inject(MEDIA_FOLDER_REPOSITORY)
		private readonly folders: Pick<MediaFolderRepository, 'findManyByIds' | 'findById' | 'listSubtree'>,
		@Inject(MEDIA_BROWSE_REPOSITORY) private readonly browse: Pick<MediaBrowseRepository, 'listInFolders'>,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: Pick<MediaAssetRepository, 'findManyByIds'>,
		@Inject(STORAGE_PORT) private readonly storage: Pick<StoragePort, 'createSignedDownloadUrl'>,
		@Inject(STORAGE_LEDGER_REPOSITORY)
		private readonly ledger: Pick<StorageLedgerRepository, 'reserve' | 'release'>,
		@Inject(MEDIA_JOB_QUEUE) private readonly queue: MediaJobQueuePort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		private readonly storageCheck: MediaStorageService,
	) {}

	/** What a .zip of these would hold: its name, files and bytes, for the storage check. */
	async plan(pick: { fileIds: readonly string[]; folderIds: readonly string[] }): Promise<MediaZipPlan> {
		return zipPlan(await zipContents(this.sources(), pick));
	}

	/** Starts a .zip: the storage check's hold covers it (or the check runs now), then the worker makes it. */
	async create(userId: string, request: MediaZipRequest, now = new Date()): Promise<MediaZip> {
		const plan = zipPlan(await zipContents(this.sources(), request));
		if (plan.files === 0) {
			throw mediaRefusal(HttpStatus.UNPROCESSABLE_ENTITY, 'zip_empty', 'There is nothing to put in a .zip here.');
		}
		const id = `zip_${randomUUID()}`;
		await this.storageCheck.admit(userId, plan.bytes, request.reservationId, id, now);
		// The .zip is stored for its 24 hours: it keeps a hold of its own until the sweep deletes it.
		const until = new Date(now.getTime() + (ZIP_KEEP_HOURS + 1) * 3_600_000).toISOString();
		await this.ledger.reserve({ id, userId, bytes: plan.bytes, expiresAt: until });
		if (request.reservationId) await this.ledger.release(request.reservationId);
		const record: MediaZipRecord = {
			id,
			name: plan.name,
			state: 'adding',
			files: { done: 0, total: plan.files },
			bytes: { done: 0, total: plan.bytes },
			createdAt: now.toISOString(),
			readyAt: null,
			expiresAt: null,
			error: null,
			userId,
			fileIds: [...request.fileIds],
			folderIds: [...request.folderIds],
			storageKey: zipStorageKey(id),
		};
		await this.zips.create(record);
		await this.queue.enqueue({ type: 'zip', zipId: id });
		await this.record(userId, 'media.zip.create', id, { name: plan.name, files: plan.files, bytes: plan.bytes });
		return publicZip(record);
	}

	async list(userId: string, now = new Date()): Promise<MediaZipList> {
		const since = new Date(now.getTime() - LIST_HOURS * 3_600_000).toISOString();
		return { zips: (await this.zips.listForUser(userId, since)).map(publicZip) };
	}

	async get(userId: string, id: string): Promise<MediaZip> {
		return publicZip(await this.own(userId, id));
	}

	/** Stops a .zip being made: the worker stops at the next file and keeps nothing. */
	async cancel(userId: string, id: string): Promise<MediaZip> {
		const zip = await this.own(userId, id);
		if (zip.state !== 'adding') return publicZip(zip);
		await this.zips.setState(id, 'cancelled');
		await this.record(userId, 'media.zip.cancel', id, { name: zip.name });
		return publicZip({ ...zip, state: 'cancelled' });
	}

	/** A five-minute link that saves the .zip under its name, while it is kept. */
	async link(userId: string, id: string, now = new Date()): Promise<MediaFileAddress> {
		const zip = await this.own(userId, id);
		if (zip.state !== 'ready' || !zip.expiresAt || zip.expiresAt <= now.toISOString()) {
			throw mediaRefusal(HttpStatus.GONE, 'zip_not_ready', 'This .zip is not ready, or its 24 hours are over.');
		}
		const url = await this.storage.createSignedDownloadUrl({
			key: zip.storageKey,
			expiresInSeconds: LINK_SECONDS,
			fileName: zip.name,
			disposition: 'attachment',
		});
		return { url };
	}

	/** A person's own .zip; someone else's answers as not found, so its id tells nothing. */
	private async own(userId: string, id: string): Promise<MediaZipRecord> {
		const zip = await this.zips.find(id);
		if (!zip || zip.userId !== userId) throw new NotFoundException('No such .zip');
		return zip;
	}

	private sources() {
		return { folders: this.folders, browse: this.browse, assets: this.assets };
	}

	private async record(actor: string, action: string, entityId: string, metadata: Record<string, unknown>) {
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor,
			targetUserId: null,
			audience: 'admin',
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
