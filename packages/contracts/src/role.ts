import { z } from 'zod';

import { AdminRole } from './admin-role';
import { Id, IsoDateTime } from './common';
import { PermissionGrant } from './permission';

/**
 * Reusable role definitions (`roles`) — Schema Nebula node, auth §7.10.
 *
 * ## Why a collection rather than the enum we already have
 *
 * `AdminRole` (`staff` | `admin`) is the COARSE tier on operators only
 * (`DEC-ACCOUNT-SEPARATION` D2 / D7). Customers have no role. This collection is the
 * fine-grained half — named, reusable bundles of permissions that an operator can define
 * without a deployment. An assignment carries a role whose `baseRole` says which coarse
 * tier it belongs to, so a role can never grant an audience its tier does not allow.
 *
 * ## `isSystem`
 *
 * System roles are seeded, not authored, and must not be edited or deleted through the admin
 * surface — otherwise the last route back into a locked-out back office can be removed by the
 * very UI that needs it. The flag is what a 5c route will refuse on.
 */
export const Role = z.object({
	id: Id,
	/** Stable machine key, e.g. `catalog-editor`. Immutable once created; the label is what changes. */
	key: z
		.string()
		.min(2)
		.max(64)
		.regex(/^[a-z][a-z0-9-]*$/, 'must be lowercase kebab-case'),
	label: z.string().min(1).max(120),
	description: z.string().max(500).nullable().default(null),
	/** The coarse operator tier this role belongs to. A role cannot lift someone above its own tier. */
	baseRole: AdminRole,
	/** Validated against the canonical registry, so a role cannot bundle a code that does not exist. */
	permissions: PermissionGrant.default([]),
	/** Seeded roles are not editable or deletable through the admin surface. */
	isSystem: z.boolean().default(false),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type Role = z.infer<typeof Role>;

/**
 * Explicit operator-to-role assignment (`userRoleAssignments`) — Schema Nebula node, auth §7.10.
 *
 * ## Why assignments are their own documents
 *
 * Embedding a role list on the operator makes "who was an administrator in March" unanswerable.
 * The graph asks for lifecycle and auditability, so an assignment is a record with a
 * beginning and an end: revoking sets `revokedAt` and keeps the row, which is what lets an
 * audit reconstruct authority as it stood at any moment. Nothing here is ever hard-deleted.
 *
 * ## The uniqueness rule
 *
 * An operator may hold a role once at a time, and may hold it again after revocation. That is a
 * constraint on the ACTIVE rows only — a plain unique index on `(userId, roleId)` would make
 * re-granting a previously revoked role impossible forever. The adapter expresses it as a
 * partial unique index over documents where `revokedAt` is null.
 *
 * `userId` stays a generic `Id` until Pass 5b rewrites legacy `user_…` rows to `adm_…`.
 */
export const UserRoleAssignment = z.object({
	id: Id,
	userId: Id,
	roleId: Id,
	/** Who granted it. Null only for assignments created by system seeding. */
	assignedByUserId: Id.nullable().default(null),
	assignedAt: IsoDateTime,
	/** Null while the assignment is live; set on revocation, never unset. */
	revokedAt: IsoDateTime.nullable().default(null),
	revokedByUserId: Id.nullable().default(null),
	revokeReason: z.string().max(200).nullable().default(null),
});
export type UserRoleAssignment = z.infer<typeof UserRoleAssignment>;

/** True when the assignment is currently in force. The single definition of "active". */
export function isAssignmentActive(assignment: Pick<UserRoleAssignment, 'revokedAt'>): boolean {
	return assignment.revokedAt === null;
}

/**
 * Create a role (`POST /admin/roles`).
 *
 * `isSystem` is absent by design: a caller must never be able to mint a role the
 * administration surface then refuses to delete, which is how an undeletable rogue role would
 * be created through the very screen meant to control them. System roles come from seeding.
 */
export const RoleCreateRequest = z.object({
	key: Role.shape.key,
	label: Role.shape.label,
	description: z.string().max(500).nullable().optional(),
	baseRole: AdminRole,
	permissions: PermissionGrant.default([]),
});
export type RoleCreateRequest = z.infer<typeof RoleCreateRequest>;

/**
 * Edit a role (`PATCH /admin/roles/:id`).
 *
 * Neither `key` nor `baseRole` may change. The key is the stable identity seeds and operators
 * refer to. `baseRole` is the tier ceiling that stops a role granting above its holder's own
 * rank — editing it would silently re-rank everyone already holding the role, which is an
 * escalation dressed as an edit. Retiring a role and granting a new one is the honest path.
 */
export const RoleUpdateRequest = z
	.object({
		label: Role.shape.label.optional(),
		description: z.string().max(500).nullable().optional(),
		permissions: PermissionGrant.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' });
export type RoleUpdateRequest = z.infer<typeof RoleUpdateRequest>;

/** A role as returned to the administration surface. */
export const RoleResponse = Role;
export type RoleResponse = z.infer<typeof RoleResponse>;

export const RoleListResponse = z.object({ items: z.array(Role) });
export type RoleListResponse = z.infer<typeof RoleListResponse>;
