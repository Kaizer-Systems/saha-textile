import { NotFoundException } from '@nestjs/common';
import type { AccountsTemplate } from '@saha-textile/contracts';
import { starterTemplates } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesController } from '../src/accounts-templates/accounts-templates.controller';
import { AccountsTemplatesModule } from '../src/accounts-templates/accounts-templates.module';
import { AccountsTemplatesService } from '../src/accounts-templates/accounts-templates.service';

import { memoryTemplateStores } from './accounts-templates-memory';

/** Accounts templates (owner-approved 2026-11-24, steps T2 and D4): the library, lock state, what the books start from. */

const at = '2026-11-24T10:00:00.000Z';
const companyOf = (kind: string | null) => ({ getProfile: async () => (kind ? { kind } : null) });
const CODES = starterTemplates(at)
	.map((t) => t.code)
	.sort((a, b) => a.localeCompare(b));
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
			content: { kind: 'taxRules', list: 'reverseCharge', entries: [] },
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
			latestVersion: 2,
			installedVersion: null,
			updateAvailable: false,
		});
		expect(rows.find((r) => r.code === 'CH-COMMON')).toMatchObject({
			latestVersion: 4,
			validFrom: '2026-11-25',
			caReview: 'pending',
		});
		expect(rows.every((r) => !('versions' in r))).toBe(true);
		await service.library();
		expect(stores.templates.rows).toHaveLength(CODES.length);
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
			latestVersion: 4,
			installedVersion: 1,
			updateAvailable: true,
		});
		expect(rows.find((r) => r.code === 'CH-PROP')).toMatchObject({ installedVersion: 1, updateAvailable: true });
		expect(stores.templates.rows.find((r) => r.code === 'CH-PVT')?.versions.map((v) => v.version)).toEqual([
			1, 2, 3,
		]);
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
		expect((await twice.library()).length).toBe(CODES.length);
	});

	it('starts the books from the shared chart and the kind’s own, newest versions, and records it once', async () => {
		const { stores, service } = serviceFor(null);
		const { chart, picks } = await service.startingChart();
		expect(picks).toEqual([
			{ code: 'CH-COMMON', version: 4 },
			{ code: 'CH-PROP', version: 2 },
		]);
		expect(chart.ledgers.find((l) => l.key === 'legal_fees')?.roles).toEqual(['legal_fees']);
		await service.recordInstalls(picks);
		await service.recordInstalls([{ code: 'CH-FIRM', version: 1 }]);
		expect(stores.installs.rows.map((i) => [i.code, i.version])).toEqual([
			['CH-COMMON', 4],
			['CH-PROP', 2],
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
						list: 'reverseCharge' as const,
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
								limitINR: null,
								limitPer: null,
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
			versions: [
				{
					...rcm.versions[0]!,
					content: {
						kind: 'report' as const,
						columns: 'thisAndLast' as const,
						notes: false,
						level: null,
						lines: [],
					},
				},
			],
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
		expect(opens).toMatchObject({ locked: 10, booksSetUp: false });
		expect(opens.reports.map((r) => r.code)).toEqual(['RP-SCH3-BS', 'RP-SCH3-PL']);
		expect(opens.charts.map((c) => [c.code, c.version])).toEqual([
			['CH-COMMON', 4],
			['CH-PVT', 3],
		]);
		expect(opens.taxRules).toEqual([
			{ code: 'RS-LIMITS', name: 'Limits', version: 2, entries: 8 },
			{ code: 'RS-RCM', name: 'Reverse-charge list', version: 1, entries: 6 },
			{ code: 'RS-TDS', name: 'TDS sections', version: 1, entries: 9 },
		]);
		stores.installs.rows.push({ code: 'CH-COMMON', version: 1, installedAt: at, installedBy: null });
		await service.installUnlocked('usr_owner');
		expect(stores.installs.rows.map((i) => [i.code, i.version, i.installedBy])).toEqual([
			['CH-COMMON', 1, null],
			['RS-LIMITS', 2, 'usr_owner'],
			['RS-RCM', 1, 'usr_owner'],
			['RS-TDS', 1, 'usr_owner'],
			['CH-PVT', 3, 'usr_owner'],
			['RP-SCH3-BS', 1, 'usr_owner'],
			['RP-SCH3-PL', 1, 'usr_owner'],
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
		expect((await routes.library()).length).toBe(CODES.length);
		expect((await routes.get('CH-PROP')).code).toBe('CH-PROP');
		expect(new AccountsTemplatesModule()).toBeInstanceOf(AccountsTemplatesModule);
	});
});

describe('limits from the limits rule set (accounts brief O4)', () => {
	it('reads a limit in force on a day for the company’s kind, from the version it installed', async () => {
		const { stores, service } = serviceFor('proprietorship');
		expect(await service.limitOn('cash_payment_one_person', '2026-11-24')).toBe(10_000);
		expect(await service.limitOn('cash_receipt_one_person', '2026-11-26')).toBe(200_000);
		expect(await service.limitOn('nothing', '2026-11-24')).toBeNull();
		expect(await service.limitOn('llp_audit_turnover', '2026-11-24')).toBeNull();
		expect(await service.limitOn('cash_payment_one_person', '2001-01-01')).toBeNull();
		vi.spyOn(stores.templates, 'findByCode').mockResolvedValueOnce(null);
		expect(await service.limitOn('cash_payment_one_person', '2026-11-24')).toBeNull();
	});
});
