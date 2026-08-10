import { describe, expect, it } from 'vitest';

import {
	AdminInviteRequest,
	PERMISSION_CODES,
	PermissionAction,
	PermissionCode,
	PermissionGrant,
	PermissionResource,
	SERVER_ONLY_PERMISSION_CODES,
	describePermissions,
	parsePermission,
} from '../src/index';

describe('permission registry', () => {
	it('is a closed set — an unknown code is rejected, not stored', () => {
		expect(PermissionCode.safeParse('product.index').success).toBe(true);
		expect(PermissionCode.safeParse('prodcut.index').success).toBe(false);
		expect(PermissionCode.safeParse('product.destroy').success).toBe(false);
		expect(PermissionCode.safeParse('').success).toBe(false);
	});

	it('exposes every code with a stable order', () => {
		expect(PERMISSION_CODES).toHaveLength(33);
		expect([...PERMISSION_CODES]).toEqual([...PERMISSION_CODES].sort((a, b) => a.localeCompare(b)));
	});

	it('has no duplicate codes', () => {
		expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
	});

	describe('server-only codes', () => {
		const entries = Object.entries(SERVER_ONLY_PERMISSION_CODES);

		it('names only real codes', () => {
			for (const [code] of entries) {
				expect(PermissionCode.safeParse(code).success).toBe(true);
			}
		});

		/**
		 * The escape hatch has to justify itself, or it becomes a parking space for codes
		 * nobody intends to build a screen for.
		 */
		it('carries a substantive reason for each', () => {
			expect(entries.length).toBeGreaterThan(0);
			for (const [code, reason] of entries) {
				expect(reason, code).toBeTruthy();
				expect(reason!.length, code).toBeGreaterThan(20);
			}
		});
	});

	it('splits every code into declared halves', () => {
		for (const code of PERMISSION_CODES) {
			const { resource, action } = parsePermission(code);
			expect(PermissionResource.safeParse(resource).success).toBe(true);
			expect(PermissionAction.safeParse(action).success).toBe(true);
			expect(`${resource}.${action}`).toBe(code);
		}
	});

	describe('grants', () => {
		it('normalizes duplicates away and sorts, so equal grants are byte-identical', () => {
			const a = PermissionGrant.parse(['user.index', 'product.index', 'user.index']);
			const b = PermissionGrant.parse(['product.index', 'user.index']);

			expect(a).toEqual(['product.index', 'user.index']);
			expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		});

		it('rejects the whole grant when any single code is unknown', () => {
			// Partial acceptance would be the dangerous outcome: the caller believes they
			// granted three permissions and the account silently holds two.
			expect(PermissionGrant.safeParse(['user.index', 'user.destroy']).success).toBe(false);
		});

		it('accepts an empty grant', () => {
			expect(PermissionGrant.parse([])).toEqual([]);
		});
	});

	describe('AdminInviteRequest', () => {
		const base = { email: 'someone@example.test', role: 'staff' as const };

		it('accepts a grant drawn from the registry', () => {
			const parsed = AdminInviteRequest.parse({ ...base, permissions: ['user.index', 'user.create'] });
			expect(parsed.permissions).toEqual(['user.create', 'user.index']);
		});

		/**
		 * The failure this registry exists to prevent. Before it, a mistyped code was accepted,
		 * persisted, and authorized nothing — an invite that looked granted and was not.
		 */
		it('refuses an invite carrying a mistyped permission', () => {
			expect(AdminInviteRequest.safeParse({ ...base, permissions: ['prodcut.index'] }).success).toBe(false);
		});

		it('still allows an invite with no permissions at all', () => {
			expect(AdminInviteRequest.parse(base).permissions).toBeUndefined();
		});
	});

	describe('describePermissions', () => {
		it('describes every code exactly once, in registry order', () => {
			const described = describePermissions();

			expect(described).toHaveLength(PERMISSION_CODES.length);
			expect(described.map((entry) => entry.code)).toEqual([...PERMISSION_CODES]);
		});

		it('splits each code and flags the server-only ones', () => {
			const described = describePermissions();
			const byCode = new Map(described.map((entry) => [entry.code, entry]));

			expect(byCode.get('product.index')).toMatchObject({
				resource: 'product',
				action: 'index',
				serverOnly: false,
			});
			// Grantable, but no navigation entry reaches it yet — a grant screen shows it apart
			// rather than pretending it does not exist.
			expect(byCode.get('user_role.assign')).toMatchObject({
				resource: 'user_role',
				action: 'assign',
				serverOnly: true,
			});
		});

		it('marks exactly the declared server-only set', () => {
			const flagged = describePermissions()
				.filter((entry) => entry.serverOnly)
				.map((entry) => entry.code)
				.sort();

			expect(flagged).toEqual(Object.keys(SERVER_ONLY_PERMISSION_CODES).sort());
		});
	});
});
