import type { AccountsTemplate, ChartTemplateContent, TaxRuleSetContent } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { TemplateUpdatesController, TemplateUpdatesService } from '../src/ledger/template-updates';

/** Template updates (accounts templates plan AT7): Update available, what is kept, Install. */

const group = (key: string, parentKey: string | null = null, name = key) => ({
	key,
	name,
	parentKey,
	nature: 'expense' as const,
	tradingAccount: false,
	roles: [],
});
const tledger = (key: string, groupKey: string, name = key) => ({
	key,
	name,
	groupKey,
	handPosting: true,
	roles: [],
	ruleSetCode: null,
	source: '',
});
const v = (version: number, content: unknown, validFrom = `2026-0${version}-01`) =>
	({ version, validFrom, content }) as AccountsTemplate['versions'][number];
const v1: ChartTemplateContent = {
	kind: 'chart',
	groups: [group('indirect_expenses', null, 'Indirect expenses')],
	ledgers: [tledger('rent', 'indirect_expenses', 'Rent')],
};
const v2: ChartTemplateContent = {
	kind: 'chart',
	groups: [
		...v1.groups,
		group('legal_and_professional', 'professional_heads'),
		group('professional_heads', 'indirect_expenses'),
		group('direct_expenses'),
	],
	ledgers: [
		...v1.ledgers,
		tledger('legal_fees', 'legal_and_professional', 'Legal and professional fees'),
		tledger('freight_inward', 'direct_expenses', 'Freight inward'),
	],
};
const common = {
	code: 'CH-COMMON',
	name: 'Shared chart',
	kind: 'chart',
	versions: [v(1, v1), v(2, v2)],
} as AccountsTemplate;
const rcm = {
	code: 'RS-RCM',
	name: 'Reverse-charge list',
	kind: 'taxRules',
	versions: [
		v(1, { kind: 'taxRules', entries: [] }),
		v(2, {
			kind: 'taxRules',
			entries: [{ key: 'shop_rent', name: 'Shop rent', expenseRole: 'rent' }],
		} as unknown as TaxRuleSetContent),
	],
} as AccountsTemplate;
const books = {
	groups: [
		{
			id: 'grp_indirect_expenses',
			systemKey: 'indirect_expenses',
			name: 'Overheads',
			parentId: null,
			nature: 'expense',
			roles: [],
		},
	],
	ledgers: [
		{
			id: 'led_rent',
			systemKey: 'rent',
			name: 'Rent',
			groupId: 'grp_indirect_expenses',
			nature: 'expense',
			roles: ['none'],
		},
		{
			id: 'led_own',
			systemKey: null,
			name: 'Shop rent (Barasat)',
			groupId: 'grp_indirect_expenses',
			nature: 'expense',
			roles: ['rent'],
		},
	],
};

function setup(template: AccountsTemplate, row: { updateAvailable: boolean; installedVersion: number | null }) {
	const saved = { groups: [] as unknown[], ledgers: [] as unknown[] };
	const templates = {
		get: async () => template,
		library: async () => [{ code: template.code, ...row }],
		startingChart: async () => ({ chart: v2, picks: [] }),
		markInstalled: vi.fn(async () => undefined),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new TemplateUpdatesService(
		{ chart: async () => books } as never,
		templates as never,
		{
			saveGroup: async (g: unknown) => void saved.groups.push(g),
			saveLedger: async (l: unknown) => void saved.ledgers.push(l),
		} as never,
		audit as never,
	);
	return { service, templates, audit, saved };
}

describe('Update available (AT7)', () => {
	it('says what a newer chart changes and which of the company’s own changes are kept', async () => {
		const { service } = setup(common, { updateAvailable: true, installedVersion: 1 });
		const update = await service.update('CH-COMMON');
		expect(update).toMatchObject({ code: 'CH-COMMON', installedVersion: 1, version: 2, validFrom: '2026-02-01' });
		expect(update.changes.added).toEqual([
			'legal_and_professional',
			'professional_heads',
			'direct_expenses',
			'Legal and professional fees',
			'Freight inward',
		]);
		expect(update.kept).toEqual([
			{ kind: 'name', label: 'Indirect expenses', ours: 'Overheads', theirs: 'Indirect expenses' },
			{ kind: 'role', label: 'Rent', ours: 'Shop rent (Barasat)', theirs: 'Rent' },
		]);
	});

	it('names a rule set entry whose expense goes to the company’s own ledger, even with the installed version gone', async () => {
		const { service } = setup(
			{ ...rcm, versions: [rcm.versions[1]!, v(3, rcm.versions[1]!.content)] },
			{
				updateAvailable: true,
				installedVersion: 1,
			},
		);
		const update = await service.update('RS-RCM');
		expect(update.changes.added).toEqual(['Shop rent']);
		expect(update.kept).toEqual([
			{ kind: 'role', label: 'Shop rent', ours: 'Shop rent (Barasat)', theirs: 'Rent' },
		]);
	});

	it('refuses when nothing newer waits', async () => {
		await expect(
			setup(common, { updateAvailable: false, installedVersion: 2 }).service.update('CH-COMMON'),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'template_no_update' }] },
		});
	});
});

describe('Install (AT7)', () => {
	it('adds only what the books lack, records the version and logs it', async () => {
		const { service, templates, audit, saved } = setup(common, { updateAvailable: true, installedVersion: 1 });
		const now = new Date('2026-11-24T06:30:00.000Z');
		const library = await service.install('CH-COMMON', { version: 2 }, { userId: 'adm_owner' } as never, now);
		expect(library).toEqual([{ code: 'CH-COMMON', updateAvailable: true, installedVersion: 1 }]);
		expect(
			saved.groups.map((g) => [(g as { id: string }).id, (g as { parentId: string | null }).parentId]),
		).toEqual([
			['grp_legal_and_professional', 'grp_professional_heads'],
			['grp_professional_heads', 'grp_indirect_expenses'],
			['grp_direct_expenses', null],
		]);
		expect(saved.ledgers).toMatchObject([
			{ id: 'led_legal_fees', groupId: 'grp_legal_and_professional', nature: 'expense' },
			{ id: 'led_freight_inward', groupId: 'grp_direct_expenses' },
		]);
		expect(templates.markInstalled).toHaveBeenCalledWith('CH-COMMON', 2, 'adm_owner', now);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'accounts.template.install',
				actorUserId: 'adm_owner',
				diffs: [{ field: 'version', before: '1', after: '2' }],
			}),
		);
	});

	it('records a rule set without touching the books, and refuses a version other than the one shown', async () => {
		const { service, templates, saved } = setup(rcm, { updateAvailable: true, installedVersion: 1 });
		await expect(service.install('RS-RCM', { version: 3 }, undefined)).rejects.toMatchObject({
			response: { issues: [{ code: 'template_update_changed' }] },
		});
		await service.install('RS-RCM', { version: 2 }, undefined);
		expect(saved.groups).toEqual([]);
		expect(templates.markInstalled).toHaveBeenCalledWith('RS-RCM', 2, null, expect.any(Date));
	});

	it('answers on its routes', async () => {
		const updates = { update: vi.fn(async () => ({})), install: vi.fn(async () => []) };
		const controller = new TemplateUpdatesController(updates as never);
		await controller.update('RS-RCM');
		await controller.install('RS-RCM', { version: 2 }, undefined);
		expect(updates.update).toHaveBeenCalledWith('RS-RCM');
		expect(updates.install).toHaveBeenCalledWith('RS-RCM', { version: 2 }, undefined);
	});
});
