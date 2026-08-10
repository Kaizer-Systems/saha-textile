import type { Role, UserRoleAssignment } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { isWithinTier, resolveEffectivePermissions } from '../src/auth/effective-permissions';

const role = (overrides: Partial<Role> & Pick<Role, 'id'>): Role => ({
	key: `role-${overrides.id}`,
	label: 'Role',
	description: null,
	baseRole: 'staff',
	permissions: [],
	isSystem: false,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	...overrides,
});

const assignment = (roleId: string, overrides: Partial<UserRoleAssignment> = {}): UserRoleAssignment => ({
	id: `ura_${roleId}`,
	userId: 'user_1',
	roleId,
	assignedByUserId: null,
	assignedAt: '2026-01-01T00:00:00.000Z',
	revokedAt: null,
	revokedByUserId: null,
	revokeReason: null,
	...overrides,
});

describe('tier ordering', () => {
	it('ranks customer below staff below admin', () => {
		expect(isWithinTier('customer', 'admin')).toBe(true);
		expect(isWithinTier('staff', 'admin')).toBe(true);
		expect(isWithinTier('admin', 'admin')).toBe(true);
		expect(isWithinTier('admin', 'staff')).toBe(false);
		expect(isWithinTier('staff', 'customer')).toBe(false);
	});

	/**
	 * Alphabetically `'admin' < 'customer' < 'staff'`, so a string comparison would invert
	 * the hierarchy while still looking like a comparison. This pins the table instead.
	 */
	it('does not fall back to alphabetical order', () => {
		expect(isWithinTier('admin', 'customer')).toBe(false);
		expect(isWithinTier('customer', 'staff')).toBe(true);
	});
});

describe('resolveEffectivePermissions', () => {
	/** The equivalence that makes introducing assignments safe: no assignments, no change. */
	it('returns exactly the embedded grants when there are no assignments', () => {
		expect(
			resolveEffectivePermissions({
				role: 'admin',
				embedded: ['user.index', 'product.index'],
				assignments: [],
				roles: [],
			}),
		).toEqual(['product.index', 'user.index']);
	});

	it('adds the permissions of an active assignment', () => {
		const editor = role({ id: 'r1', permissions: ['product.create', 'product.index'] });

		expect(
			resolveEffectivePermissions({
				role: 'staff',
				embedded: ['user.index'],
				assignments: [assignment('r1')],
				roles: [editor],
			}),
		).toEqual(['product.create', 'product.index', 'user.index']);
	});

	it('never removes an embedded grant — assignments only add', () => {
		const narrow = role({ id: 'r1', permissions: ['tag.index'] });

		const result = resolveEffectivePermissions({
			role: 'staff',
			embedded: ['user.index', 'order.index'],
			assignments: [assignment('r1')],
			roles: [narrow],
		});

		expect(result).toContain('user.index');
		expect(result).toContain('order.index');
	});

	it('deduplicates and sorts, so two equivalent inputs give one answer', () => {
		const overlapping = role({ id: 'r1', permissions: ['user.index', 'tag.index'] });

		expect(
			resolveEffectivePermissions({
				role: 'staff',
				embedded: ['user.index'],
				assignments: [assignment('r1')],
				roles: [overlapping],
			}),
		).toEqual(['tag.index', 'user.index']);
	});

	it('ignores a revoked assignment even when it is handed one', () => {
		const powerful = role({ id: 'r1', permissions: ['role.destroy'] });

		expect(
			resolveEffectivePermissions({
				role: 'admin',
				embedded: [],
				assignments: [assignment('r1', { revokedAt: '2026-02-01T00:00:00.000Z' })],
				roles: [powerful],
			}),
		).toEqual([]);
	});

	it('ignores an assignment whose role no longer exists', () => {
		expect(
			resolveEffectivePermissions({
				role: 'admin',
				embedded: ['user.index'],
				assignments: [assignment('deleted-role')],
				roles: [],
			}),
		).toEqual(['user.index']);
	});

	/**
	 * The escalation guard. A surviving admin-tier assignment must not restore authority to
	 * somebody who has been demoted, or the demotion would look applied and change nothing.
	 */
	it('refuses to let a role grant above the holder’s own tier', () => {
		const adminRole = role({ id: 'r1', baseRole: 'admin', permissions: ['role.destroy', 'user_role.assign'] });

		expect(
			resolveEffectivePermissions({
				role: 'staff',
				embedded: ['user.index'],
				assignments: [assignment('r1')],
				roles: [adminRole],
			}),
		).toEqual(['user.index']);
	});

	it('allows a role at or below the holder’s tier', () => {
		const staffRole = role({ id: 'r1', baseRole: 'staff', permissions: ['order.index'] });

		expect(
			resolveEffectivePermissions({
				role: 'admin',
				embedded: [],
				assignments: [assignment('r1')],
				roles: [staffRole],
			}),
		).toEqual(['order.index']);
	});

	it('combines several active assignments', () => {
		const a = role({ id: 'r1', permissions: ['order.index'] });
		const b = role({ id: 'r2', permissions: ['refund.index'] });

		expect(
			resolveEffectivePermissions({
				role: 'staff',
				embedded: [],
				assignments: [assignment('r1'), assignment('r2')],
				roles: [a, b],
			}),
		).toEqual(['order.index', 'refund.index']);
	});
});
