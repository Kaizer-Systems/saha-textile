import { describe, expect, it } from 'vitest';

import { AccountsTemplatesController } from '../src/accounts-templates/accounts-templates.controller';
import { AccountsTemplatesService } from '../src/accounts-templates/accounts-templates.service';
import { memoryTemplateStores } from './accounts-templates-memory';

import type { AccountsTemplate, ChartTemplateContent, TemplateNew } from '@saha-textile/contracts';

/** The template builder (accounts templates plan AT2, AT3): New template, Save draft, Publish, Import. */

const now = new Date('2026-11-24T08:00:00.000Z');
const company = { getProfile: async () => ({ kind: 'partnership' }) };

async function setup(installs: { code: string; version: number }[] = []) {
	const stores = memoryTemplateStores(
		[],
		installs.map((i) => ({ ...i, installedAt: now.toISOString(), installedBy: null })),
	);
	const service = new AccountsTemplatesService(stores.templates, stores.installs, company as never);
	await service.library();
	return { service, stores, routes: new AccountsTemplatesController(service) };
}
const refusal = (error: unknown) =>
	(error as { response?: { issues?: { code: string; message: string }[] } }).response?.issues?.map((i) => i.message);
const newChart: TemplateNew = {
	code: 'CH-FIRM-DEED',
	kind: 'chart',
	name: 'Partners from the deed',
	description: '',
	appliesTo: { all: false, kinds: ['partnership'] },
	startFrom: null,
	list: 'reverseCharge',
};
const ledger = (key: string, groupKey: string) => ({
	key,
	name: key,
	groupKey,
	handPosting: true,
	roles: [],
	ruleSetCode: null,
	source: '',
});

describe('New template (AT2)', () => {
	it('starts a draft, empty or from another template’s newest version, used by nothing until published', async () => {
		const { service, routes } = await setup();
		const fresh = await routes.create(newChart, { userId: 'adm_owner' } as never);
		expect(fresh).toMatchObject({ versions: [], draft: { validFrom: expect.any(String), savedBy: 'adm_owner' } });
		expect(fresh.draft?.content).toEqual({ kind: 'chart', groups: [], ledgers: [] });
		const copy = await service.create({ ...newChart, code: 'CH-FIRM-COPY', startFrom: 'CH-FIRM' }, null, now);
		expect((copy.draft?.content as ChartTemplateContent).groups.length).toBeGreaterThan(0);
		const rules = await routes.create(
			{ ...newChart, code: 'RS-TDS-OWN', kind: 'taxRules', startFrom: null },
			undefined,
		);
		expect(rules.draft?.content).toEqual({ kind: 'taxRules', list: 'reverseCharge', entries: [] });
		const report = await service.create({ ...newChart, code: 'RP-NCE-BS', kind: 'report' }, null, now);
		expect(report.draft?.content).toEqual({
			kind: 'report',
			columns: 'thisAndLast',
			notes: false,
			level: null,
			lines: [],
		});
		const row = (await service.library()).find((r) => r.code === 'CH-FIRM-DEED');
		expect(row).toMatchObject({ latestVersion: null, validFrom: null, caReview: null, hasDraft: true });
		expect((await service.opens('partnership')).charts.map((c) => c.code)).toEqual(['CH-COMMON', 'CH-FIRM']);
	});

	it('refuses a code taken, and a start from a template of another type', async () => {
		const { service } = await setup();
		expect(
			refusal(await service.create({ ...newChart, code: 'CH-FIRM' }, null, now).catch((e: unknown) => e)),
		).toEqual(['duplicate_template_code']);
		expect(
			refusal(await service.create({ ...newChart, startFrom: 'RS-RCM' }, null, now).catch((e: unknown) => e)),
		).toEqual(['template_start_not_usable']);
		await service.create(newChart, null, now);
		expect(
			refusal(
				await service
					.create({ ...newChart, code: 'CH-FIRM-TWO', startFrom: 'CH-FIRM-DEED' }, null, now)
					.catch((e: unknown) => e),
			),
		).toEqual(['template_start_not_usable']);
	});
});

describe('Save draft, changes and Publish (AT3)', () => {
	it('saves a draft, shows what it changes, and publishes it as the next version', async () => {
		const { service, routes, stores } = await setup();
		const firm = (await service.get('CH-FIRM')) as AccountsTemplate;
		const latest = firm.versions[firm.versions.length - 1]?.content as ChartTemplateContent;
		expect(await routes.changes('CH-FIRM')).toBeNull();
		const draft = {
			content: { ...latest, ledgers: [...latest.ledgers, ledger('partner_b_loan', 'capital_account')] },
			validFrom: '2027-04-01',
			source: 'Deed clause 7',
			notes: '',
			expectedUpdatedAt: firm.updatedAt,
		};
		const saved = await routes.saveDraft('CH-FIRM', draft, { userId: 'adm_owner' } as never);
		expect(saved.draft).toMatchObject({ validFrom: '2027-04-01', savedBy: 'adm_owner' });
		expect(await routes.changes('CH-FIRM')).toEqual({
			added: ['partner_b_loan'],
			removed: [],
			renamed: [],
			changed: [],
		});
		const published = await routes.publish('CH-FIRM', { expectedUpdatedAt: saved.updatedAt }, undefined);
		expect(published.versions.at(-1)).toMatchObject({ version: 3, validFrom: '2027-04-01', caReview: 'pending' });
		expect(stores.templates.rows.find((t) => t.code === 'CH-FIRM')?.draft).toBeNull();
		const stale = { ...draft, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' };
		await expect(service.saveDraft('CH-FIRM', stale, null, now)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ message: 'template_changed' })] },
		});
	});

	it('lists every publishing problem, and shows no changes for a rule set', async () => {
		const { service, routes } = await setup();
		const firm = (await service.get('CH-FIRM')) as AccountsTemplate;
		const saved = await service.saveDraft(
			'CH-FIRM',
			{
				content: { kind: 'chart', groups: [], ledgers: [ledger('stray', 'nowhere')] },
				validFrom: '2017-01-01',
				source: '',
				notes: '',
				expectedUpdatedAt: firm.updatedAt,
			},
			null,
			now,
		);
		expect(
			refusal(
				await service.publish('CH-FIRM', { expectedUpdatedAt: saved.updatedAt }, null).catch((e: unknown) => e),
			),
		).toEqual(['template_dates_overlap', 'template_unknown_group:stray']);
		const rcm = (await service.get('RS-RCM')) as AccountsTemplate;
		await routes.saveDraft(
			'RS-RCM',
			{
				content: { kind: 'taxRules', list: 'reverseCharge', entries: [] },
				validFrom: '2030-01-01',
				source: '',
				notes: '',
				expectedUpdatedAt: rcm.updatedAt,
			},
			undefined,
		);
		// AT5 Compare with vN: emptying the reverse-charge list removes every entry.
		expect((await service.changes('RS-RCM'))?.removed).toContain("Advocate's fees");
		const fresh = await service.create({ ...newChart, code: 'CH-FIRM-NEW' }, null, now);
		expect(await service.changes(fresh.code)).toEqual({ added: [], removed: [], renamed: [], changed: [] });
		const rules = await service.create({ ...newChart, kind: 'taxRules', code: 'RS-NEW', list: 'tds' }, null, now);
		expect(rules.draft?.content).toEqual({ kind: 'taxRules', list: 'tds', entries: [] });
		expect(await service.changes(rules.code)).toEqual({ added: [], removed: [], renamed: [], changed: [] });
		// A report's changes come with its builder (T6).
		const report = await service.create({ ...newChart, kind: 'report', code: 'RP-NEW' }, null, now);
		expect(await service.changes(report.code)).toBeNull();
	});

	it('passes on a save that failed for any other reason', async () => {
		const { service, stores } = await setup();
		const firm = (await service.get('CH-FIRM')) as AccountsTemplate;
		stores.templates.save = async () => {
			throw new Error('db_down');
		};
		stores.templates.insert = async () => {
			throw new Error('db_down');
		};
		await expect(
			service.saveDraft(
				'CH-FIRM',
				{
					content: { kind: 'chart', groups: [], ledgers: [] },
					validFrom: '2030-01-01',
					source: '',
					notes: '',
					expectedUpdatedAt: firm.updatedAt,
				},
				null,
				now,
			),
		).rejects.toThrow('db_down');
		await expect(service.create(newChart, null, now)).rejects.toThrow('db_down');
	});
});

describe('Import (AT2) and installed charts (AT4)', () => {
	it('imports a template under its own code, refusing a code taken here', async () => {
		const { service, routes } = await setup();
		const firm = (await service.get('CH-FIRM')) as AccountsTemplate;
		const imported = await routes.importTemplate({ ...firm, code: 'CH-FIRM-KOL', id: 'tpl_elsewhere' });
		expect(imported).toMatchObject({ id: 'tpl_ch_firm_kol', code: 'CH-FIRM-KOL' });
		expect(refusal(await service.importTemplate(firm, now).catch((e: unknown) => e))).toEqual([
			'duplicate_template_code',
		]);
	});

	it('names each installed chart template with the keys it holds', async () => {
		const { service } = await setup([
			{ code: 'CH-COMMON', version: 1 },
			{ code: 'RS-RCM', version: 1 },
			{ code: 'CH-GONE', version: 1 },
			{ code: 'CH-FIRM', version: 9 },
		]);
		const charts = await service.installedCharts();
		expect(charts.map((c) => c.label)).toEqual(['CH-COMMON v1']);
		expect(charts[0]?.keys.has('cash')).toBe(true);
	});

	it('records a newer version installed (AT7), offering no update after', async () => {
		const { service, stores } = await setup([{ code: 'CH-COMMON', version: 1 }]);
		expect((await service.library()).find((r) => r.code === 'CH-COMMON')?.updateAvailable).toBe(true);
		await service.markInstalled('CH-COMMON', 3, 'adm_owner', now);
		expect(stores.installs.rows.find((r) => r.code === 'CH-COMMON')).toEqual({
			code: 'CH-COMMON',
			version: 3,
			installedAt: now.toISOString(),
			installedBy: 'adm_owner',
		});
		expect((await service.library()).find((r) => r.code === 'CH-COMMON')?.updateAvailable).toBe(false);
		await service.markInstalled('RS-RCM', 1, null);
		expect(stores.installs.rows.find((r) => r.code === 'RS-RCM')?.installedBy).toBeNull();
	});
});
