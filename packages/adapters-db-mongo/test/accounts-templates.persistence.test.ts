import { AccountsTemplate, TemplateInstall } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { AccountsTemplateModel, TemplateInstallModel } from '../src/models/ledger.model';
import { MongoAccountsTemplateRepository, MongoTemplateInstallRepository } from '../src/repositories/ledger.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Accounts templates and installs (accounts templates T2) against a real replica set:
 *   node scripts/secrets/test-login.mjs run saha_textile_templates_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/accounts-templates.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('accounts templates persistence (integration, rs0)', () => {
	const at = '2026-11-24T10:00:00.000Z';
	const models = [AccountsTemplateModel, TemplateInstallModel];
	const template = AccountsTemplate.parse({
		id: 'tpl_ch_prop',
		code: 'CH-PROP',
		kind: 'chart',
		name: "Proprietor's capital and drawings",
		appliesTo: { all: false, kinds: ['proprietorship'] },
		versions: [
			{
				version: 1,
				validFrom: '2026-04-01',
				publishedAt: at,
				content: {
					kind: 'chart',
					groups: [{ key: 'capital_account', name: 'Capital account', nature: 'liability' }],
					ledgers: [{ key: 'drawings', name: 'Drawings', groupKey: 'capital_account', roles: ['drawings'] }],
				},
			},
		],
		createdAt: at,
		updatedAt: at,
	});
	const wipe = () => Promise.all(models.map((m) => m.deleteMany({})));

	beforeAll(async () => {
		await connectMongo();
		await Promise.all(models.map((m) => m.syncIndexes()));
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps templates by unique code and saves only over the copy read', async () => {
		const templates = new MongoAccountsTemplateRepository();
		await templates.insert(template);
		await templates.insert({
			...template,
			id: 'tpl_ch_common',
			code: 'CH-COMMON',
			appliesTo: { all: true, kinds: [] },
		});
		await expect(templates.insert({ ...template, id: 'tpl_other' })).rejects.toThrow('duplicate_template_code');
		await expect(templates.insert({ ...template, id: 'tpl_bad', code: undefined as never })).rejects.toThrow(
			/code/,
		);
		expect((await templates.list()).map((t) => t.code)).toEqual(['CH-COMMON', 'CH-PROP']);
		const later = '2026-11-24T11:00:00.000Z';
		await templates.save({ ...template, name: 'Capital and drawings', updatedAt: later }, at);
		await expect(templates.save({ ...template, name: 'Lost' }, at)).rejects.toThrow('template_changed');
		const read = await templates.findByCode('CH-PROP');
		expect(read).toMatchObject({ id: 'tpl_ch_prop', name: 'Capital and drawings', updatedAt: later });
		expect(read?.versions[0]?.content).toMatchObject({ kind: 'chart', ledgers: [{ roles: ['drawings'] }] });
		expect(await templates.findByCode('CH-LLP')).toBeNull();
	});

	it('keeps one install per template code', async () => {
		const installs = new MongoTemplateInstallRepository();
		const install = TemplateInstall.parse({ code: 'CH-PROP', version: 1, installedAt: at });
		await installs.save(install);
		await installs.save({ ...install, code: 'CH-COMMON' });
		await installs.save({ ...install, version: 2, installedBy: 'usr_owner' });
		expect(await installs.list()).toEqual([
			{ code: 'CH-COMMON', version: 1, installedAt: at, installedBy: null },
			{ code: 'CH-PROP', version: 2, installedAt: at, installedBy: 'usr_owner' },
		]);
	});
});
