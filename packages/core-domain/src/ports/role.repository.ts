import type { Role, AdminUserRoleAssignment } from '@saha-textile/contracts';

/** Reusable role definitions (`roles`). */
export interface RoleRepository {
	findById(roleId: string): Promise<Role | null>;
	/** The machine key is what seeds and operators refer to; it is unique. */
	findByKey(key: string): Promise<Role | null>;
	listAll(): Promise<Role[]>;
	create(role: Role): Promise<Role>;
	/**
	 * Updates the mutable half of a role. `key`, `isSystem` and the timestamps are not
	 * accepted: the key is the stable identity other records point at, and a system role that
	 * could be edited through this path would let the admin surface remove the authority it
	 * needs to recover from a lockout.
	 */
	update(roleId: string, changes: Partial<Pick<Role, 'label' | 'description' | 'permissions'>>): Promise<Role | null>;
	/** Refuses to delete a system role; returns false when the role is absent or protected. */
	deleteById(roleId: string): Promise<boolean>;
}

/**
 * Explicit user-to-role assignments (`adminUserRoleAssignments`).
 *
 * Assignments are never hard-deleted. Revocation is a state change that keeps the row, which
 * is what makes "who held this authority, and when" answerable after the fact.
 */
export interface AdminUserRoleAssignmentRepository {
	/** Live assignments only — the set that actually confers authority right now. */
	listActiveForUser(userId: string): Promise<AdminUserRoleAssignment[]>;
	/** Everything ever granted to a user, revoked included. The audit view. */
	listAllForUser(userId: string): Promise<AdminUserRoleAssignment[]>;
	/** Live holders of a role. What a last-administrator check counts. */
	listActiveForRole(roleId: string): Promise<AdminUserRoleAssignment[]>;
	findActive(userId: string, roleId: string): Promise<AdminUserRoleAssignment | null>;
	/**
	 * Grants a role.
	 *
	 * Rejects a duplicate ACTIVE grant, and does so on the database's unique partial index
	 * rather than on a preceding read: two concurrent grants would both observe "no active
	 * assignment" and both insert. Implementations must surface that collision as
	 * `AssignmentAlreadyActiveError`, never as a raw driver error.
	 */
	assign(assignment: AdminUserRoleAssignment): Promise<AdminUserRoleAssignment>;
	/** Revokes a live assignment. Returns null when there was nothing live to revoke. */
	revoke(input: {
		userId: string;
		roleId: string;
		revokedByUserId: string | null;
		reason: string | null;
		revokedAt: string;
	}): Promise<AdminUserRoleAssignment | null>;
}

/**
 * Raised when a grant would create a second live assignment of the same role to the same user.
 *
 * A named error rather than a leaked duplicate-key exception: the caller needs to tell
 * "already granted" (harmless, answer 409) from "the write failed" (not harmless), and a
 * driver error code is not a contract any layer above the adapter should read.
 */
export class AssignmentAlreadyActiveError extends Error {
	constructor(
		readonly userId: string,
		readonly roleId: string,
	) {
		super(`Role ${roleId} is already actively assigned to user ${userId}`);
		this.name = 'AssignmentAlreadyActiveError';
	}
}
