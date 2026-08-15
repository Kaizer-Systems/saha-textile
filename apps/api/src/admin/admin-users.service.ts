import { randomUUID } from 'node:crypto';

import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
	AdminUserListResponse,
	AdminUserAuthorityResponse,
	AuditLog,
	PageQuery,
	PermissionCode,
	Role,
	AdminUserStatus,
} from '@saha-textile/contracts';
import type {
	AdminUserRepository,
	AuditLogRepository,
	AdminUserAuthRepository,
	AuthSessionRepository,
	RoleRepository,
	AdminUserRoleAssignmentRepository,
} from '@saha-textile/core-domain';
import { AssignmentAlreadyActiveError, isWithinTier, resolveEffectivePermissions } from '@saha-textile/core-domain';

import {
	ADMIN_USER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	AUTH_SESSION_REPOSITORY,
	ADMIN_USER_AUTH_REPOSITORY,
	ROLE_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
} from '../infra/tokens';

@Injectable()
export class AdminUsersService {
	private readonly logger = new Logger('AdminUsersService');

	constructor(
		@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: AdminUserRoleAssignmentRepository,
		@Inject(ADMIN_USER_AUTH_REPOSITORY) private readonly users: AdminUserAuthRepository,
		@Inject(ADMIN_USER_REPOSITORY) private readonly adminUsers: AdminUserRepository,
		@Inject(AUTH_SESSION_REPOSITORY) private readonly sessions: AuthSessionRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
	) {}

	/** Paginated operator directory — sanitized public shape only. */
	list(query: PageQuery): Promise<AdminUserListResponse> {
		return this.adminUsers.list(query);
	}

	/** A user's roles plus the RESOLVED permission set, so a screen never re-derives the rules. */
	async authority(userId: string): Promise<AdminUserAuthorityResponse> {
		const user = await this.users.findAuthStateById(userId);
		if (!user) throw new NotFoundException('User not found');

		const active = await this.assignments.listActiveForUser(userId);
		const roles = (await Promise.all(active.map((a) => this.roles.findById(a.roleId)))).filter(
			(role): role is Role => role !== null,
		);
		const byId = new Map(roles.map((role) => [role.id, role]));

		return {
			userId,
			role: user.role,
			status: user.status,
			roles: active.flatMap((assignment) => {
				const role = byId.get(assignment.roleId);
				return role
					? [
							{
								roleId: role.id,
								key: role.key,
								label: role.label,
								baseRole: role.baseRole,
								assignedAt: assignment.assignedAt,
								assignedByUserId: assignment.assignedByUserId,
							},
						]
					: [];
			}),
			effectivePermissions: resolveEffectivePermissions({
				role: user.role,
				embedded: user.permissions,
				assignments: active,
				roles,
			}) as PermissionCode[],
		};
	}

	/**
	 * Grants a role.
	 *
	 * ## No delegation above self
	 *
	 * Two conditions, and both are needed. The role's `baseRole` must sit within the actor's
	 * own tier, and the role's permissions must be a SUBSET of what the actor effectively
	 * holds. The tier check alone would let a staff administrator hand out a staff-tier role
	 * carrying permissions they do not have themselves; the subset check alone would let
	 * somebody grant an admin-tier role once its permission list happened to be narrow, and
	 * tier governs what a holder may later be granted. Together they mean nobody can create
	 * authority they do not already possess, which is the property that keeps a compromised
	 * mid-level account from bootstrapping itself upward.
	 */
	async assignRole(
		actorUserId: string,
		targetUserId: string,
		roleId: string,
		requestId: string | null,
	): Promise<AdminUserAuthorityResponse> {
		const [actor, target, role] = await Promise.all([
			this.users.findAuthStateById(actorUserId),
			this.users.findAuthStateById(targetUserId),
			this.roles.findById(roleId),
		]);
		if (!actor) throw new NotFoundException('Actor not found');
		if (!target) throw new NotFoundException('User not found');
		if (!role) throw new NotFoundException('Role not found');

		if (!isWithinTier(role.baseRole, actor.role)) {
			throw new ForbiddenException('You cannot grant a role above your own tier');
		}

		const actorPermissions = new Set(await this.effectivePermissionsOf(actorUserId));
		const beyond = role.permissions.filter((permission) => !actorPermissions.has(permission));
		if (beyond.length > 0) {
			// The codes are deliberately NOT echoed: naming what the actor lacks turns a refusal
			// into a map of the permission space for somebody probing it.
			throw new ForbiddenException('You cannot grant permissions you do not hold');
		}

		try {
			await this.assignments.assign({
				id: `ura_${randomUUID()}`,
				userId: targetUserId,
				roleId,
				assignedByUserId: actorUserId,
				assignedAt: new Date().toISOString(),
				revokedAt: null,
				revokedByUserId: null,
				revokeReason: null,
			});
		} catch (error) {
			if (error instanceof AssignmentAlreadyActiveError) {
				throw new ConflictException('That role is already assigned to this user');
			}
			throw error;
		}

		await this.invalidate(targetUserId);
		await this.audit.append(
			this.entry(actorUserId, targetUserId, 'admin.user.role.assign', roleId, requestId, [
				{ field: 'roleKey', after: role.key },
				{ field: 'baseRole', after: role.baseRole },
			]),
		);
		return this.authority(targetUserId);
	}

	/**
	 * Revokes a role.
	 *
	 * ## Last-administrator protection
	 *
	 * Refuses when this is the final live admin-tier assignment anywhere in the system.
	 * Without it, the surface that manages authority can remove the last authority able to
	 * manage it, and — with no first-administrator bootstrap yet (6a) — nobody could get back
	 * in without direct database access.
	 *
	 * The count is over ASSIGNMENTS, which is the authoritative model going forward. During
	 * the migration an account could still hold administrative power through the embedded
	 * `permissions` array, so this can refuse a revocation that would in fact have been
	 * survivable. Refusing too often is the safe direction for this particular check.
	 */
	async revokeRole(
		actorUserId: string,
		targetUserId: string,
		roleId: string,
		requestId: string | null,
	): Promise<AdminUserAuthorityResponse> {
		const role = await this.roles.findById(roleId);
		if (!role) throw new NotFoundException('Role not found');

		if (role.baseRole === 'admin' && (await this.isLastAdminAssignment(targetUserId, roleId))) {
			throw new ConflictException('This is the last administrator; grant another before revoking this one');
		}

		const revoked = await this.assignments.revoke({
			userId: targetUserId,
			roleId,
			revokedByUserId: actorUserId,
			reason: 'admin_revoked',
			revokedAt: new Date().toISOString(),
		});
		if (!revoked) throw new NotFoundException('That role is not assigned to this user');

		await this.invalidate(targetUserId);
		await this.audit.append(
			this.entry(actorUserId, targetUserId, 'admin.user.role.revoke', roleId, requestId, [
				{ field: 'roleKey', before: role.key },
			]),
		);
		return this.authority(targetUserId);
	}

	/**
	 * Changes an account's lifecycle status — the offboarding path.
	 *
	 * Disabling revokes every session outright rather than only bumping a version. The guard
	 * already refuses a non-active account on the next request, so the bump alone would be
	 * enough for correctness; revoking as well means the refresh tokens are dead too, and an
	 * offboarded operator's stolen cookie cannot be replayed against a system that has simply
	 * not re-read their status yet.
	 */
	async setStatus(
		actorUserId: string,
		targetUserId: string,
		status: AdminUserStatus,
		reason: string | null,
		requestId: string | null,
	): Promise<AdminUserAuthorityResponse> {
		// Self-disabling is the one action from which an operator cannot recover through this
		// surface: the very next request would fail the account-active check.
		if (actorUserId === targetUserId && status !== 'active') {
			throw new ForbiddenException('You cannot disable your own account');
		}

		const target = await this.users.findAuthStateById(targetUserId);
		if (!target) throw new NotFoundException('User not found');

		if (status !== 'active' && (await this.isLastAdminAccount(targetUserId))) {
			throw new ConflictException('This is the last administrator; grant another before disabling this one');
		}

		await this.users.setStatus(targetUserId, status);

		if (status !== 'active') {
			await this.users.bumpTokenVersion(targetUserId);
			await this.sessions.revokeAllForUser(targetUserId, 'disabled_user', new Date().toISOString());
		}

		await this.audit.append(
			this.entry(actorUserId, targetUserId, 'admin.user.status.change', null, requestId, [
				{ field: 'status', before: target.status, after: status },
				...(reason ? [{ field: 'reason', after: reason }] : []),
			]),
		);
		return this.authority(targetUserId);
	}

	/** True when revoking this assignment would leave no live admin-tier assignment anywhere. */
	private async isLastAdminAssignment(targetUserId: string, roleId: string): Promise<boolean> {
		const adminRoles = (await this.roles.listAll()).filter((role) => role.baseRole === 'admin');
		const holders = new Set<string>();

		for (const role of adminRoles) {
			for (const assignment of await this.assignments.listActiveForRole(role.id)) {
				// The assignment about to be revoked does not count towards what would remain.
				if (assignment.userId === targetUserId && role.id === roleId) continue;
				holders.add(assignment.userId);
			}
		}
		return holders.size === 0;
	}

	/** True when disabling this account would leave no live admin-tier assignment anywhere. */
	private async isLastAdminAccount(targetUserId: string): Promise<boolean> {
		const adminRoles = (await this.roles.listAll()).filter((role) => role.baseRole === 'admin');
		const holders = new Set<string>();

		for (const role of adminRoles) {
			for (const assignment of await this.assignments.listActiveForRole(role.id)) {
				if (assignment.userId === targetUserId) continue;
				holders.add(assignment.userId);
			}
		}
		// Only meaningful if the target actually holds admin authority in the first place.
		const targetIsAdmin = (await this.assignments.listActiveForUser(targetUserId)).some((assignment) =>
			adminRoles.some((role) => role.id === assignment.roleId),
		);
		return targetIsAdmin && holders.size === 0;
	}

	private async effectivePermissionsOf(userId: string): Promise<string[]> {
		const user = await this.users.findAuthStateById(userId);
		if (!user) return [];

		const active = await this.assignments.listActiveForUser(userId);
		const roles = (await Promise.all(active.map((a) => this.roles.findById(a.roleId)))).filter(
			(role): role is Role => role !== null,
		);
		return resolveEffectivePermissions({
			role: user.role,
			embedded: user.permissions,
			assignments: active,
			roles,
		});
	}

	/** A failed bump is logged, never thrown: the grant itself already succeeded. */
	private async invalidate(userId: string): Promise<void> {
		try {
			await this.users.bumpPermissionsVersion(userId);
		} catch (error) {
			this.logger.error(
				`Failed to invalidate permissions for user ${userId} after an assignment change`,
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	private entry(
		actorUserId: string,
		targetUserId: string,
		action: string,
		entityId: string | null,
		requestId: string | null,
		diffs: AuditLog['diffs'],
	): AuditLog {
		return {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId,
			audience: 'admin',
			action,
			entityType: 'adminUserRoleAssignment',
			entityId,
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
