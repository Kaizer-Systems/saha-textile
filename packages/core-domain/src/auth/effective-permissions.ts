import type { Role, UserRole, UserRoleAssignment } from '@saha-textile/contracts';

/**
 * Coarse tier ordering. The only place the hierarchy is written down.
 *
 * `customer` < `staff` < `admin`. Comparing tiers by this table rather than by string
 * comparison is deliberate: `'admin' < 'customer' < 'staff'` alphabetically, which is a
 * plausible-looking bug that would silently invert the check below.
 */
const TIER_RANK: Readonly<Record<UserRole, number>> = { customer: 0, staff: 1, admin: 2 };

/** True when `role` sits at or below `ceiling` in the coarse hierarchy. */
export function isWithinTier(role: UserRole, ceiling: UserRole): boolean {
	return TIER_RANK[role] <= TIER_RANK[ceiling];
}

/**
 * The permissions a principal actually holds right now.
 *
 * ## The union, and why it is a union
 *
 * Two sources exist during the migration from embedded grants to explicit assignments: the
 * `permissions` array on the user, which is what everything read before, and the role
 * definitions behind that user's ACTIVE assignments. Taking the union means an assignment can
 * only ever ADD authority, so introducing assignments cannot take away access that already
 * worked. The embedded array is transitional and retires once assignments are the only writer;
 * until then, preferring one over the other would silently revoke permissions the moment a
 * user received their first assignment.
 *
 * ## The tier ceiling
 *
 * A role contributes nothing if its `baseRole` sits above the holder's own coarse role. That
 * is a real escalation guard, not bookkeeping: demoting somebody from `admin` to `staff` while
 * an admin-tier assignment survives would otherwise restore their old authority in full, and
 * the demotion would look applied while changing nothing.
 *
 * ## Revoked assignments
 *
 * Filtered here as well as in the repository query. The repository is the fast path; this is
 * the correct one. A caller that passes every assignment — an audit view, a test fixture, a
 * future bulk read — must not accidentally grant revoked authority because it used the wrong
 * finder.
 *
 * ## Unknown codes
 *
 * Not filtered against the registry, and they do not need to be. A required permission is
 * always a registry code, so a string outside the registry can never match one and is inert.
 * Filtering here would also mean importing the registry as a VALUE, which core-domain may not
 * do (G-CORE-CONTRACTS: `import type` only).
 */
export function resolveEffectivePermissions(input: {
	/** The holder's coarse tier, which caps what any assignment may contribute. */
	role: UserRole;
	/** Transitional embedded grants from the user document. */
	embedded: readonly string[];
	assignments: readonly UserRoleAssignment[];
	/** Role definitions for the assignments above. Missing roles contribute nothing. */
	roles: readonly Role[];
}): string[] {
	const byId = new Map(input.roles.map((role) => [role.id, role]));
	const effective = new Set<string>(input.embedded);

	for (const assignment of input.assignments) {
		if (assignment.revokedAt !== null) continue;

		const role = byId.get(assignment.roleId);
		// A dangling assignment grants nothing. Silently ignoring it is right: the alternative
		// is failing a request because of a deleted role, which would lock people out.
		if (!role) continue;
		if (!isWithinTier(role.baseRole, input.role)) continue;

		for (const permission of role.permissions) effective.add(permission);
	}

	return [...effective].sort((a, b) => a.localeCompare(b));
}
