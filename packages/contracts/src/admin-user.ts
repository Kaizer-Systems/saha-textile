import { z } from 'zod';

import { AdminUser } from './admin-auth';
import { AdminRole, AdminUserId } from './admin-role';
import { Id, IsoDateTime, MAX_PAGE_SIZE, paginated } from './common';
import { UserStatus } from './customer';
import { PermissionCode } from './permission';

/**
 * Grant a role to an operator (`POST /admin/users/:userId/roles`).
 *
 * Only the role is named. Which permissions that confers is the ROLE's business, not the
 * grant's: letting a caller attach permissions here would reintroduce the free-form privilege
 * strings the registry exists to abolish, and would make two users holding "the same role"
 * mean different things.
 *
 * This surface administers operators only (`DEC-ACCOUNT-SEPARATION` D3).
 */
export const AssignRoleRequest = z.object({
	roleId: Id,
});
export type AssignRoleRequest = z.infer<typeof AssignRoleRequest>;

/**
 * Change an operator account's lifecycle status (`PATCH /admin/users/:userId/status`).
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

/** One role an operator currently holds, as the administration surface sees it. */
export const AdminUserRoleSummary = z.object({
	roleId: Id,
	key: z.string().min(1),
	label: z.string().min(1),
	baseRole: AdminRole,
	assignedAt: IsoDateTime,
	assignedByUserId: Id.nullable(),
});
export type AdminUserRoleSummary = z.infer<typeof AdminUserRoleSummary>;

/**
 * An operator's authority, as one answer.
 *
 * `effectivePermissions` is the RESOLVED set — the union of the roles above and any embedded
 * grants, capped at the account's own tier. Returning the roles without it would leave the
 * screen to re-implement the resolution rules, which is exactly how a UI ends up disagreeing
 * with the server about what somebody can do.
 */
export const AdminUserAuthorityResponse = z.object({
	userId: AdminUserId,
	role: AdminRole,
	status: UserStatus,
	roles: z.array(AdminUserRoleSummary),
	effectivePermissions: z.array(PermissionCode),
});
export type AdminUserAuthorityResponse = z.infer<typeof AdminUserAuthorityResponse>;

/** Query for `GET /admin/users` — coerces string query params from HTTP. */
export const AdminUserListQuery = z.object({
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(24),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuery>;

/** Paginated operator list (`GET /admin/users`) — sanitized `AdminUser` rows only. */
export const AdminUserListResponse = paginated(AdminUser);
export type AdminUserListResponse = z.infer<typeof AdminUserListResponse>;
