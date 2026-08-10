import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Role } from '@saha-textile/contracts';
import { AssignmentAlreadyActiveError } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminUsersService } from '../src/admin/admin-users.service';

const ACTOR = 'user_actor';
const TARGET = 'user_target';

const roleFixture = (overrides: Partial<Role> & Pick<Role, 'id'>): Role => ({
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

const userFixture = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	status: 'active',
	role: 'admin',
	permissions: [],
	tokenVersion: 1,
	permissionsVersion: 1,
	...overrides,
});

describe('AdminUsersService', () => {
	const roles = { findById: vi.fn(), listAll: vi.fn(async (): Promise<Role[]> => []) };
	const assignments = {
		listActiveForUser: vi.fn(async (): Promise<unknown[]> => []),
		listActiveForRole: vi.fn(async (): Promise<unknown[]> => []),
		assign: vi.fn(async (a: unknown) => a),
		revoke: vi.fn(),
	};
	const users = {
		findAuthStateById: vi.fn(),
		bumpPermissionsVersion: vi.fn(async () => 2),
		bumpTokenVersion: vi.fn(async () => 2),
		setStatus: vi.fn(async () => undefined),
	};
	const sessions = { revokeAllForUser: vi.fn(async () => 3) };
	const audit = { append: vi.fn(async (entry: unknown) => entry) };

	const service = () =>
		new AdminUsersService(roles as never, assignments as never, users as never, sessions as never, audit as never);

	beforeEach(() => {
		vi.clearAllMocks();
		users.findAuthStateById.mockImplementation(async (id: string) => userFixture(id));
		assignments.listActiveForUser.mockResolvedValue([]);
		assignments.listActiveForRole.mockResolvedValue([]);
		roles.listAll.mockResolvedValue([]);
	});

	describe('no delegation above self', () => {
		/** Tier alone is not enough, but it is the first gate. */
		it('refuses to grant a role above the actor’s own tier', async () => {
			users.findAuthStateById.mockImplementation(async (id: string) =>
				userFixture(id, { role: id === ACTOR ? 'staff' : 'admin' }),
			);
			roles.findById.mockResolvedValue(roleFixture({ id: 'r1', baseRole: 'admin' }));

			await expect(service().assignRole(ACTOR, TARGET, 'r1', null)).rejects.toBeInstanceOf(ForbiddenException);
			expect(assignments.assign).not.toHaveBeenCalled();
		});

		/**
		 * The subset rule. Without it, a staff administrator could hand out a staff-TIER role
		 * carrying permissions they do not hold themselves — creating authority from nothing.
		 */
		it('refuses to grant permissions the actor does not hold', async () => {
			users.findAuthStateById.mockImplementation(async (id: string) =>
				userFixture(id, { permissions: id === ACTOR ? ['user.index'] : [] }),
			);
			roles.findById.mockResolvedValue(roleFixture({ id: 'r1', permissions: ['role.destroy'] }));

			await expect(service().assignRole(ACTOR, TARGET, 'r1', null)).rejects.toBeInstanceOf(ForbiddenException);
			expect(assignments.assign).not.toHaveBeenCalled();
		});

		/** A refusal must not double as a map of the permission space for somebody probing. */
		it('does not name the permissions the actor lacks', async () => {
			users.findAuthStateById.mockImplementation(async (id: string) => userFixture(id, { permissions: [] }));
			roles.findById.mockResolvedValue(roleFixture({ id: 'r1', permissions: ['role.destroy'] }));

			await expect(service().assignRole(ACTOR, TARGET, 'r1', null)).rejects.toThrow(
				/^You cannot grant permissions you do not hold$/,
			);
		});

		it('allows a grant fully within the actor’s authority', async () => {
			users.findAuthStateById.mockImplementation(async (id: string) =>
				userFixture(id, { permissions: id === ACTOR ? ['user.index', 'role.index'] : [] }),
			);
			roles.findById.mockResolvedValue(roleFixture({ id: 'r1', permissions: ['user.index'] }));

			await service().assignRole(ACTOR, TARGET, 'r1', null);

			expect(assignments.assign).toHaveBeenCalledTimes(1);
			expect(users.bumpPermissionsVersion).toHaveBeenCalledWith(TARGET);
			expect(audit.append.mock.calls[0]?.[0]).toMatchObject({
				action: 'admin.user.role.assign',
				actorUserId: ACTOR,
				targetUserId: TARGET,
			});
		});

		it('translates a duplicate grant into 409 rather than a driver error', async () => {
			users.findAuthStateById.mockImplementation(async (id: string) => userFixture(id));
			roles.findById.mockResolvedValue(roleFixture({ id: 'r1' }));
			assignments.assign.mockRejectedValue(new AssignmentAlreadyActiveError(TARGET, 'r1'));

			await expect(service().assignRole(ACTOR, TARGET, 'r1', null)).rejects.toBeInstanceOf(ConflictException);
		});
	});

	describe('last-administrator protection', () => {
		const adminRole = roleFixture({ id: 'r_admin', baseRole: 'admin', key: 'administrator' });

		it('refuses to revoke the final live admin assignment', async () => {
			roles.findById.mockResolvedValue(adminRole);
			roles.listAll.mockResolvedValue([adminRole]);
			assignments.listActiveForRole.mockResolvedValue([{ userId: TARGET, roleId: 'r_admin' }]);

			await expect(service().revokeRole(ACTOR, TARGET, 'r_admin', null)).rejects.toBeInstanceOf(
				ConflictException,
			);
			expect(assignments.revoke).not.toHaveBeenCalled();
		});

		it('allows the revocation once somebody else also holds it', async () => {
			roles.findById.mockResolvedValue(adminRole);
			roles.listAll.mockResolvedValue([adminRole]);
			assignments.listActiveForRole.mockResolvedValue([
				{ userId: TARGET, roleId: 'r_admin' },
				{ userId: 'user_other', roleId: 'r_admin' },
			]);
			assignments.revoke.mockResolvedValue({ userId: TARGET, roleId: 'r_admin' });

			await service().revokeRole(ACTOR, TARGET, 'r_admin', null);

			expect(assignments.revoke).toHaveBeenCalledTimes(1);
			expect(users.bumpPermissionsVersion).toHaveBeenCalledWith(TARGET);
		});

		/** A staff role is not administrative authority, so the check must not fire. */
		it('does not guard a non-admin role', async () => {
			roles.findById.mockResolvedValue(roleFixture({ id: 'r1', baseRole: 'staff' }));
			assignments.revoke.mockResolvedValue({ userId: TARGET, roleId: 'r1' });

			await service().revokeRole(ACTOR, TARGET, 'r1', null);

			expect(assignments.revoke).toHaveBeenCalledTimes(1);
		});

		it('refuses to disable the last administrator', async () => {
			roles.listAll.mockResolvedValue([adminRole]);
			assignments.listActiveForRole.mockResolvedValue([{ userId: TARGET, roleId: 'r_admin' }]);
			assignments.listActiveForUser.mockResolvedValue([{ userId: TARGET, roleId: 'r_admin' }]);

			await expect(service().setStatus(ACTOR, TARGET, 'disabled', null, null)).rejects.toBeInstanceOf(
				ConflictException,
			);
			expect(users.setStatus).not.toHaveBeenCalled();
		});

		it('does not block disabling a user who holds no admin authority', async () => {
			roles.listAll.mockResolvedValue([adminRole]);
			assignments.listActiveForRole.mockResolvedValue([{ userId: 'user_other', roleId: 'r_admin' }]);
			assignments.listActiveForUser.mockResolvedValue([]);

			await service().setStatus(ACTOR, TARGET, 'disabled', null, null);

			expect(users.setStatus).toHaveBeenCalledWith(TARGET, 'disabled');
		});
	});

	describe('offboarding', () => {
		it('revokes every session as well as bumping the token version', async () => {
			await service().setStatus(ACTOR, TARGET, 'disabled', 'left the company', null);

			expect(users.setStatus).toHaveBeenCalledWith(TARGET, 'disabled');
			expect(users.bumpTokenVersion).toHaveBeenCalledWith(TARGET);
			expect(sessions.revokeAllForUser).toHaveBeenCalledWith(TARGET, 'disabled_user', expect.any(String));
			expect(audit.append.mock.calls[0]?.[0]).toMatchObject({ action: 'admin.user.status.change' });
		});

		/** Re-enabling must not destroy sessions — there are none to destroy, and it is not a revocation. */
		it('does not revoke sessions when re-enabling an account', async () => {
			users.findAuthStateById.mockImplementation(async (id: string) => userFixture(id, { status: 'disabled' }));

			await service().setStatus(ACTOR, TARGET, 'active', null, null);

			expect(users.setStatus).toHaveBeenCalledWith(TARGET, 'active');
			expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
			expect(users.bumpTokenVersion).not.toHaveBeenCalled();
		});

		/**
		 * The one action an operator cannot undo through this surface: the very next request
		 * would fail the account-active check.
		 */
		it('refuses to let an actor disable their own account', async () => {
			await expect(service().setStatus(ACTOR, ACTOR, 'disabled', null, null)).rejects.toBeInstanceOf(
				ForbiddenException,
			);
			expect(users.setStatus).not.toHaveBeenCalled();
		});

		it('still allows an actor to re-enable themselves', async () => {
			await service().setStatus(ACTOR, ACTOR, 'active', null, null);
			expect(users.setStatus).toHaveBeenCalledWith(ACTOR, 'active');
		});
	});

	describe('authority', () => {
		it('answers 404 for a user that does not exist', async () => {
			users.findAuthStateById.mockResolvedValue(null);

			await expect(service().authority('missing')).rejects.toBeInstanceOf(NotFoundException);
		});

		it('returns the resolved permission set, not just the roles', async () => {
			users.findAuthStateById.mockImplementation(async (id: string) =>
				userFixture(id, { permissions: ['user.index'] }),
			);
			// `revokedAt: null` is not decoration: the resolver treats anything else — including a
			// missing field — as revoked, which is the correct direction to fail in.
			assignments.listActiveForUser.mockResolvedValue([
				{
					userId: TARGET,
					roleId: 'r1',
					assignedAt: '2026-01-01T00:00:00.000Z',
					assignedByUserId: null,
					revokedAt: null,
				},
			]);
			roles.findById.mockResolvedValue(roleFixture({ id: 'r1', permissions: ['order.index'] }));

			const result = await service().authority(TARGET);

			expect(result.roles).toHaveLength(1);
			expect(result.effectivePermissions).toEqual(['order.index', 'user.index']);
		});
	});
});
