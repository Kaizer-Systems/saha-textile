import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PERMISSION_CODES } from '@saha-textile/contracts';
import { AssignmentAlreadyActiveError } from '@saha-textile/core-domain';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { RoleModel, AdminUserRoleAssignmentModel } from '../src/models/index';
import { MongoRoleRepository, MongoAdminUserRoleAssignmentRepository } from '../src/repositories/role.repository';
import { ensureSystemRoles } from '../src/seed/system-roles';

/**
 * RBAC persistence against a REAL replica set.
 *
 * The property worth proving here is the unique ACTIVE assignment constraint, and it cannot
 * be proven with a fake: the whole point is that the database arbitrates a race two
 * application reads would both lose. A partial unique index either exists and rejects the
 * second concurrent grant, or it does not, and only Mongo can answer that.
 *
 *   MONGODB_PORT=27018 RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const now = () => new Date().toISOString();

const roleFixture = (overrides: Record<string, unknown> = {}) => ({
	id: `role_rbac_it_${randomUUID()}`,
	key: `rbac-it-${randomUUID().slice(0, 8)}`,
	label: 'Integration role',
	description: null,
	baseRole: 'staff' as const,
	permissions: ['product.index' as const],
	isSystem: false,
	createdAt: now(),
	updatedAt: now(),
	...overrides,
});

const assignmentFixture = (userId: string, roleId: string, overrides: Record<string, unknown> = {}) => ({
	id: `ura_rbac_it_${randomUUID()}`,
	userId,
	roleId,
	assignedByUserId: null,
	assignedAt: now(),
	revokedAt: null,
	revokedByUserId: null,
	revokeReason: null,
	...overrides,
});

describe.skipIf(!hasMongoEnv())('RBAC persistence (integration, rs0)', () => {
	const roles = new MongoRoleRepository();
	const assignments = new MongoAdminUserRoleAssignmentRepository();

	beforeAll(async () => {
		await connectMongo(buildMongoConfig());
		// The constraint under test IS an index, so it must actually be built before asserting.
		await Promise.all([RoleModel.syncIndexes(), AdminUserRoleAssignmentModel.syncIndexes()]);
	});

	afterAll(async () => {
		await Promise.all([
			RoleModel.deleteMany({ _id: /^role_rbac_it/ }).exec(),
			// Seeded by the system-role suite below; removed so the suite leaves nothing behind.
			RoleModel.deleteMany({ _id: 'role_system_administrator' }).exec(),
			AdminUserRoleAssignmentModel.deleteMany({ _id: /^ura_rbac_it/ }).exec(),
		]);
		await disconnectMongo();
	});

	describe('roles', () => {
		it('round-trips a role and finds it by its stable key', async () => {
			const role = roleFixture();
			await roles.create(role);

			expect(await roles.findById(role.id)).toMatchObject({ key: role.key, baseRole: 'staff' });
			expect(await roles.findByKey(role.key)).toMatchObject({ id: role.id });
		});

		it('refuses a second role with the same key', async () => {
			const first = roleFixture();
			await roles.create(first);

			await expect(roles.create(roleFixture({ key: first.key }))).rejects.toThrow();
		});

		it('updates only the mutable half', async () => {
			const role = roleFixture();
			await roles.create(role);

			const updated = await roles.update(role.id, { label: 'Renamed', permissions: ['order.index'] });

			expect(updated).toMatchObject({ label: 'Renamed', permissions: ['order.index'], key: role.key });
		});

		/**
		 * System roles are the last route back into a locked-out back office, so the surface
		 * that manages roles must not be able to remove them.
		 */
		it('will not update or delete a system role', async () => {
			const role = roleFixture({ isSystem: true });
			await roles.create(role);

			expect(await roles.update(role.id, { label: 'Hijacked' })).toBeNull();
			expect(await roles.deleteById(role.id)).toBe(false);
			expect(await roles.findById(role.id)).toMatchObject({ label: 'Integration role' });
		});

		it('deletes an ordinary role', async () => {
			const role = roleFixture();
			await roles.create(role);

			expect(await roles.deleteById(role.id)).toBe(true);
			expect(await roles.findById(role.id)).toBeNull();
		});
	});

	describe('assignments', () => {
		it('grants a role and reports it as active', async () => {
			const role = roleFixture();
			await roles.create(role);
			const userId = `user_rbac_it_${randomUUID()}`;

			await assignments.assign(assignmentFixture(userId, role.id));

			expect(await assignments.listActiveForUser(userId)).toHaveLength(1);
			expect(await assignments.findActive(userId, role.id)).not.toBeNull();
			expect(await assignments.listActiveForRole(role.id)).toHaveLength(1);
		});

		it('rejects a second ACTIVE grant of the same role as a named domain error', async () => {
			const role = roleFixture();
			await roles.create(role);
			const userId = `user_rbac_it_${randomUUID()}`;
			await assignments.assign(assignmentFixture(userId, role.id));

			// Not a raw driver error: callers must be able to tell "already granted" from
			// "the write failed" without reading MongoDB error codes.
			await expect(assignments.assign(assignmentFixture(userId, role.id))).rejects.toBeInstanceOf(
				AssignmentAlreadyActiveError,
			);
		});

		/**
		 * The reason uniqueness is PARTIAL. A plain unique index on (userId, roleId) would
		 * enforce one-at-a-time and permanently prevent re-granting, because the revoked row
		 * still exists.
		 */
		it('allows re-granting a role after it was revoked', async () => {
			const role = roleFixture();
			await roles.create(role);
			const userId = `user_rbac_it_${randomUUID()}`;
			await assignments.assign(assignmentFixture(userId, role.id));

			const revoked = await assignments.revoke({
				userId,
				roleId: role.id,
				revokedByUserId: null,
				reason: 'offboarding',
				revokedAt: now(),
			});
			expect(revoked?.revokedAt).not.toBeNull();

			await expect(assignments.assign(assignmentFixture(userId, role.id))).resolves.toMatchObject({ userId });

			// History is kept, not overwritten: one live row, two rows total.
			expect(await assignments.listActiveForUser(userId)).toHaveLength(1);
			expect(await assignments.listAllForUser(userId)).toHaveLength(2);
		});

		it('revoking twice is idempotent and does not rewrite when it happened', async () => {
			const role = roleFixture();
			await roles.create(role);
			const userId = `user_rbac_it_${randomUUID()}`;
			await assignments.assign(assignmentFixture(userId, role.id));

			const first = await assignments.revoke({
				userId,
				roleId: role.id,
				revokedByUserId: null,
				reason: 'first',
				revokedAt: now(),
			});
			const second = await assignments.revoke({
				userId,
				roleId: role.id,
				revokedByUserId: null,
				reason: 'second',
				revokedAt: now(),
			});

			expect(first).not.toBeNull();
			expect(second).toBeNull();
			expect((await assignments.listAllForUser(userId))[0]?.revokeReason).toBe('first');
		});

		/**
		 * The race the index exists for. Both writes are issued before either resolves, so
		 * no application-level read could have separated them — exactly one must survive.
		 */
		it('lets exactly one of two concurrent grants win', async () => {
			const role = roleFixture();
			await roles.create(role);
			const userId = `user_rbac_it_${randomUUID()}`;

			const results = await Promise.allSettled([
				assignments.assign(assignmentFixture(userId, role.id)),
				assignments.assign(assignmentFixture(userId, role.id)),
			]);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
			expect(rejected.reason).toBeInstanceOf(AssignmentAlreadyActiveError);
			expect(await assignments.listActiveForUser(userId)).toHaveLength(1);
		});

		it('does not leak one user’s assignments into another’s', async () => {
			const role = roleFixture();
			await roles.create(role);
			const mine = `user_rbac_it_${randomUUID()}`;
			const theirs = `user_rbac_it_${randomUUID()}`;
			await assignments.assign(assignmentFixture(mine, role.id));

			expect(await assignments.listActiveForUser(theirs)).toEqual([]);
			expect(await assignments.findActive(theirs, role.id)).toBeNull();
		});
	});

	/**
	 * The seeder is an operator action, not a bootstrap step, so its idempotency is the
	 * property that matters: re-running it is how a registry addition reaches the role.
	 */
	describe('system roles', () => {
		it('creates the administrator role holding every registry code', async () => {
			await ensureSystemRoles();

			const administrator = await roles.findByKey('administrator');
			expect(administrator).not.toBeNull();
			expect(administrator?.isSystem).toBe(true);
			expect(administrator?.baseRole).toBe('admin');
			expect(administrator?.permissions).toEqual([...PERMISSION_CODES].sort((a, b) => a.localeCompare(b)));
		});

		it('is idempotent, and preserves when the role first appeared', async () => {
			const first = await ensureSystemRoles('2026-01-01T00:00:00.000Z');
			const before = await roles.findByKey('administrator');

			const second = await ensureSystemRoles('2026-06-01T00:00:00.000Z');
			const after = await roles.findByKey('administrator');

			expect(first.created.concat(first.updated)).toContain('administrator');
			expect(second.updated).toContain('administrator');
			expect(after?.createdAt).toBe(before?.createdAt);
			expect(after?.updatedAt).not.toBe(before?.updatedAt);
		});

		/** A seeded role must be exactly as unremovable as an authored system role. */
		it('produces a role the admin surface cannot edit or delete', async () => {
			await ensureSystemRoles();
			const administrator = await roles.findByKey('administrator');

			expect(await roles.update(administrator!.id, { label: 'Hijacked' })).toBeNull();
			expect(await roles.deleteById(administrator!.id)).toBe(false);
		});
	});
});
