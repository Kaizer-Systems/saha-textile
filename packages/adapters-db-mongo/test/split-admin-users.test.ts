import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COLLECTION_NAMES } from '../src/collection-names';
import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { splitAdminUsers, toAdminUserId, toCustomerId } from '../src/migrations/split-admin-users';

function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const P = `it_split_${randomUUID().slice(0, 8)}_`;

describe('toAdminUserId / toCustomerId', () => {
	it('rewrites user_ prefixes and is idempotent on already-prefixed ids', () => {
		expect(toAdminUserId('user_abc')).toBe('adm_abc');
		expect(toAdminUserId('adm_abc')).toBe('adm_abc');
		expect(toCustomerId('user_xyz')).toBe('cus_xyz');
		expect(toCustomerId('cus_xyz')).toBe('cus_xyz');
	});
});

describe.runIf(hasMongoEnv())('splitAdminUsers migration (rs0)', () => {
	const sourceCollection = `${P}customers`;
	const targetCollection = `${P}adminUsers`;

	/** String-id identity fixtures — driver generics assume ObjectId. */
	function coll(name: string) {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no db');
		return db.collection(name) as unknown as {
			insertMany(docs: Record<string, unknown>[]): Promise<unknown>;
			insertOne(doc: Record<string, unknown>): Promise<unknown>;
			findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
			countDocuments(filter?: Record<string, unknown>): Promise<number>;
			deleteMany(filter: Record<string, unknown>): Promise<unknown>;
		};
	}

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const db = getMongoose().connection.db;
		if (!db) return;
		await Promise.all([
			db.dropCollection(sourceCollection).catch(() => undefined),
			db.dropCollection(targetCollection).catch(() => undefined),
			db.collection(COLLECTION_NAMES.AuthSession).deleteMany({ _id: new RegExp(`^${P}`) }),
			db.collection(COLLECTION_NAMES.UserRoleAssignment).deleteMany({ _id: new RegExp(`^${P}`) }),
		]);
		await disconnectMongo();
	});

	it('moves operators, strips fields, rewrites ids and FKs, and is idempotent', async () => {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no db');
		const customers = coll(sourceCollection);
		const admins = coll(targetCollection);
		const sessions = coll(COLLECTION_NAMES.AuthSession);
		const assignments = coll(COLLECTION_NAMES.UserRoleAssignment);

		const operatorOld = `user_${P}op`;
		const shopperOld = `user_${P}shop`;
		const operatorNew = toAdminUserId(operatorOld);
		const shopperNew = toCustomerId(shopperOld);

		await customers.insertMany([
			{
				_id: operatorOld,
				email: `${P}op@example.com`,
				emailVerified: true,
				username: `${P}op`,
				role: 'admin',
				status: 'active',
				passwordHash: 'hash-op',
				pinHash: 'pin-op',
				preferredLoginMethod: 'password',
				permissions: ['catalog.write'],
				tokenVersion: 1,
				permissionsVersion: 2,
				addresses: [{ id: 'a1' }],
				guestCartId: 'cart_should_drop',
				consent: { necessary: true },
			},
			{
				_id: shopperOld,
				email: `${P}shop@example.com`,
				emailVerified: true,
				role: 'customer',
				status: 'active',
				passwordHash: 'hash-shop',
				username: 'should-drop',
				pinHash: 'should-drop-pin',
				permissions: ['should-drop'],
				addresses: [
					{
						id: 'home',
						label: 'Home',
						fullName: 'A',
						line1: '1',
						city: 'Kolkata',
						postalCode: '700001',
						country: 'IN',
					},
				],
			},
		]);

		await sessions.insertOne({
			_id: `${P}sess`,
			userId: operatorOld,
			audience: 'admin',
			roleAtLogin: 'admin',
			refreshTokenHash: 'r',
			refreshFamilyId: `${P}fam`,
			rotationCounter: 0,
			previousRefreshTokenHash: null,
			replacedBySessionId: null,
			csrfSecretHash: 'c',
			device: { userAgentHash: null, ipHash: null, country: null, label: null },
			lastSeenAt: new Date(),
			expiresAt: new Date(Date.now() + 60_000),
			absoluteExpiresAt: new Date(Date.now() + 60_000),
			revokedAt: null,
			revokeReason: null,
			createdAt: new Date(),
		});
		await assignments.insertOne({
			_id: `${P}asg`,
			userId: operatorOld,
			roleId: 'role_system_administrator',
			assignedByUserId: operatorOld,
			assignedAt: new Date(),
			revokedAt: null,
			revokedByUserId: null,
			revokeReason: null,
		});

		const opts = { sourceCollection, targetCollection };

		const dry = await splitAdminUsers(getMongoose().connection, { ...opts, dryRun: true });
		expect(dry.outcome).toBe('split');
		expect(dry.operatorsMoved).toBe(1);
		expect(await customers.countDocuments({ _id: operatorOld })).toBe(1);
		expect(await admins.countDocuments({ email: `${P}op@example.com` })).toBe(0);

		const first = await splitAdminUsers(getMongoose().connection, opts);
		expect(first.outcome).toBe('split');
		expect(first.operatorsMoved).toBe(1);
		expect(first.idMap[operatorOld]).toBe(operatorNew);
		expect(first.idMap[shopperOld]).toBe(shopperNew);

		expect(await customers.findOne({ _id: operatorOld })).toBeNull();
		const admin = await admins.findOne({ _id: operatorNew });
		expect(admin).toMatchObject({
			email: `${P}op@example.com`,
			role: 'admin',
			username: `${P}op`,
			passwordHash: 'hash-op',
			pinHash: 'pin-op',
		});
		expect(admin).not.toHaveProperty('addresses');
		expect(admin).not.toHaveProperty('guestCartId');
		expect(admin).not.toHaveProperty('consent');

		const shopper = await customers.findOne({ _id: shopperNew });
		expect(shopper).toMatchObject({ email: `${P}shop@example.com`, passwordHash: 'hash-shop' });
		expect(shopper).not.toHaveProperty('role');
		expect(shopper).not.toHaveProperty('username');
		expect(shopper).not.toHaveProperty('pinHash');
		expect(shopper).not.toHaveProperty('permissions');
		expect(await customers.findOne({ _id: shopperOld })).toBeNull();

		expect(await sessions.findOne({ _id: `${P}sess` })).toMatchObject({ userId: operatorNew });
		expect(await assignments.findOne({ _id: `${P}asg` })).toMatchObject({
			userId: operatorNew,
			assignedByUserId: operatorNew,
		});

		const second = await splitAdminUsers(getMongoose().connection, opts);
		expect(second.outcome).toBe('already-split');
		expect(second.operatorsMoved).toBe(0);
		expect(await admins.countDocuments({ email: `${P}op@example.com` })).toBe(1);
	});

	it('refuses when adminUsers is already populated and operators remain in customers', async () => {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no db');
		const conflictSource = `${P}conflict_customers`;
		const conflictTarget = `${P}conflict_admins`;
		const customers = coll(conflictSource);
		const admins = coll(conflictTarget);

		await admins.insertOne({
			_id: `adm_${P}existing`,
			email: `${P}existing@example.com`,
			role: 'staff',
			status: 'active',
		});
		await customers.insertOne({
			_id: `user_${P}leftover`,
			email: `${P}leftover@example.com`,
			role: 'staff',
			status: 'active',
		});

		const report = await splitAdminUsers(getMongoose().connection, {
			sourceCollection: conflictSource,
			targetCollection: conflictTarget,
		});
		expect(report.outcome).toBe('conflict');
		expect(await customers.findOne({ _id: `user_${P}leftover` })).not.toBeNull();

		await db.dropCollection(conflictSource).catch(() => undefined);
		await db.dropCollection(conflictTarget).catch(() => undefined);
	});
});
