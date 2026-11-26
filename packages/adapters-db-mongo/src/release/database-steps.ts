import { PERMISSION_CODES } from '@saha-textile/contracts';
import { pendingMigrations, type DataMigration, type ReleaseStep } from '@saha-textile/core-domain';
import type { Model } from 'mongoose';

import { reconcileIndexes } from '../migrations/reconcile-indexes';
import * as models from '../models/index';
import { ReleaseMigrationModel, RoleModel } from '../models/index';
import { seedFirstRun } from '../seed/first-run';
import { SYSTEM_ROLE_IDS } from '../seed/system-roles';
import { DATA_MIGRATIONS } from './data-migrations';

/** Every exported model, so an index divergence cannot hide in a collection nobody listed. */
export function allModels(): Model<never>[] {
	return Object.entries(models)
		.filter(([name, value]) => name.endsWith('Model') && typeof value === 'function')
		.map(([, value]) => value as unknown as Model<never>);
}

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/**
 * System roles, currencies and message templates (first-run setup), then the check the deploy
 * never had: the Administrator role must hold every permission code this release knows.
 */
export function systemRolesStep(roleId: string = SYSTEM_ROLE_IDS.administrator): ReleaseStep {
	return {
		key: 'system-roles',
		label: 'System roles and permissions',
		cadence: 'every-release',
		needed: async () => ({ needed: true, reason: 'refresh the Administrator role, currencies and templates' }),
		run: async () => {
			const { currencies, templates } = await seedFirstRun();
			return `roles refreshed; added ${plural(currencies, 'currency', 'currencies')} and ${plural(templates, 'template')}`;
		},
		check: async () => {
			const role = await RoleModel.findById(roleId).lean<{ permissions?: string[]; isSystem?: boolean }>().exec();
			if (!role) return { ok: false, detail: 'the Administrator role is missing' };
			const held = new Set(role.permissions ?? []);
			const missing = PERMISSION_CODES.filter((code) => !held.has(code));
			if (missing.length) return { ok: false, detail: `the Administrator role lacks ${missing.join(', ')}` };
			if (!role.isSystem) return { ok: false, detail: 'the Administrator role is not marked as a system role' };
			return { ok: true, detail: `Administrator holds all ${PERMISSION_CODES.length} permissions` };
		},
	};
}

/**
 * Database indexes: compared with the models, then rebuilt where they differ, before the apps
 * start, so a new index is never built under shoppers and a changed one is never left behind.
 */
export function databaseIndexesStep(list: () => Model<never>[] = allModels): ReleaseStep {
	const describe = (report: Awaited<ReturnType<typeof reconcileIndexes>>) =>
		report.entries
			.filter((entry) => !entry.alreadyAligned)
			.map((entry) => `${entry.collection} (${[...entry.dropped, ...entry.missing].join(', ')})`)
			.join('; ');
	return {
		key: 'database-indexes',
		label: 'Database indexes',
		cadence: 'when-changed',
		needed: async () => {
			const report = await reconcileIndexes(list(), { dryRun: true });
			const changes = report.dropped + report.missing;
			return changes
				? {
						needed: true,
						reason: `${plural(changes, 'index', 'indexes')} to build or rebuild: ${describe(report)}`,
					}
				: { needed: false, reason: 'every index matches the models' };
		},
		run: async () => {
			const report = await reconcileIndexes(list());
			return `rebuilt ${report.dropped}, created ${report.missing}`;
		},
		check: async () => {
			const report = await reconcileIndexes(list(), { dryRun: true });
			const left = report.dropped + report.missing;
			return left
				? { ok: false, detail: `still different: ${describe(report)}` }
				: {
						ok: true,
						detail: `every index matches the models in ${plural(report.entries.length, 'collection')}`,
					};
		},
	};
}

/** Data migrations: each one runs once per database, in id order, and is recorded. */
export function dataMigrationsStep(
	migrations: readonly DataMigration[] = DATA_MIGRATIONS,
	clock: () => number = Date.now,
): ReleaseStep {
	const applied = async () =>
		new Set((await ReleaseMigrationModel.find({}, { _id: 1 }).lean().exec()).map((row) => String(row._id)));
	return {
		key: 'data-migrations',
		label: 'Data migrations',
		cadence: 'once',
		needed: async () => {
			const pending = pendingMigrations(migrations, await applied());
			return pending.length
				? {
						needed: true,
						reason: `${plural(pending.length, 'migration')} pending: ${pending.map((m) => m.id).join(', ')}`,
					}
				: { needed: false, reason: 'nothing pending' };
		},
		run: async () => {
			const done: string[] = [];
			for (const migration of pendingMigrations(migrations, await applied())) {
				const started = clock();
				const result = await migration.up();
				await ReleaseMigrationModel.create({
					_id: migration.id,
					description: migration.description,
					half: migration.half,
					result,
					ranAt: new Date(started),
					ms: clock() - started,
				});
				done.push(`${migration.id}: ${result}`);
			}
			return done.join('; ');
		},
		check: async () => {
			const left = pendingMigrations(migrations, await applied());
			return left.length
				? { ok: false, detail: `not recorded: ${left.map((m) => m.id).join(', ')}` }
				: { ok: true, detail: `${plural(migrations.length, 'migration')} recorded` };
		},
	};
}
