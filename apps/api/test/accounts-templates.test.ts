import { NotFoundException } from '@nestjs/common';
import type { AccountsTemplate } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { AccountsTemplatesController } from '../src/accounts-templates/accounts-templates.controller';
import { AccountsTemplatesModule } from '../src/accounts-templates/accounts-templates.module';
import { AccountsTemplatesService } from '../src/accounts-templates/accounts-templates.service';

import { memoryTemplateStores } from './accounts-templates-memory';

/** Accounts templates (owner-approved 2026-11-24, step T2): the library, lock state, and what the books start from. */

const at = '2026-11-24T10:00:00.000Z';
const companyOf = (kind: string | null) => ({ getProfile: async () => (kind ? { kind } : null) });
const rcm: AccountsTemplate = {
	id: 'tpl_rs_rcm',
	code: 'RS-RCM',
	kind: 'taxRules',
	name: 'Reverse-charge list',
	description: '',
	appliesTo: { all: true, kinds: [] },
	versions: [
		{
			version: 1,
			validFrom: '2024-10-10',
			validTo: null,
			source: '13/2017-Central Tax (Rate)',
			caReview: 'pending',
			notes: '',
			content: { kind: 'taxRules', entries: [] },
			publishedAt: at,
			publishedBy: null,
		},
	],
	createdAt: at,
	updatedAt: at,
};

describe('accounts templates library (T2)', () => {
	it('starts the library from the starter templates once, and lists another kind’s as locked with the reason', async () => {
		const stores = memoryTemplateStores();
		const service = new AccountsTemplatesService(
			stores.templates,
			stores.installs,
			companyOf('partnership') as never,
		);
		const rows = await service.library();
		expect(rows.map((r) => r.code)).toEqual(['CH-COMMON', 'CH-FIRM', 'CH-LLP', 'CH-OPC', 'CH-PROP', 'CH-PVT']);
		expect(rows.find((r) => r.code === 'CH-FIRM')).toMatchObject({ locked: false, lockReason: null });
		expect(rows.find((r) => r.code === 'CH-PROP')).toMatchObject({
			locked: true,
			lockReason: 'not_this_kind',
			latestVersion: 1,
			installedVersion: null,
			updateAvailable: false,
		});
		expect(rows.every((r) => !('versions' in r))).toBe(true);
		await service.library();
		expect(stores.templates.rows).toHaveLength(6);
		expect((await service.get('CH-FIRM')).versions[0]?.content.kind).toBe('chart');
		await expect(service.get('CH-NONE')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('says which version is installed and when a newer one is waiting (AT7)', async () => {
		const newer = { ...rcm, versions: [...rcm.versions, { ...rcm.versions[0]!, version: 2 }] };
		const stores = memoryTemplateStores(
			[newer],
			[
				{ code: 'RS-RCM', version: 1, installedAt: at, installedBy: null },
				{ code: 'RS-TDS', version: 1, installedAt: at, installedBy: null },
			],
		);
		const service = new AccountsTemplatesService(stores.templates, stores.installs, companyOf(null) as never);
		expect(await service.library()).toEqual([
			expect.objectContaining({ code: 'RS-RCM', latestVersion: 2, installedVersion: 1, updateAvailable: true }),
		]);
		stores.installs.rows[0]!.version = 2;
		expect((await service.library())[0]).toMatchObject({ installedVersion: 2, updateAvailable: false });
	});

	it('keeps another instance’s starter templates, and tries again after a failed start', async () => {
		const stores = memoryTemplateStores();
		let fail = true;
		const racing = {
			...stores.templates,
			insert: async (template: AccountsTemplate) => {
				if (fail) {
					fail = false;
					throw new Error('connection lost');
				}
				await stores.templates.insert(template);
				if (template.code === 'CH-COMMON') throw new Error('duplicate_template_code');
			},
		};
		const service = new AccountsTemplatesService(racing, stores.installs, companyOf('llp') as never);
		await expect(service.library()).rejects.toThrow('connection lost');
		expect((await service.library()).map((r) => r.code)).toContain('CH-LLP');
	});

	it('starts the books from the shared chart and the kind’s own, and records it once', async () => {
		const stores = memoryTemplateStores();
		const service = new AccountsTemplatesService(stores.templates, stores.installs, companyOf(null) as never);
		await service.library();
		stores.templates.rows.push(rcm);
		const { chart, picks } = await service.startingChart();
		expect(picks).toEqual([
			{ code: 'CH-COMMON', version: 1 },
			{ code: 'CH-PROP', version: 1 },
		]);
		expect(chart.ledgers.find((l) => l.key === 'customer_advances')?.roles).toEqual(['customer_advances']);
		await service.recordInstalls(picks);
		await service.recordInstalls([{ code: 'CH-FIRM', version: 1 }]);
		expect(stores.installs.rows.map((i) => [i.code, i.installedBy])).toEqual([
			['CH-COMMON', null],
			['CH-PROP', null],
		]);
	});

	it('serves the library and one template to accounts.index holders', async () => {
		const stores = memoryTemplateStores();
		const service = new AccountsTemplatesService(stores.templates, stores.installs, companyOf(null) as never);
		const routes = new AccountsTemplatesController(service);
		expect((await routes.library()).length).toBe(6);
		expect((await routes.get('CH-PROP')).code).toBe('CH-PROP');
		expect(new AccountsTemplatesModule()).toBeInstanceOf(AccountsTemplatesModule);
	});
});
