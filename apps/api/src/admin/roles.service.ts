import { randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuditLog, Role, RoleCreateRequest, RoleUpdateRequest } from '@saha-textile/contracts';
import type {
	AuditLogRepository,
	AdminUserAuthRepository,
	RoleRepository,
	UserRoleAssignmentRepository,
} from '@saha-textile/core-domain';

import {
	AUDIT_LOG_REPOSITORY,
	ADMIN_USER_AUTH_REPOSITORY,
	ROLE_REPOSITORY,
	USER_ROLE_ASSIGNMENT_REPOSITORY,
} from '../infra/tokens';

/** What a mutation reports back, so the controller need not re-read to describe what happened. */
export interface RoleMutationResult {
	role: Role;
	/** How many live holders had their permission version bumped. */
	invalidatedSessions: number;
}

@Injectable()
export class RolesService {
	private readonly logger = new Logger('RolesService');

	constructor(
		@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
		@Inject(USER_ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: UserRoleAssignmentRepository,
		@Inject(ADMIN_USER_AUTH_REPOSITORY) private readonly users: AdminUserAuthRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
	) {}

	list(): Promise<Role[]> {
		return this.roles.listAll();
	}

	async get(roleId: string): Promise<Role> {
		const role = await this.roles.findById(roleId);
		if (!role) throw new NotFoundException('Role not found');
		return role;
	}

	async create(actorUserId: string, request: RoleCreateRequest, requestId: string | null): Promise<Role> {
		// Checked before writing so the caller gets `409 conflict` rather than the unique
		// index's duplicate-key error surfacing as a 500. The index is still the arbiter under
		// concurrency; this is the readable answer for the ordinary case.
		if (await this.roles.findByKey(request.key)) {
			throw new ConflictException('A role with that key already exists');
		}

		const now = new Date().toISOString();
		const role: Role = {
			id: `role_${randomUUID()}`,
			key: request.key,
			label: request.label,
			description: request.description ?? null,
			baseRole: request.baseRole,
			permissions: request.permissions,
			// Never from the request: a caller must not be able to mint a role the
			// administration surface then refuses to delete.
			isSystem: false,
			createdAt: now,
			updatedAt: now,
		};

		const created = await this.roles.create(role);
		await this.audit.append(
			this.entry(actorUserId, 'admin.role.create', created, requestId, [
				{ field: 'key', after: created.key },
				{ field: 'baseRole', after: created.baseRole },
				{ field: 'permissions', after: created.permissions },
			]),
		);
		return created;
	}

	/**
	 * Edits the mutable half of a role.
	 *
	 * The permission version of every LIVE holder is bumped, but only when the permission set
	 * actually changed. A rename must not force everyone holding the role through a token
	 * rotation for a cosmetic edit — and conversely, a permission change that did NOT
	 * invalidate would leave existing sessions running on the authority they had a moment ago,
	 * which is the whole failure this bump exists to prevent.
	 */
	async update(
		actorUserId: string,
		roleId: string,
		request: RoleUpdateRequest,
		requestId: string | null,
	): Promise<RoleMutationResult> {
		const before = await this.roles.findById(roleId);
		if (!before) throw new NotFoundException('Role not found');
		// Answered explicitly rather than as a silent null from the repository filter, so the
		// operator learns WHY rather than seeing a role that appears to vanish on save.
		if (before.isSystem) throw new ConflictException('System roles cannot be edited');

		const updated = await this.roles.update(roleId, {
			...(request.label === undefined ? {} : { label: request.label }),
			...(request.description === undefined ? {} : { description: request.description }),
			...(request.permissions === undefined ? {} : { permissions: request.permissions }),
		});
		if (!updated) throw new NotFoundException('Role not found');

		const permissionsChanged =
			request.permissions !== undefined && !sameCodes(before.permissions, updated.permissions);
		const invalidated = permissionsChanged ? await this.invalidateHolders(roleId) : 0;

		await this.audit.append(
			this.entry(actorUserId, 'admin.role.update', updated, requestId, [
				{ field: 'label', before: before.label, after: updated.label },
				{ field: 'permissions', before: before.permissions, after: updated.permissions },
			]),
		);
		return { role: updated, invalidatedSessions: invalidated };
	}

	/**
	 * Deletes a role.
	 *
	 * Holders are invalidated FIRST. Deleting the role already removes the authority — a
	 * dangling assignment resolves to nothing — but a live session keeps whatever version it
	 * was minted with until something forces it to re-derive, so without the bump the
	 * permissions would linger for the rest of that session's life.
	 */
	async remove(
		actorUserId: string,
		roleId: string,
		requestId: string | null,
	): Promise<{ invalidatedSessions: number }> {
		const role = await this.roles.findById(roleId);
		if (!role) throw new NotFoundException('Role not found');
		if (role.isSystem) throw new ConflictException('System roles cannot be deleted');

		const invalidated = await this.invalidateHolders(roleId);
		const deleted = await this.roles.deleteById(roleId);
		if (!deleted) throw new NotFoundException('Role not found');

		await this.audit.append(
			this.entry(actorUserId, 'admin.role.delete', role, requestId, [
				{ field: 'key', before: role.key },
				{ field: 'permissions', before: role.permissions },
			]),
		);
		return { invalidatedSessions: invalidated };
	}

	/**
	 * Forces every live holder to re-derive their permissions.
	 *
	 * Bumps are issued per user and failures are logged rather than thrown: a single
	 * unbumpable account must not abandon the operation half-applied, leaving the role changed
	 * while some holders were invalidated and others were not. The remaining risk is bounded —
	 * a missed bump means one session keeps stale authority until it next rotates — and it is
	 * strictly better than a partial write with no record of which half succeeded.
	 */
	private async invalidateHolders(roleId: string): Promise<number> {
		const holders = await this.assignments.listActiveForRole(roleId);
		let bumped = 0;

		for (const holder of holders) {
			try {
				await this.users.bumpPermissionsVersion(holder.userId);
				bumped += 1;
			} catch (error) {
				this.logger.error(
					`Failed to invalidate permissions for user ${holder.userId} after a change to role ${roleId}`,
					error instanceof Error ? error.stack : String(error),
				);
			}
		}
		return bumped;
	}

	private entry(
		actorUserId: string,
		action: string,
		role: Role,
		requestId: string | null,
		diffs: AuditLog['diffs'],
	): AuditLog {
		return {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'role',
			entityId: role.id,
			// Authority changes are security events, not catalogue edits.
			severity: 'warn',
			retentionTier: 'financial_security',
			diffs,
			metadata: {},
			requestId,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
	}
}

/** Order-insensitive comparison. Grants are normalized, but a caller may still resend one. */
function sameCodes(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	const left = [...a].sort();
	const right = [...b].sort();
	return left.every((code, index) => code === right[index]);
}
