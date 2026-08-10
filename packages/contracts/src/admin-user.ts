import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { PermissionCode } from './permission';
import { UserRole, UserStatus } from './user';

/**
 * Grant a role to a user (`POST /admin/users/:userId/roles`).
 *
 * Only the role is named. Which permissions that confers is the ROLE's business, not the
 * grant's: letting a caller attach permissions here would reintroduce the free-form privilege
 * strings the registry exists to abolish, and would make two users holding "the same role"
 * mean different things.
 */
export const AssignRoleRequest = z.object({
	roleId: Id,
});
export type AssignRoleRequest = z.infer<typeof AssignRoleRequest>;

/**
 * Change an account's lifecycle status (`PATCH /admin/users/:userId/status`).
 *
 * `deleted` is not offered. Offboarding is `disabled`: the row survives so the audit trail
 * keeps its subject, and the email stays claimed rather than becoming re-registerable by
 * somebody else.
 */
export const AdminUserStatusRequest = z.object({
	status: UserStatus.exclude(['deleted']),
	reason: z.string().min(1).max(200).optional(),
});
export type AdminUserStatusRequest = z.infer<typeof AdminUserStatusRequest>;

/** One role a user currently holds, as the administration surface sees it. */
export const AdminUserRoleSummary = z.object({
	roleId: Id,
	key: z.string().min(1),
	label: z.string().min(1),
	baseRole: UserRole,
	assignedAt: IsoDateTime,
	assignedByUserId: Id.nullable(),
});
export type AdminUserRoleSummary = z.infer<typeof AdminUserRoleSummary>;

/**
 * A user's authority, as one answer.
 *
 * `effectivePermissions` is the RESOLVED set — the union of the roles above and any embedded
 * grants, capped at the account's own tier. Returning the roles without it would leave the
 * screen to re-implement the resolution rules, which is exactly how a UI ends up disagreeing
 * with the server about what somebody can do.
 */
export const AdminUserAuthorityResponse = z.object({
	userId: Id,
	role: UserRole,
	status: UserStatus,
	roles: z.array(AdminUserRoleSummary),
	effectivePermissions: z.array(PermissionCode),
});
export type AdminUserAuthorityResponse = z.infer<typeof AdminUserAuthorityResponse>;
