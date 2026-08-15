import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTION_NAMES } from '../src/collection-names';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { renameAdminUserPermissions } from '../src/migrations/rename-admin-user-permissions';

const runDb = process.env.RUN_DB_IT === '1';

describe.runIf(runDb)('renameAdminUserPermissions', () => {
	beforeAll(async () => {
		await connectMongo();
	});

	/**
	 * Cleared BEFORE each case and again AFTER the last one.
	 *
	 * `beforeEach` alone left the final case's fixtures sitting in the database, and this
	 * suite shares `saha_textile_local` with the running dev app. Those rows are deliberately
	 * minimal — a `_id` and a `permissions` array, no `createdAt` — which is all the migration
	 * reads, but not what `toRole` needs: `GET /admin/roles` threw `RangeError: Invalid time
	 * value` on the leftover row and the whole Roles screen 500'd. The migration under test was
	 * fine; the debris was not. Verified by browser on 2026-08-15.
	 */
	const clearFixtures = async () => {
		const db = getMongoose().connection;
		await Promise.all([
			db.collection(COLLECTION_NAMES.Role).deleteMany({}),
			db.collection(COLLECTION_NAMES.AdminUser).deleteMany({}),
			db.collection(COLLECTION_NAMES.AdminInvite).deleteMany({}),
		]);
	};

	afterAll(async () => {
		await clearFixtures();
		await disconnectMongo();
	});

	beforeEach(clearFixtures);

	it('rewrites legacy user.* codes and is idempotent', async () => {
		const db = getMongoose().connection;
		await db.collection(COLLECTION_NAMES.Role).insertOne({
			_id: 'role_custom',
			permissions: ['user.index', 'product.index', 'user.create'],
		} as never);
		await db.collection(COLLECTION_NAMES.AdminUser).insertOne({
			_id: 'adm_1',
			permissions: ['user.update', 'order.index'],
		} as never);
		await db.collection(COLLECTION_NAMES.AdminInvite).insertOne({
			_id: 'inv_1',
			permissions: ['user.create'],
		} as never);

		const first = await renameAdminUserPermissions(db);
		expect(first).toEqual({
			rolesUpdated: 1,
			adminUsersUpdated: 1,
			invitesUpdated: 1,
			codesRewritten: 4,
		});

		const role = await db.collection(COLLECTION_NAMES.Role).findOne({ _id: 'role_custom' } as never);
		expect(role?.permissions).toEqual(['admin_user.create', 'admin_user.index', 'product.index']);

		const second = await renameAdminUserPermissions(db);
		expect(second).toEqual({
			rolesUpdated: 0,
			adminUsersUpdated: 0,
			invitesUpdated: 0,
			codesRewritten: 0,
		});
	});

	/**
	 * The `user_role.*` pair, added to the map on 2026-08-15 with the assignment-family rename.
	 *
	 * Worth its own case rather than extra entries in the one above: these are the codes that
	 * gate GRANTING and REVOKING authority, so a role that silently lost them would leave an
	 * administrator unable to manage anyone — a failure that looks like a permissions bug long
	 * after the migration is forgotten. The assertion is on the resulting array, not just the
	 * counter, because a rewrite that dropped a code would still report the same count.
	 */
	it('rewrites the retired user_role.* grant codes', async () => {
		const db = getMongoose().connection;
		await db.collection(COLLECTION_NAMES.Role).insertOne({
			_id: 'role_grantor',
			permissions: ['user_role.assign', 'user_role.revoke', 'role.index'],
		} as never);
		await db.collection(COLLECTION_NAMES.AdminInvite).insertOne({
			_id: 'inv_grantor',
			permissions: ['user_role.assign'],
		} as never);

		const report = await renameAdminUserPermissions(db);
		expect(report.codesRewritten).toBe(3);

		const role = await db.collection(COLLECTION_NAMES.Role).findOne({ _id: 'role_grantor' } as never);
		expect(role?.permissions).toEqual(['admin_user_role.assign', 'admin_user_role.revoke', 'role.index']);

		const invite = await db.collection(COLLECTION_NAMES.AdminInvite).findOne({ _id: 'inv_grantor' } as never);
		expect(invite?.permissions).toEqual(['admin_user_role.assign']);

		expect((await renameAdminUserPermissions(db)).codesRewritten).toBe(0);
	});
});
