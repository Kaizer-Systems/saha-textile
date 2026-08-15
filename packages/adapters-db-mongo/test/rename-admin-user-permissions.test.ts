import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTION_NAMES } from '../src/collection-names';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { renameAdminUserPermissions } from '../src/migrations/rename-admin-user-permissions';

const runDb = process.env.RUN_DB_IT === '1';

describe.runIf(runDb)('renameAdminUserPermissions', () => {
	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await disconnectMongo();
	});

	beforeEach(async () => {
		const db = getMongoose().connection;
		await Promise.all([
			db.collection(COLLECTION_NAMES.Role).deleteMany({}),
			db.collection(COLLECTION_NAMES.AdminUser).deleteMany({}),
			db.collection(COLLECTION_NAMES.AdminInvite).deleteMany({}),
		]);
	});

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
});
