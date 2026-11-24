import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AuditLog, EmailPictureList, EmailPictureQuery } from '@saha-textile/contracts';
import type {
	AdminUserRepository,
	AuditLogRepository,
	EmailPictureRepository,
	MediaJobQueuePort,
	StoragePort,
} from '@saha-textile/core-domain';

import {
	ADMIN_USER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	EMAIL_PICTURE_REPOSITORY,
	MEDIA_JOB_QUEUE,
	STORAGE_PORT,
} from '../infra/tokens';

/** Rows a page of Clean up › Email pictures holds. */
const PAGE = 100;

/**
 * Clean up › Email pictures (Media brief R6-1, A50, A51; media step 3f): the email pictures whose photo was deleted
 * or replaced, kept for good so order emails already sent keep their pictures. Nothing deletes them by itself; an
 * admin can, after the warning. Only recorded pictures can be deleted here, never one a photo still has.
 */
@Injectable()
export class EmailPicturesService {
	constructor(
		@Inject(EMAIL_PICTURE_REPOSITORY) private readonly pictures: EmailPictureRepository,
		@Inject(STORAGE_PORT) private readonly storage: Pick<StoragePort, 'getUrl'>,
		@Inject(MEDIA_JOB_QUEUE) private readonly queue: MediaJobQueuePort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
	) {}

	async list(query: EmailPictureQuery, now = new Date()): Promise<EmailPictureList> {
		const rows = await this.pictures.list({ sent: query.sent, now, after: query.after ?? null, limit: PAGE });
		const names = new Map<string, string | null>();
		for (const id of new Set(rows.map((row) => row.goneBy).filter((id): id is string => !!id))) {
			const admin = await this.admins.findById(id).catch(() => null);
			names.set(id, admin ? (admin.displayName ?? admin.username ?? admin.email ?? null) : null);
		}
		const [total, matching] = await Promise.all([
			this.pictures.totals(),
			this.pictures.count({ sent: query.sent, now }),
		]);
		return {
			rows: rows.map((row) => ({
				...row,
				url: this.storage.getUrl(row.key),
				goneByName: row.goneBy ? (names.get(row.goneBy) ?? null) : null,
			})),
			total,
			matching,
			// A full page has a last row.
			next: rows.length === PAGE ? (rows[rows.length - 1] as (typeof rows)[number]).key : null,
		};
	}

	/** A51: deletes the chosen pictures for good; only pictures recorded here, and who did it goes into Activity. */
	async remove(actor: string, keys: readonly string[]): Promise<{ deleted: number; bytes: number }> {
		const found = await this.pictures.findByKeys(keys);
		if (!found.length) return { deleted: 0, bytes: 0 };
		const gone = found.map((row) => row.key);
		await this.queue.enqueue({
			type: 'delete-objects',
			keys: gone,
			urls: gone.map((key) => this.storage.getUrl(key)),
		});
		await this.pictures.remove(gone);
		const bytes = found.reduce((sum, row) => sum + row.bytes, 0);
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor,
			targetUserId: null,
			audience: 'admin',
			action: 'media.email_pictures.delete',
			entityType: 'media',
			entityId: null,
			severity: 'warn',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata: { count: gone.length, bytes },
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
		return { deleted: gone.length, bytes };
	}
}
