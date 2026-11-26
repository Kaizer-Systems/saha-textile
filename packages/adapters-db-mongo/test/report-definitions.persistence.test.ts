import { ReportDefinition } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { ReportDefinitionModel } from '../src/models/bank.model';
import { MongoReportDefinitionRepository } from '../src/repositories/report-definition.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Reports saved from the builder (accounts brief V2), saved over the version read:
 *   node scripts/secrets/test-login.mjs run saha_textile_reports_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/report-definitions.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('saved reports (integration, rs0)', () => {
	const at = '2026-11-28T06:00:00.000Z';
	/** Ids no other suite uses, so only this file's rows are cleared and listed. */
	const PREFIX = 'rpt_dbtest_';
	const wipe = () => ReportDefinitionModel.deleteMany({ _id: { $regex: /^rpt_dbtest_/ } });
	const repo = new MongoReportDefinitionRepository();
	const mine = async () => (await repo.list()).filter((d) => d.id.startsWith(PREFIX));

	const definition = (id: string, over: Partial<ReportDefinition> = {}): ReportDefinition =>
		ReportDefinition.parse({
			id: `${PREFIX}${id}`,
			name: `Report ${id}`,
			folder: 'Saved by you',
			spec: { dataset: 'invoices', columns: ['buyer', 'margin'], totals: ['margin'] },
			from: '2026-11-01',
			to: '2026-11-30',
			createdBy: 'adm_a',
			createdByName: 'Rina Das',
			createdAt: at,
			updatedAt: at,
			version: 0,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps saved reports and lists them by folder, then name', async () => {
		await repo.insert(definition('b', { folder: 'Sales', name: 'Margin by buyer' }));
		await repo.insert(definition('a', { folder: 'Sales', name: 'GST by month' }));
		await repo.insert(definition('c', { folder: 'Expenses', name: 'Rent' }));
		expect((await mine()).map((d) => [d.folder, d.name])).toEqual([
			['Expenses', 'Rent'],
			['Sales', 'GST by month'],
			['Sales', 'Margin by buyer'],
		]);
		expect(await repo.get(`${PREFIX}a`)).toEqual(definition('a', { folder: 'Sales', name: 'GST by month' }));
		expect(await repo.get(`${PREFIX}gone`)).toBeNull();
	});

	it('saves a change over the version read, one higher, and refuses a version someone saved over', async () => {
		const changed = await repo.save(definition('a', { folder: 'Sales', name: 'GST by quarter' }), 0);
		expect(changed.version).toBe(1);
		expect(await repo.get(`${PREFIX}a`)).toMatchObject({ name: 'GST by quarter', version: 1 });
		await expect(repo.save(definition('a', { name: 'Too late' }), 0)).rejects.toThrow('report_definition_changed');
		await expect(repo.save(definition('never'), 0)).rejects.toThrow('report_definition_changed');
	});

	it('deletes a saved report, saying whether there was one', async () => {
		expect(await repo.remove(`${PREFIX}c`)).toBe(true);
		expect(await repo.remove(`${PREFIX}c`)).toBe(false);
		expect((await mine()).map((d) => d.id)).toEqual([`${PREFIX}a`, `${PREFIX}b`]);
	});
});
