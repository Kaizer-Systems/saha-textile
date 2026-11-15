import { randomUUID } from 'node:crypto';

import { ForbiddenException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AuditLog,
	StorageCheckAnswer,
	StorageCheckRequest,
	StorageSettingsWrite,
	StorageSummary,
} from '@saha-textile/contracts';
import {
	type AdminUserRoleAssignmentRepository,
	type AuditLogRepository,
	type MediaBrowseRepository,
	type RoleRepository,
	type SiteSettingsRepository,
	type StorageLedgerRepository,
	STORAGE_HOLD_SECONDS,
	STORAGE_PLAN_BYTES,
	SUPER_ADMIN_ROLE_KEY,
	decideStorage,
	onDemand,
	storageColour,
} from '@saha-textile/core-domain';

import {
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	MEDIA_BROWSE_REPOSITORY,
	ROLE_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
	STORAGE_LEDGER_REPOSITORY,
} from '../infra/tokens';
import { mediaRefusal } from './media-refusal';

/**
 * Storage on the Media page (R4-7): the bar, its details, and the one check every operation that
 * adds stored data passes before it starts. Running work holds its bytes for an hour (or until it
 * finishes), so two admins uploading at once near the plan cannot both slip past it.
 */
@Injectable()
export class MediaStorageService {
	constructor(
		@Inject(MEDIA_BROWSE_REPOSITORY) private readonly files: MediaBrowseRepository,
		@Inject(STORAGE_LEDGER_REPOSITORY) private readonly ledger: StorageLedgerRepository,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: AdminUserRoleAssignmentRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
	) {}

	/** A super admin holds the system Administrator role. */
	async isSuperAdmin(userId: string): Promise<boolean> {
		const role = await this.roles.findByKey(SUPER_ADMIN_ROLE_KEY);
		return !!role && !!(await this.assignments.findActive(userId, role.id));
	}

	async summary(userId: string, now = new Date()): Promise<StorageSummary> {
		const [usage, reservedBytes, othersMayUseOnDemand, superAdmin] = await Promise.all([
			this.files.usage(),
			this.ledger.reservedBytes(now.toISOString()),
			this.othersMayUseOnDemand(),
			this.isSuperAdmin(userId),
		]);
		const usedBytes = usage.originals + usage.versions + usage.files + usage.trash;
		const percent = Math.round((usedBytes / STORAGE_PLAN_BYTES) * 1000) / 10;
		const extra = onDemand(usedBytes);
		return {
			usedBytes,
			planBytes: STORAGE_PLAN_BYTES,
			percent,
			colour: storageColour(percent),
			onDemandBytes: extra.bytes,
			onDemandMonthlyUsd: extra.monthlyUsd,
			breakdown: [
				{ key: 'originals', bytes: usage.originals },
				{ key: 'versions', bytes: usage.versions },
				{ key: 'files', bytes: usage.files },
				{ key: 'trash', bytes: usage.trash },
			],
			othersMayUseOnDemand,
			canChangeOnDemand: superAdmin,
			reservedBytes,
		};
	}

	/**
	 * The check before an operation (B18, B19). Within the plan it goes and holds the bytes. Past
	 * it, a super admin is asked once; their yes goes, and can let other admins go too. Anyone else
	 * is refused unless a super admin allowed it, and then asked the same way.
	 */
	async check(userId: string, request: StorageCheckRequest, now = new Date()): Promise<StorageCheckAnswer> {
		const [usedBytes, reservedBytes, superAdmin, othersMay] = await Promise.all([
			this.usedBytes(),
			this.ledger.reservedBytes(now.toISOString()),
			this.isSuperAdmin(userId),
			this.othersMayUseOnDemand(),
		]);
		const decision = decideStorage({
			usedBytes,
			reservedBytes,
			addBytes: request.bytes,
			superAdmin,
			othersMayUseOnDemand: othersMay,
			approved: request.approve,
		});
		const afterBytes = usedBytes + reservedBytes + request.bytes;
		let reservationId: string | null = null;
		if (decision === 'go') {
			if (request.bytes > 0) reservationId = await this.hold(userId, request.bytes, now);
			if (afterBytes > STORAGE_PLAN_BYTES) {
				await this.record(userId, 'media.storage.on_demand', {
					operation: request.operation,
					bytes: request.bytes,
					afterBytes,
				});
				if (superAdmin && request.alsoLetOthers !== undefined && request.alsoLetOthers !== othersMay) {
					await this.saveSettings(userId, { othersMayUseOnDemand: request.alsoLetOthers });
				}
			}
		}
		const extra = onDemand(afterBytes);
		return {
			decision,
			reservationId,
			usedBytes,
			afterBytes,
			onDemandBytes: extra.bytes,
			onDemandMonthlyUsd: extra.monthlyUsd,
			canApprove: superAdmin || othersMay,
		};
	}

	/**
	 * Lets one upload start. A hold the person's own check made covers it; otherwise the same check
	 * runs now and holds the bytes under `holdId` until the upload finishes. Past the plan an upload
	 * must go through the check first (it asks), so here it is refused with the reason.
	 */
	async admit(
		userId: string,
		bytes: number,
		reservationId: string | undefined,
		holdId: string,
		now = new Date(),
	): Promise<void> {
		if (reservationId) {
			const hold = await this.ledger.findReservation(reservationId);
			if (hold && hold.userId === userId && hold.expiresAt > now.toISOString()) return;
		}
		const [usedBytes, reservedBytes, superAdmin, othersMay] = await Promise.all([
			this.usedBytes(),
			this.ledger.reservedBytes(now.toISOString()),
			this.isSuperAdmin(userId),
			this.othersMayUseOnDemand(),
		]);
		const decision = decideStorage({
			usedBytes,
			reservedBytes,
			addBytes: bytes,
			superAdmin,
			othersMayUseOnDemand: othersMay,
			approved: false,
		});
		if (decision === 'ask') {
			throw mediaRefusal(
				HttpStatus.CONFLICT,
				'storage_needs_approval',
				'This would go past the 250 GB plan. Approve on-demand storage first.',
			);
		}
		if (decision === 'refused') {
			throw mediaRefusal(
				HttpStatus.CONFLICT,
				'storage_refused',
				'Storage is full. Only a super admin can approve on-demand storage.',
			);
		}
		if (bytes > 0) await this.ledger.reserve({ id: holdId, userId, bytes, expiresAt: this.holdEnd(now) });
	}

	/** The work finished (or was abandoned): its bytes are counted as stored from now on. */
	release(holdId: string): Promise<void> {
		return this.ledger.release(holdId);
	}

	/** The Media page ends its own hold early, for example when a batch finishes or is cancelled. */
	async releaseOwn(userId: string, holdId: string): Promise<void> {
		const hold = await this.ledger.findReservation(holdId);
		if (!hold || hold.userId !== userId) throw new NotFoundException('No such hold');
		await this.ledger.release(holdId);
	}

	/** Storage details (A47): only a super admin lets other admins use on-demand storage. */
	async saveSettings(userId: string, body: StorageSettingsWrite): Promise<{ othersMayUseOnDemand: boolean }> {
		if (!(await this.isSuperAdmin(userId))) throw new ForbiddenException('Only a super admin can change this');
		await this.settings.set('media_storage', { othersMayUseOnDemand: body.othersMayUseOnDemand });
		await this.record(userId, 'media.storage.settings', { othersMayUseOnDemand: body.othersMayUseOnDemand });
		return { othersMayUseOnDemand: body.othersMayUseOnDemand };
	}

	private async hold(userId: string, bytes: number, now: Date): Promise<string> {
		const id = `res_${randomUUID()}`;
		await this.ledger.reserve({ id, userId, bytes, expiresAt: this.holdEnd(now) });
		return id;
	}

	private holdEnd(now: Date): string {
		return new Date(now.getTime() + STORAGE_HOLD_SECONDS * 1000).toISOString();
	}

	private async usedBytes(): Promise<number> {
		const usage = await this.files.usage();
		return usage.originals + usage.versions + usage.files + usage.trash;
	}

	private async othersMayUseOnDemand(): Promise<boolean> {
		return (await this.settings.get('media_storage'))?.othersMayUseOnDemand ?? false;
	}

	private async record(actor: string, action: string, metadata: Record<string, unknown>): Promise<void> {
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'media',
			entityId: null,
			severity: action === 'media.storage.on_demand' ? 'warn' : 'info',
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
