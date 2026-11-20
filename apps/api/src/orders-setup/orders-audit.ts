import { randomUUID } from 'node:crypto';

import { ConflictException } from '@nestjs/common';
import type { AuditLog } from '@saha-textile/contracts';
import { StaleRevisionError, type AuditLogRepository } from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';

/**
 * Audit and refusal helpers for the orders and checkout build: every change is audited with who,
 * when and what (brief: "Every change is audited with who, when and the comment").
 */
export async function auditOrdersChange(
	audit: AuditLogRepository | null,
	actorUserId: string | null,
	action: string,
	entityType: string,
	entityId: string | null,
	metadata: Record<string, unknown>,
): Promise<void> {
	if (!audit) return;
	const entry: AuditLog = {
		id: `audit_${randomUUID()}`,
		actorUserId,
		targetUserId: null,
		audience: 'admin',
		action,
		entityType,
		entityId,
		severity: 'info',
		retentionTier: 'financial_security',
		diffs: [],
		metadata,
		requestId: null,
		ipHash: null,
		userAgentHash: null,
		createdAt: new Date().toISOString(),
	};
	await audit.append(entry);
}

/** A save over a newer one becomes the coded refusal the admin explains (`stale_revision`). */
export async function refuseStale<T>(work: () => Promise<T>, message: string): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof StaleRevisionError) {
			const params: Record<string, string | number> = {};
			if (error.changedBy) params.changedBy = error.changedBy.slice(0, 80);
			if (error.changedAt) params.changedAt = error.changedAt;
			throw new ConflictException(codedRefusal('stale_revision', message, 'revision', params));
		}
		throw error;
	}
}
