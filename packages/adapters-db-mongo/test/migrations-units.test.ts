import { describe, expect, it, vi } from 'vitest';

import { COLLECTION_NAMES } from '../src/collection-names';
import { alignCollectionNames } from '../src/migrations/align-collection-names';
import { extractCredentials } from '../src/migrations/extract-credentials';
import { reconcileIndexes } from '../src/migrations/reconcile-indexes';
import { renameAdminUserPermissions } from '../src/migrations/rename-admin-user-permissions';
import { splitAdminUsers, toAdminUserId, toCustomerId } from '../src/migrations/split-admin-users';

type Row = Record<string, unknown> & { _id: string };

/** Enough of a collection for the migrations, kept in memory so no real data is ever near them. */
const memoryCollection = (rows: Row[] = []) => {
	const matches = (row: Row, filter: Record<string, unknown>) =>
		Object.entries(filter).every(([key, wanted]) => {
			if (key === '$or') return true;
			const value = row[key];
			if (wanted && typeof wanted === 'object') {
				const { $in, $nin, $regex } = wanted as { $in?: unknown[]; $nin?: unknown[]; $regex?: string };
				if ($in) return $in.includes(value);
				if ($nin) return !$nin.includes(value);
				if ($regex) return new RegExp($regex).test(String(value));
			}
			return value === wanted;
		});
	return {
		rows,
		find: (filter: Record<string, unknown> = {}) => ({
			toArray: async () => rows.filter((row) => matches(row, filter)),
		}),
		findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
		countDocuments: async (filter: Record<string, unknown> = {}) =>
			rows.filter((row) => matches(row, filter)).length,
		insertMany: vi.fn(async (docs: Row[]) => {
			rows.push(...docs);
		}),
		insertOne: vi.fn(async (doc: Row) => {
			rows.push(doc);
		}),
		updateOne: vi.fn(async () => {}),
		updateMany: vi.fn(async () => {}),
		deleteOne: vi.fn(async (filter: Record<string, unknown>) => {
			const index = rows.findIndex((row) => matches(row, filter));
			if (index >= 0) rows.splice(index, 1);
		}),
		deleteMany: vi.fn(async (filter: Record<string, unknown>) => {
			for (const row of rows.filter((candidate) => matches(candidate, filter))) rows.splice(rows.indexOf(row), 1);
		}),
	};
};

type Memory = ReturnType<typeof memoryCollection>;

const memoryDb = (collections: Record<string, Memory>) => {
	const db = {
		listCollections: (filter: { name?: string } = {}) => ({
			toArray: async () =>
				Object.keys(collections)
					.filter((name) => !filter.name || name === filter.name)
					.map((name) => ({ name })),
		}),
		collection: (name: string) => (collections[name] ??= memoryCollection()),
	};
	return { db, collection: db.collection } as never;
};

describe('extractCredentials', () => {
	const build = (customers: Row[], admins: Row[]) => {
		const stores = {
			[COLLECTION_NAMES.Customer]: memoryCollection(customers),
			[COLLECTION_NAMES.AdminUser]: memoryCollection(admins),
			[COLLECTION_NAMES.PasswordCredential]: memoryCollection(),
			[COLLECTION_NAMES.PinCredential]: memoryCollection(),
			[COLLECTION_NAMES.AuthIdentity]: memoryCollection(),
		};
		return { stores, connection: memoryDb(stores) };
	};
	const customers = (): Row[] => [
		{
			_id: 'c1',
			passwordHash: 'h',
			identities: [
				{ provider: 'google', providerId: 'g1', email: 'a@example.test' },
				{ email: 'b@example.test' },
				{},
			],
		},
		{ _id: 'c2', passwordHash: '', identities: [] },
		{ _id: 'c3', identities: 'not a list' },
	];
	const admins = (): Row[] => [
		{
			_id: 'a1',
			passwordHash: 'h',
			pinHash: 'p',
			failedPinAttempts: 2,
			pinLockedUntil: 'x',
			pinRevalidationRequiredAt: 'y',
		},
		{ _id: 'a2', pinHash: 'p', failedPinAttempts: 'many' },
		{ _id: 'a3', passwordHash: '', pinHash: '' },
	];

	it('copies everything out and removes it from the account', async () => {
		const { stores, connection } = build(customers(), admins());
		expect(await extractCredentials(connection)).toEqual({
			passwordCredentialsUpserted: 2,
			pinCredentialsUpserted: 2,
			authIdentitiesUpserted: 3,
			customersUnset: 3,
			adminUsersUnset: 3,
		});
		const identities = stores[COLLECTION_NAMES.AuthIdentity]?.updateOne.mock.calls as unknown as Array<
			[{ provider: string; providerSubject: string }, { $set: { email: string | null } }]
		>;
		expect(identities.map((call) => call[0])).toEqual([
			{ provider: 'google', providerSubject: 'g1' },
			{ provider: 'password', providerSubject: 'b@example.test' },
			{ provider: 'password', providerSubject: 'c1:2' },
		]);
		expect(identities[2]?.[1].$set.email).toBeNull();
		const pins = stores[COLLECTION_NAMES.PinCredential]?.updateOne.mock.calls as unknown as Array<
			[unknown, { $set: Record<string, unknown> }]
		>;
		expect(pins[0]?.[1].$set).toMatchObject({
			failedPinAttempts: 2,
			pinLockedUntil: 'x',
			pinRevalidationRequiredAt: 'y',
		});
		expect(pins[1]?.[1].$set).toMatchObject({
			failedPinAttempts: 0,
			pinLockedUntil: null,
			pinRevalidationRequiredAt: null,
		});
	});

	it('changes nothing on a dry run', async () => {
		const { stores, connection } = build(customers(), admins());
		const report = await extractCredentials(connection, { dryRun: true });
		expect(report.passwordCredentialsUpserted).toBe(2);
		for (const store of Object.values(stores)) expect(store.updateOne).not.toHaveBeenCalled();
	});
});

describe('reconcileIndexes', () => {
	const model = (declared: unknown[], live: unknown[] | Error, sync: () => Promise<unknown> = async () => {}) =>
		({
			schema: { indexes: () => declared },
			collection: {
				collectionName: 'things',
				indexes: async () => {
					if (live instanceof Error) throw live;
					return live;
				},
			},
			syncIndexes: vi.fn(sync),
		}) as never;

	it('reports an aligned collection and does not touch it', async () => {
		const aligned = model(
			[
				[{ a: 1 }, { unique: true, partialFilterExpression: { a: { $type: 'string' } } }],
				[{ b: 1 }, undefined],
			],
			[
				{ name: '_id_', key: { _id: 1 } },
				{ name: 'a_1', key: { a: 1 }, unique: true, partialFilterExpression: { a: { $type: 'string' } } },
				{ name: 'b_1', key: { b: 1 } },
			],
		);
		expect(await reconcileIndexes([aligned])).toMatchObject({
			dropped: 0,
			missing: 0,
			entries: [{ collection: 'things', alreadyAligned: true }],
		});
		expect((aligned as { syncIndexes: unknown }).syncIndexes).not.toHaveBeenCalled();
	});

	it('finds leftovers, divergent options and missing indexes, then rebuilds', async () => {
		const drifted = model(
			[
				[{ a: 1 }, { unique: true }],
				[{ b: 1 }, { partialFilterExpression: { b: 1 } }],
				[{ c: 1 }, {}],
			],
			[
				{ name: 'old_1', key: { old: 1 } },
				{ name: 'a_1', key: { a: 1 } },
				{ name: 'b_1', key: { b: 1 } },
			],
		);
		const report = await reconcileIndexes([drifted]);
		expect(report.entries[0]).toMatchObject({
			dropped: ['old_1', 'a_1', 'b_1'],
			missing: ['{"c":1}'],
			alreadyAligned: false,
		});
		expect((drifted as { syncIndexes: unknown }).syncIndexes).toHaveBeenCalledTimes(1);
	});

	it('only reports on a dry run', async () => {
		const drifted = model([[{ c: 1 }, {}]], []);
		expect((await reconcileIndexes([drifted], { dryRun: true })).dryRun).toBe(true);
		expect((drifted as { syncIndexes: unknown }).syncIndexes).not.toHaveBeenCalled();
	});

	it('treats a collection that does not exist yet as having no indexes', async () => {
		const unborn = model([], Object.assign(new Error('ns not found'), { code: 26 }));
		expect((await reconcileIndexes([unborn])).entries[0]?.alreadyAligned).toBe(true);
	});

	it('passes on any other read failure', async () => {
		await expect(reconcileIndexes([model([], new Error('denied'))])).rejects.toThrow('denied');
	});

	it('names the collection when a rebuild fails', async () => {
		const failing = (reason: unknown) => model([[{ c: 1 }, {}]], [], () => Promise.reject(reason));
		await expect(reconcileIndexes([failing(new Error('bad spec'))])).rejects.toThrow(
			/things: index rebuild failed.*bad spec/s,
		);
		await expect(reconcileIndexes([failing('plain text')])).rejects.toThrow(/plain text/);
	});
});

describe('alignCollectionNames', () => {
	const connection = (names: string[]) => {
		const renameCollection = vi.fn(async () => {});
		const db = {
			listCollections: () => ({ toArray: async () => names.map((name) => ({ name })) }),
			collection: () => ({ countDocuments: async () => 4 }),
			renameCollection,
		};
		return { connection: { db } as never, renameCollection };
	};

	it('needs a connection', async () => {
		await expect(alignCollectionNames({ db: undefined } as never)).rejects.toThrow('established connection');
	});

	it('renames, reports conflicts, and skips what is aligned or absent', async () => {
		const { connection: open, renameCollection } = connection(['old', 'both_old', 'both_new', 'done_new']);
		const report = await alignCollectionNames(open, {
			pairs: { old: 'new', both_old: 'both_new', done_old: 'done_new', gone_old: 'gone_new' },
		});
		expect(report.entries.map((entry) => entry.outcome)).toEqual([
			'renamed',
			'conflict',
			'already-aligned',
			'absent',
		]);
		expect(report).toMatchObject({ renamed: 1, conflicts: 1, dryRun: false });
		expect(renameCollection).toHaveBeenCalledWith('old', 'new');
	});

	it('uses the known pairs and renames nothing on a dry run', async () => {
		const { connection: open, renameCollection } = connection([]);
		const report = await alignCollectionNames(open, { dryRun: true });
		expect(report.entries.length).toBeGreaterThan(0);
		expect(report.entries.every((entry) => entry.outcome === 'absent')).toBe(true);
		const dry = connection(['old']);
		expect((await alignCollectionNames(dry.connection, { dryRun: true, pairs: { old: 'new' } })).renamed).toBe(1);
		expect(dry.renameCollection).not.toHaveBeenCalled();
		expect(renameCollection).not.toHaveBeenCalled();
	});
});

describe('ids', () => {
	it('rewrites every prefix', () => {
		expect(toAdminUserId('cus_a')).toBe('adm_a');
		expect(toAdminUserId('plain')).toBe('adm_plain');
		expect(toCustomerId('plain')).toBe('cus_plain');
	});
});

describe('splitAdminUsers', () => {
	const stores = (customers: Row[], admins?: Row[], extra: Record<string, Memory> = {}) => ({
		[COLLECTION_NAMES.Customer]: memoryCollection(customers),
		...(admins ? { [COLLECTION_NAMES.AdminUser]: memoryCollection(admins) } : {}),
		...extra,
	});

	it('needs a connection', async () => {
		await expect(splitAdminUsers({ db: undefined } as never)).rejects.toThrow('established connection');
	});

	it('reports a missing source', async () => {
		expect(await splitAdminUsers(memoryDb({}))).toMatchObject({
			outcome: 'absent',
			message: expect.stringContaining('absent'),
		});
	});

	it('reports nothing to do', async () => {
		expect(await splitAdminUsers(memoryDb(stores([{ _id: 'cus_1' }])))).toMatchObject({
			outcome: 'absent',
			message: 'nothing to split or rewrite',
		});
	});

	it('reports a finished split and a conflict', async () => {
		expect(await splitAdminUsers(memoryDb(stores([], [{ _id: 'adm_1' }])))).toMatchObject({
			outcome: 'already-split',
		});
		expect(
			await splitAdminUsers(memoryDb(stores([{ _id: 'user_1', role: 'admin' }], [{ _id: 'adm_1' }]))),
		).toMatchObject({
			outcome: 'conflict',
		});
	});

	it('moves operators, rewrites customers, and updates foreign keys', async () => {
		const sessions = memoryCollection([{ _id: 's1', userId: 'user_op' }]);
		const open = stores(
			[
				{ _id: 'user_op', role: 'admin', email: 'a@example.test', orphanField: 'x' },
				{ _id: 'adm_kept', role: 'staff' },
				{ _id: 'user_c1', username: 'old' },
				{ _id: 'cus_c2', role: 'customer' },
				{ _id: 'cus_c3' },
			],
			undefined,
			{ [COLLECTION_NAMES.AuthSession]: sessions },
		);
		const report = await splitAdminUsers(memoryDb(open));
		expect(report).toMatchObject({
			outcome: 'split',
			operatorsMoved: 2,
			customersRewritten: 2,
			foreignKeysUpdated: 1,
		});
		expect(report.idMap).toMatchObject({ user_op: 'adm_op', adm_kept: 'adm_kept', user_c1: 'cus_c1' });
		expect(report.message).toContain('moved 2 operators');
		expect(sessions.updateMany).toHaveBeenCalledWith({ userId: 'user_op' }, { $set: { userId: 'adm_op' } });
		const customers = open[COLLECTION_NAMES.Customer] as Memory;
		expect(customers.rows.map((row) => row._id).sort()).toEqual(['cus_c1', 'cus_c2', 'cus_c3']);
		expect(customers.rows.find((row) => row._id === 'cus_c1')).not.toHaveProperty('username');
		expect(customers.updateOne).toHaveBeenCalledWith({ _id: 'cus_c2' }, { $unset: { role: '' } });
	});

	it('rewrites legacy customers when there are no operators', async () => {
		const report = await splitAdminUsers(memoryDb(stores([{ _id: 'user_only' }])));
		expect(report).toMatchObject({ outcome: 'split', operatorsMoved: 0, customersRewritten: 1 });
	});

	it('skips a customer that vanished mid-run', async () => {
		const open = stores([{ _id: 'user_gone' }]);
		const customers = open[COLLECTION_NAMES.Customer] as Memory;
		customers.findOne = async () => null;
		const report = await splitAdminUsers(memoryDb(open));
		expect(report.outcome).toBe('split');
		expect(customers.insertOne).not.toHaveBeenCalled();
	});

	it('changes nothing on a dry run', async () => {
		const sessions = memoryCollection([{ _id: 's1', userId: 'user_op' }]);
		const open = stores([{ _id: 'user_op', role: 'admin' }], undefined, {
			[COLLECTION_NAMES.AuthSession]: sessions,
		});
		const report = await splitAdminUsers(memoryDb(open), { dryRun: true });
		expect(report.message).toContain('would move 1 operators');
		expect(report.foreignKeysUpdated).toBe(1);
		expect(sessions.updateMany).not.toHaveBeenCalled();
		expect((open[COLLECTION_NAMES.Customer] as Memory).rows).toHaveLength(1);
	});

	it('refuses a row that is not really an operator', async () => {
		const open = stores([{ _id: 'user_x', role: 'customer' }]);
		const customers = open[COLLECTION_NAMES.Customer] as Memory;
		const rows = customers.rows;
		customers.find = () => ({ toArray: async () => rows });
		await expect(splitAdminUsers(memoryDb(open))).rejects.toThrow('refusing to move non-operator');
	});

	it('writes nothing to foreign keys when no id moved', async () => {
		const open = stores([{ _id: 'cus_1', role: 'customer' }], undefined, {});
		const customers = open[COLLECTION_NAMES.Customer] as Memory;
		const original = customers.find;
		let reads = 0;
		customers.find = (filter) => {
			reads += 1;
			return reads === 2 ? { toArray: async () => [{ _id: 'user_1' }] } : original(filter);
		};
		const report = await splitAdminUsers(memoryDb(open), { dryRun: true });
		expect(report.foreignKeysUpdated).toBe(0);
	});

	it('takes custom collection names', async () => {
		const report = await splitAdminUsers(memoryDb({ people: memoryCollection([{ _id: 'cus_1' }]) }), {
			sourceCollection: 'people',
			targetCollection: 'staff',
		});
		expect(report.outcome).toBe('absent');
	});
});

describe('renameAdminUserPermissions', () => {
	const stores = (permissions: unknown) => ({
		[COLLECTION_NAMES.Role]: memoryCollection([{ _id: 'r', permissions }]),
		[COLLECTION_NAMES.AdminUser]: memoryCollection([{ _id: 'a', permissions }]),
		[COLLECTION_NAMES.AdminInvite]: memoryCollection([{ _id: 'i', permissions }]),
	});
	const connection = (open: Record<string, Memory>) => {
		const all = Object.fromEntries(
			Object.entries(open).map(([name, store]) => [name, { ...store, find: () => store.find({}) }]),
		);
		return { collection: (name: string) => all[name] } as never;
	};

	it('changes nothing on a dry run', async () => {
		const open = stores(['catalog.read']);
		const report = await renameAdminUserPermissions(connection(open), { dryRun: true });
		expect(report).toMatchObject({ rolesUpdated: 1, adminUsersUpdated: 1, invitesUpdated: 1 });
		for (const store of Object.values(open)) expect(store.updateOne).not.toHaveBeenCalled();
	});

	it('keeps only text, and copes with a field that is not a list', async () => {
		const open = stores(['catalog.read', 7]);
		await renameAdminUserPermissions(connection(open));
		const [, update] = (open[COLLECTION_NAMES.Role] as Memory).updateOne.mock.calls[0] as unknown as [
			unknown,
			{ $set: { permissions: string[] } },
		];
		expect(update.$set.permissions).toEqual(['catalog.read']);
		const none = stores('nothing');
		await renameAdminUserPermissions(connection(none));
		const [, cleared] = (none[COLLECTION_NAMES.AdminUser] as Memory).updateOne.mock.calls[0] as unknown as [
			unknown,
			{ $set: { permissions: string[] } },
		];
		expect(cleared.$set.permissions).toEqual([]);
	});
});
