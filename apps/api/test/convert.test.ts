import { describe, expect, it, vi } from 'vitest';

import { ConvertController, ConvertService } from '../src/ledger/convert';

/** Convert to another kind of business (Postings and Convert brief AC1, AC2; AC-D1, AC-D2). */

type Row = Record<string, unknown>;
const at = '2026-11-01T00:00:00.000Z';

const group = (id: string, systemKey: string | null, parentId: string | null, nature = 'equity') => ({
	id,
	systemKey,
	roles: [],
	name: id,
	parentId,
	nature,
	tradingAccount: false,
	order: 0,
	createdAt: at,
	updatedAt: at,
});
const ledger = (id: string, systemKey: string | null, groupId: string, nature = 'equity', active = true) => ({
	id,
	systemKey,
	roles: [],
	name: id,
	groupId,
	nature,
	handPosting: true,
	active,
	createdAt: at,
	updatedAt: at,
	updatedBy: null,
});
const chartOf = (o: { noOwners?: boolean } = {}) => ({
	groups: [
		...(o.noOwners ? [] : [group('grp_capital_account', 'capital_account', null)]),
		group('grp_incomes', 'direct_incomes', null, 'income'),
		group('grp_current_assets', 'current_assets', null, 'asset'),
	],
	ledgers: [
		ledger('led_capital', 'capital', 'grp_capital_account'),
		ledger('led_drawings', 'drawings', 'grp_capital_account'),
		ledger('led_old', null, 'grp_capital_account', 'equity', false),
		ledger('led_sales', 'sales', 'grp_incomes', 'income'),
		ledger('led_bank', 'bank', 'grp_current_assets', 'asset'),
	],
});
/** CH-FIRM: partners' capital under the owners' group, and a group whose parent the books lack. */
const firm = {
	versions: [
		{
			version: 1,
			content: {
				kind: 'chart',
				groups: [
					{
						key: 'capital_account',
						name: "Partners' capital",
						parentKey: null,
						nature: 'equity',
						tradingAccount: false,
						roles: [],
					},
					{
						key: 'partners_current',
						name: "Partners' current accounts",
						parentKey: 'capital_account',
						nature: 'equity',
						tradingAccount: false,
						roles: [],
					},
					{
						key: 'appropriation',
						name: 'Appropriation',
						parentKey: 'not_in_books',
						nature: 'equity',
						tradingAccount: false,
						roles: [],
					},
				],
				ledgers: [
					{ key: 'capital', name: 'Capital', groupKey: 'capital_account', handPosting: true, roles: [] },
					{
						key: 'partner_current',
						name: 'Partner A: current',
						groupKey: 'partners_current',
						handPosting: true,
						roles: [],
					},
					{
						key: 'interest_on_capital',
						name: 'Interest on capital',
						groupKey: 'appropriation',
						handPosting: true,
						roles: [],
					},
				],
			},
		},
	],
};

interface Options {
	superAdmin?: boolean;
	profile?: Row | null;
	setUp?: boolean;
	chart?: unknown;
	balances?: (day: string, locations: string[]) => Record<string, number>;
	locks?: Row[];
}

function setup(o: Options = {}) {
	const saves = {
		groups: [] as Row[],
		ledgers: [] as Row[],
		locks: [] as Row[],
		profiles: [] as Row[],
		audit: [] as Row[],
	};
	const posted: Row[] = [];
	const chart = o.chart ?? chartOf();
	const templates = {
		booksSetUp: vi.fn(async () => o.setUp ?? true),
		get: vi.fn(async () => firm),
		installUnlocked: vi.fn(async () => undefined),
	};
	const service = new ConvertService(
		{
			isSuperAdmin: async () => o.superAdmin ?? true,
			chart: async () => chart,
			post: async (request: Row) => (posted.push(request), { id: 'jv_open' }),
		} as never,
		templates as never,
		{
			balancesAt: async (day: string, locations: string[]) =>
				o.balances
					? o.balances(day, locations)
					: locations.length
						? { led_capital: -1_000, led_drawings: 300, led_sales: -500 }
						: { led_capital: -1_000, led_drawings: 300, led_sales: -500, led_bank: 1_200 },
			saveGroup: async (g: Row) => void saves.groups.push(g),
			saveLedger: async (l: Row) => void saves.ledgers.push(l),
		} as never,
		{
			getProfile: async () =>
				o.profile === undefined
					? { kind: 'proprietorship', legalName: 'K.R. Marketing', updatedAt: at }
					: o.profile,
			saveProfile: async (p: Row, expected: string | null) => void saves.profiles.push({ ...p, expected }),
		} as never,
		{
			list: async () => o.locks ?? [{ month: '2026-09', part: 'sales', state: 'locked' }],
			save: async (locks: Row[]) => void saves.locks.push(...locks),
		} as never,
		{
			list: async () => [
				{ id: 'loc_wh', active: true },
				{ id: 'loc_gone', active: false },
			],
		} as never,
		{ append: async (entry: Row) => void saves.audit.push(entry) } as never,
		{ withTransaction: <T>(work: (context: object) => Promise<T>) => work({ session: 's' }) } as never,
	);
	return { service, saves, posted, templates };
}

const owner = { userId: 'adm_owner' } as never;
const query = { kind: 'partnership', lastDay: '2026-10-31' } as const;

describe('who may convert', () => {
	it('is the super admin, once the books are set up', async () => {
		await expect(setup({ superAdmin: false }).service.preview(query, owner)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ message: 'convert_super_admin_only' })] },
		});
		for (const o of [{ profile: null }, { setUp: false }])
			await expect(setup(o).service.preview(query, owner)).rejects.toMatchObject({
				response: { issues: [expect.objectContaining({ message: 'convert_books_not_set_up' })] },
			});
	});
});

describe('the preview', () => {
	it('lists the owners’ accounts and the profit so far, what they can go to, the months locked', async () => {
		const preview = await setup().service.preview(query, owner);
		expect(preview).toMatchObject({
			from: 'proprietorship',
			to: 'partnership',
			openingDate: '2026-11-01',
			problems: [],
		});
		expect(preview.rows).toEqual([
			{ from: 'led_capital', name: 'led_capital', balancePaise: -1_000 },
			{ from: 'led_drawings', name: 'led_drawings', balancePaise: 300 },
			{ from: 'profit', name: 'Profit up to the last day', balancePaise: -500 },
		]);
		expect(preview.targets).toEqual([
			{ ledgerId: 'led_capital', key: null, name: 'led_capital' },
			{ ledgerId: 'led_drawings', key: null, name: 'led_drawings' },
			{ ledgerId: null, key: 'partner_current', name: 'Partner A: current' },
		]);
		expect(preview.months[0]).toBe('2025-04');
		expect(preview.months.at(-1)).toBe('2026-10');
		const early = await setup().service.preview({ kind: 'llp', lastDay: '2026-02-28' }, owner);
		expect(early.months[0]).toBe('2024-04');
		const same = await setup().service.preview({ kind: 'proprietorship', lastDay: '2026-10-30' }, owner);
		expect(same.problems).toEqual(['convert_same_kind', 'convert_last_day_not_month_end']);
	});
});

describe('converting', () => {
	const mapping = [
		{ from: 'led_capital', to: { key: 'partner_current' } },
		{ from: 'led_drawings', to: { ledgerId: 'led_capital' } },
		{ from: 'profit', to: { newName: 'Partner B: current' } },
	];

	it('refuses a target the preview didn’t offer, and anything that stops the conversion', async () => {
		for (const to of [{ ledgerId: 'led_bank' }, { key: 'interest_on_capital' }])
			await expect(
				setup().service.convert({ ...query, mapping: [{ from: 'led_capital', to }] } as never, owner),
			).rejects.toMatchObject({
				response: { issues: [expect.objectContaining({ message: 'convert_target_unknown:led_capital' })] },
			});
		await expect(setup().service.convert({ ...query, mapping: [] } as never, owner)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ message: 'convert_row_not_mapped:led_capital' })] },
		});
	});

	it('adds the new kind’s chart, posts one opening voucher, locks the old months and changes the kind', async () => {
		const { service, saves, posted, templates } = setup();
		expect(await service.convert({ ...query, mapping } as never, owner)).toEqual({
			voucherId: 'jv_open',
			months: 19,
		});
		expect(saves.groups.map((g) => [g['id'], g['parentId']])).toEqual([
			['grp_partners_current', 'grp_capital_account'],
			['grp_appropriation', 'grp_not_in_books'],
		]);
		expect(saves.ledgers.map((l) => [l['id'], l['groupId']])).toEqual([
			['led_partner_current', 'grp_partners_current'],
			['led_interest_on_capital', 'grp_appropriation'],
			[expect.stringMatching(/^led_/), 'grp_capital_account'],
		]);
		const made = String(saves.ledgers.at(-1)?.['id']);
		expect(posted[0]).toMatchObject({
			kind: 'opening',
			date: '2026-11-01',
			idempotencyKey: 'convert:2026-10-31',
			lines: [
				{ ledger: { id: 'led_capital' }, locationId: 'loc_wh', debitPaise: 1_000, creditPaise: 0 },
				{ ledger: { id: 'led_partner_current' }, locationId: 'loc_wh', debitPaise: 0, creditPaise: 1_000 },
				{ ledger: { id: 'led_drawings' }, creditPaise: 300 },
				{ ledger: { id: 'led_capital' }, debitPaise: 300 },
				{ ledger: { id: 'led_sales' }, debitPaise: 500 },
				{ ledger: { id: made }, creditPaise: 500 },
			],
		});
		expect(saves.locks).toHaveLength(19 * 7 - 1);
		expect(saves.locks[0]).toMatchObject({ month: '2025-04', state: 'locked', reason: 'Converted to partnership' });
		expect(saves.profiles[0]).toMatchObject({ kind: 'partnership', expected: at });
		expect(templates.installUnlocked).toHaveBeenCalledWith('adm_owner');
		expect(saves.audit[0]).toMatchObject({
			action: 'company.convert',
			diffs: [{ field: 'kind', before: 'proprietorship', after: 'partnership' }],
			metadata: { voucherId: 'jv_open' },
		});
	});

	it('posts no voucher when nothing has a balance at any location, and names no one without a session', async () => {
		const { service, posted, saves } = setup({
			balances: (_day, locations): Record<string, number> => (locations.length ? {} : { led_capital: -1_000 }),
			locks: [],
		});
		expect(
			await service.convert(
				{ ...query, mapping: [{ from: 'led_capital', to: { key: 'partner_current' } }] } as never,
				undefined,
			),
		).toEqual({ voucherId: null, months: 19 });
		expect(posted).toEqual([]);
		expect(saves.audit[0]).toMatchObject({ actorUserId: null, metadata: { voucherId: null } });
	});

	it('can’t make a new owners’ ledger in books with no owners’ group', async () => {
		const { service } = setup({ chart: chartOf({ noOwners: true }), balances: () => ({ led_sales: -500 }) });
		await expect(
			service.convert({ ...query, mapping: [{ from: 'profit', to: { newName: 'Partner A' } }] } as never, owner),
		).rejects.toThrow();
	});
});

describe('the routes', () => {
	it('preview with a GET and convert with a POST', async () => {
		const { service } = setup();
		const routes = new ConvertController(service);
		expect((await routes.preview(query, owner)).to).toBe('partnership');
		await expect(routes.run({ ...query, mapping: [] } as never, owner)).rejects.toThrow();
	});
});
