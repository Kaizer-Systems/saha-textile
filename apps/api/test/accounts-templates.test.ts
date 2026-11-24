import { NotFoundException } from '@nestjs/common';
import type { AccountsTemplate } from '@saha-textile/contracts';
import { starterTemplates } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { AccountsTemplatesController } from '../src/accounts-templates/accounts-templates.controller';
import { AccountsTemplatesModule } from '../src/accounts-templates/accounts-templates.module';
import { AccountsTemplatesService } from '../src/accounts-templates/accounts-templates.service';

import { memoryTemplateStores } from './accounts-templates-memory';

/** Accounts templates (owner-approved 2026-11-24, steps T2 and D4): the library, lock state, what the books start from. */

const at = '2026-11-24T10:00:00.000Z';
const companyOf = (kind: string | null) => ({ getProfile: async () => (kind ? { kind } : null) });
const CODES = ['CH-COMMON', 'CH-FIRM', 'CH-LLP', 'CH-OPC', 'CH-PROP', 'CH-PVT', 'RS-RCM'];
const rcm: AccountsTemplate = {
	id: 'tpl_rs_rcm',
	code: 'RS-RCM',
	kind: 'taxRules',
	name: 'Reverse-charge list',
	description: '',
	appliesTo: { all: true, kinds: [] },
	draft: null,
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
			publishedBy: 'usr_ca',
		},
	],
	createdAt: at,
	updatedAt: at,
};
const serviceFor = (kind: string | null, rows: AccountsTemplate[] = [], installs = [] as never[]) => {
	const stores = memoryTemplateStores(rows, installs);
	return {
		stores,
		service: new AccountsTemplatesService(stores.templates, stores.installs, companyOf(kind) as never),
	};
};

describe('accounts templates library (T2)', () => {
	it('starts the library from the starter templates once, and lists another kind’s as locked with the reason', async () => {
		const { stores, service } = serviceFor('partnership');
		const rows = await service.library();
		expect(rows.map((r) => r.code)).toEqual(CODES);
		expect(rows.find((r) => r.code === 'CH-FIRM')).toMatchObject({ locked: false, lockReason: null });
		expect(rows.find((r) => r.code === 'CH-PROP')).toMatchObject({
			locked: true,
			lockReason: 'not_this_kind',
			latestVersion: 1,
			installedVersion: null,
			updateAvailable: false,
		});
		expect(rows.find((r) => r.code === 'CH-COMMON')).toMatchObject({
			latestVersion: 2,
			validFrom: '2026-04-01',
			caReview: 'pending',
		});
		expect(rows.every((r) => !('versions' in r))).toBe(true);
		await service.library();
		expect(stores.templates.rows).toHaveLength(7);
		expect((await service.get('CH-FIRM')).versions[0]?.content.kind).toBe('chart');
		await expect(service.get('CH-NONE')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('adds a newer starter version to a library seeded before it, as an update to install (AT7)', async () => {
		const v1 = starterTemplates(at).map((t) => ({ ...t, versions: [t.versions[0]!] }));
		const { stores, service } = serviceFor(null, v1, [
			{ code: 'CH-COMMON', version: 1, installedAt: at, installedBy: null },
			{ code: 'CH-PROP', version: 1, installedAt: at, installedBy: null },
		] as never[]);
		const rows = await service.library();
		expect(rows.find((r) => r.code === 'CH-COMMON')).toMatchObject({
			latestVersion: 2,
			installedVersion: 1,
			updateAvailable: true,
		});
		expect(rows.find((r) => r.code === 'CH-PROP')).toMatchObject({ installedVersion: 1, updateAvailable: false });
		expect(stores.templates.rows.find((r) => r.code === 'CH-PVT')?.versions.map((v) => v.version)).toEqual([1, 2]);
	});

	it('keeps another instance’s writes, and tries again after a failed start', async () => {
		const stores = memoryTemplateStores(starterTemplates(at).map((t) => ({ ...t, versions: [t.versions[0]!] })));
		let fail = true;
		const racing = {
			...stores.templates,
			insert: stores.templates.insert,
			save: async (template: AccountsTemplate, expected: string) => {
				if (fail) {
					fail = false;
					throw new Error('connection lost');
				}
				// Another instance saved the same update first.
				if (template.code === 'CH-COMMON') throw new Error('template_changed');
				await stores.templates.save(template, expected);
			},
		};
		const service = new AccountsTemplatesService(racing, stores.installs, companyOf('llp') as never);
		await expect(service.library()).rejects.toThrow('connection lost');
		expect((await service.library()).map((r) => r.code)).toEqual(CODES);
		const duplicate = memoryTemplateStores();
		const twice = new AccountsTemplatesService(
			{
				...duplicate.templates,
				insert: async (template: AccountsTemplate) => {
					await duplicate.templates.insert(template);
					if (template.code === 'RS-RCM') throw new Error('duplicate_template_code');
				},
			},
			duplicate.installs,
			companyOf(null) as never,
		);
		expect((await twice.library()).length).toBe(7);
	});

	it('starts the books from the shared chart and the kind’s own, newest versions, and records it once', async () => {
		const { stores, service } = serviceFor(null);
		const { chart, picks } = await service.startingChart();
		expect(picks).toEqual([
			{ code: 'CH-COMMON', version: 2 },
			{ code: 'CH-PROP', version: 1 },
		]);
		expect(chart.ledgers.find((l) => l.key === 'legal_fees')?.roles).toEqual(['legal_fees']);
		await service.recordInstalls(picks);
		await service.recordInstalls([{ code: 'CH-FIRM', version: 1 }]);
		expect(stores.installs.rows.map((i) => [i.code, i.version])).toEqual([
			['CH-COMMON', 2],
			['CH-PROP', 1],
		]);
		expect(await service.kind()).toBe('proprietorship');
	});

	it('offers the reverse-charge list for the kind and the day received, from the installed version (D4)', async () => {
		const pvt = serviceFor('private_limited');
		const choices = await pvt.service.rcmChoices('2026-11-01');
		expect(choices.map((c) => c.key)).toEqual([
			'shop_rent',
			'goods_transport',
			'advocate_fees',
			'security_services',
			'sponsorship',
			'director_services',
		]);
		expect(choices[0]).toMatchObject({
			templateCode: 'RS-RCM',
			templateVersion: 1,
			code: '997212',
			expenseRole: 'rent',
		});
		expect(pvt.stores.installs.rows.map((i) => [i.code, i.version])).toEqual([['RS-RCM', 1]]);
		const prop = serviceFor('proprietorship');
		expect((await prop.service.rcmChoices('2024-10-01')).map((c) => c.key)).toEqual([
			'goods_transport',
			'advocate_fees',
			'security_services',
		]);
		// A newer version waits until it is installed; a day before the list existed has none.
		const newer = {
			...rcm,
			versions: [
				rcm.versions[0]!,
				{
					...rcm.versions[0]!,
					version: 2,
					content: {
						kind: 'taxRules' as const,
						entries: [
							{
								key: 'shop_rent',
								name: 'Rent',
								code: '997212',
								ratePercent: 18,
								expenseRole: null,
								kinds: null,
								from: '2024-10-10',
								to: null,
								source: '',
								caReview: 'pending' as const,
							},
						],
					},
				},
			],
		};
		const installedV1 = serviceFor(null, [newer], [
			{ code: 'RS-RCM', version: 1, installedAt: at, installedBy: null },
		] as never[]);
		expect(await installedV1.service.rcmChoices('2026-11-01')).toEqual([]);
		expect(await installedV1.service.rcmChoices('2024-01-01')).toEqual([]);
		const installedV2 = serviceFor(null, [newer], [
			{ code: 'RS-RCM', version: 2, installedAt: at, installedBy: null },
		] as never[]);
		expect(await installedV2.service.rcmChoices('2026-11-01')).toEqual([]);
		const notRules = {
			...rcm,
			versions: [{ ...rcm.versions[0]!, content: { kind: 'report' as const, lines: [] } }],
		};
		expect(await serviceFor(null, [notRules]).service.rcmChoices('2026-11-01')).toEqual([]);
		const stores = memoryTemplateStores();
		const empty = new AccountsTemplatesService(
			{ ...stores.templates, findByCode: async () => null },
			stores.installs,
			companyOf(null) as never,
		);
		expect(await empty.rcmChoices('2026-11-01')).toEqual([]);
	});

	it('says what a kind opens, and records every unlocked template once the books are set up (T3, AT1)', async () => {
		const { stores, service } = serviceFor('private_limited');
		expect(await service.booksSetUp()).toBe(false);
		const opens = await service.opens('private_limited', new Date('2026-11-24T06:00:00Z'));
		expect(opens).toMatchObject({ locked: 4, booksSetUp: false, reports: [] });
		expect(opens.charts.map((c) => [c.code, c.version])).toEqual([
			['CH-COMMON', 2],
			['CH-PVT', 2],
		]);
		expect(opens.taxRules).toEqual([{ code: 'RS-RCM', name: 'Reverse-charge list', version: 1, entries: 6 }]);
		stores.installs.rows.push({ code: 'CH-COMMON', version: 1, installedAt: at, installedBy: null });
		await service.installUnlocked('usr_owner');
		expect(stores.installs.rows.map((i) => [i.code, i.version, i.installedBy])).toEqual([
			['CH-COMMON', 1, null],
			['RS-RCM', 1, 'usr_owner'],
			['CH-PVT', 2, 'usr_owner'],
		]);
		expect(await service.booksSetUp()).toBe(true);
		expect((await service.opens('llp')).booksSetUp).toBe(true);
	});

	it('serves the library and one template to accounts.index holders', async () => {
		const { service } = serviceFor(null);
		const routes = new AccountsTemplatesController(service);
		expect((await routes.opens({ kind: 'proprietorship' })).charts.map((c) => c.code)).toEqual([
			'CH-COMMON',
			'CH-PROP',
		]);
		expect((await routes.library()).length).toBe(7);
		expect((await routes.get('CH-PROP')).code).toBe('CH-PROP');
		expect(new AccountsTemplatesModule()).toBeInstanceOf(AccountsTemplatesModule);
	});
});
