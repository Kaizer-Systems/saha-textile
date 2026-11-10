import { randomUUID } from 'node:crypto';

import { PERMISSION_CODES } from '@saha-textile/contracts';
import { runReleaseSteps, type DataMigration } from '@saha-textile/core-domain';
import { Schema, model, type Model } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { ReleaseMigrationModel, RoleModel } from '../src/models/index';
import { allModels, dataMigrationsStep, databaseIndexesStep, systemRolesStep } from '../src/release/database-steps';
import { DATA_MIGRATIONS } from '../src/release/data-migrations';
import { SYSTEM_ROLE_IDS, ensureSystemRoles } from '../src/seed/system-roles';
import { hasMongoEnv } from './mongo-test-env';

describe('release steps without a database', () => {
	it('lists every exported model and keeps the migration list valid', () => {
		expect(allModels().length).toBeGreaterThan(40);
		expect(allModels().every((entry) => typeof entry.collection.collectionName === 'string')).toBe(true);
		expect(() => dataMigrationsStep(DATA_MIGRATIONS)).not.toThrow();
	});
});

describe.skipIf(!hasMongoEnv())('release steps (integration)', () => {
	const suffix = randomUUID().slice(0, 8);
	const ids = [`0001-test-${suffix}`, `0002-test-${suffix}`];
	// A copy of the Administrator role, so other suites editing the real one never race this one.
	const roleId = `role_release_test_${suffix}`;
	let probe: Model<never>;

	beforeAll(async () => {
		await connectMongo();
		const schema = new Schema({ code: String, status: String }, { collection: `releaseProbe_${suffix}` });
		schema.index({ code: 1 }, { unique: true });
		probe = model(`ReleaseProbe_${suffix}`, schema) as unknown as Model<never>;
		await probe.collection.insertOne({ code: 'a', status: 'x' } as never);
		await probe.collection.createIndex({ status: 1 }, { name: 'left_by_hand' });
	});

	afterAll(async () => {
		await ReleaseMigrationModel.deleteMany({ _id: { $in: ids } });
		await probe.collection.drop().catch(() => undefined);
		await RoleModel.deleteOne({ _id: roleId });
		await disconnectMongo();
	});

	it('refreshes the roles and proves the Administrator holds every code', async () => {
		await ensureSystemRoles();
		await expect(systemRolesStep().check()).resolves.toEqual({
			ok: true,
			detail: `Administrator holds all ${PERMISSION_CODES.length} permissions`,
		});

		const admin = await RoleModel.findById(SYSTEM_ROLE_IDS.administrator).lean().exec();
		await RoleModel.collection.insertOne({ ...admin, _id: roleId, key: `release_test_${suffix}` } as never);
		const step = systemRolesStep(roleId);
		await expect(step.check()).resolves.toMatchObject({ ok: true });
		const [first, ...rest] = PERMISSION_CODES;
		await RoleModel.updateOne({ _id: roleId }, { $set: { permissions: rest } });
		await expect(step.check()).resolves.toEqual({ ok: false, detail: `the Administrator role lacks ${first}` });
		await RoleModel.collection.updateOne({ _id: roleId } as never, { $unset: { permissions: '' } });
		await expect(step.check()).resolves.toMatchObject({
			ok: false,
			detail: expect.stringContaining(PERMISSION_CODES[1]),
		});
		await RoleModel.updateOne({ _id: roleId }, { $set: { permissions: [...PERMISSION_CODES], isSystem: false } });
		await expect(step.check()).resolves.toMatchObject({ ok: false, detail: expect.stringContaining('not marked') });
		await RoleModel.deleteOne({ _id: roleId });
		await expect(step.check()).resolves.toEqual({ ok: false, detail: 'the Administrator role is missing' });
	});

	it('builds the missing index, drops the hand-made one, and then reports nothing to do', async () => {
		const step = databaseIndexesStep(() => [probe]);
		const need = await step.needed();
		expect(need.needed).toBe(true);
		expect(need.reason).toContain(`releaseProbe_${suffix}`);
		await expect(step.check()).resolves.toMatchObject({ ok: false });
		// Mongoose may already have built the declared index when the model was compiled.
		await expect(step.run()).resolves.toMatch(/^rebuilt 1, created [01]$/);
		await expect(step.check()).resolves.toEqual({
			ok: true,
			detail: 'every index matches the models in 1 collection',
		});
		await expect(step.needed()).resolves.toEqual({ needed: false, reason: 'every index matches the models' });
	});

	it('runs each migration once, records it, and skips it next time', async () => {
		let runs = 0;
		const migrations: DataMigration[] = ids.map((id) => ({
			id,
			description: 'test',
			half: 'expand',
			up: async () => {
				runs += 1;
				return 'touched 0 records';
			},
		}));
		const events: string[] = [];
		const first = await runReleaseSteps([dataMigrationsStep(migrations)], (event) =>
			events.push(`${event.phase}:${event.detail}`),
		);
		expect(first.ran).toEqual(['data-migrations']);
		expect(runs).toBe(2);
		expect(events).toContain(`run:2 migrations pending: ${ids.join(', ')}`);
		expect(await ReleaseMigrationModel.countDocuments({ _id: { $in: ids } })).toBe(2);

		const second = await runReleaseSteps([dataMigrationsStep(migrations)], () => undefined);
		expect(second.skipped).toEqual(['data-migrations']);
		expect(runs).toBe(2);

		await ReleaseMigrationModel.deleteOne({ _id: ids[1] });
		await expect(dataMigrationsStep(migrations).check()).resolves.toEqual({
			ok: false,
			detail: `not recorded: ${ids[1]}`,
		});
	});
});
