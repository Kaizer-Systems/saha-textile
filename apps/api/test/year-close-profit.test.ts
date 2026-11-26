import type { YearCloseRecord } from '@saha-textile/core-domain';
import { shareProfit } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { YearCloseService } from '../src/ledger/year-close';

/**
 * Where the year's profit goes at year close (brief 25 YC1–YC3): the choice each kind of business is offered, what it
 * posts on today's books (a firm's sharing read from each partner's capital through the year), the closing entries
 * out of date when the choice or its sharing changed, and the profit voucher posted before the closing entries.
 */

const YEAR = '2026-27';
const at = '2027-04-20T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const ca = { userId: 'adm_ca', permissions: ['accounts.post'] } as never;

const GROUPS = [
	{ id: 'g_inc', parentId: null, nature: 'income', systemKey: 'sales_accounts', name: 'Sales' },
	{ id: 'g_exp', parentId: null, nature: 'expense', systemKey: 'indirect_expenses', name: 'Expenses' },
	{ id: 'g_res', parentId: null, nature: 'equity', systemKey: 'reserves_and_surplus', name: 'Reserves' },
	{ id: 'g_cap', parentId: null, nature: 'liability', systemKey: 'capital_account', name: 'Capital account' },
	{ id: 'g_cur', parentId: null, nature: 'liability', systemKey: 'partners_current', name: 'Partners’ current' },
	{ id: 'g_app', parentId: null, nature: 'expense', systemKey: 'appropriation', name: 'Appropriation' },
	{ id: 'g_tax', parentId: null, nature: 'liability', systemKey: 'duties_and_taxes', name: 'Duties and taxes' },
];
interface TestLedger {
	id: string;
	name: string;
	groupId: string;
	roles: string[];
	active?: boolean;
}
const led = (id: string, name: string, groupId: string, roles: string[] = []): TestLedger => ({
	id,
	name,
	groupId,
	roles,
});
const BASE = [
	led('led_sales', 'Sales', 'g_inc'),
	led('led_rent', 'Rent', 'g_exp'),
	led('led_pl', 'Profit and loss account', 'g_res', ['profit_and_loss']),
];
const PROPRIETOR_LEDGERS = [
	...BASE,
	led('led_capital', 'Capital', 'g_cap', ['capital']),
	led('led_drawings', 'Drawings', 'g_cap', ['drawings']),
];
/** A firm's chart before Year close made its share-of-profit and TDS ledgers. */
const FIRM_LEDGERS = [
	...BASE,
	led('led_cap_p1', 'Rina Das capital', 'g_cap', ['partner_capital_p1']),
	led('led_cur_p1', 'Rina Das current account', 'g_cur', ['partner_current_p1']),
	led('led_cap_p2', 'Amit Sen capital', 'g_cap', ['partner_capital_p2']),
	led('led_cur_p2', 'Amit Sen current account', 'g_cur', ['partner_current_p2']),
	led('led_int', 'Interest on partners’ capital', 'g_app', ['interest_on_partners_capital']),
	led('led_rem', 'Partners’ remuneration', 'g_app', ['partners_remuneration']),
];

/** The shop is listed first, but the bar was made first: the owners' accounts are kept at the bar. */
const LOCATIONS = [
	{ id: 'loc_shop', active: true, warehouse: true, createdAt: '2026-02-01T00:00:00.000Z' },
	{ id: 'loc_bar', active: true, warehouse: true, createdAt: '2026-01-01T00:00:00.000Z' },
	{ id: 'loc_old', active: false, warehouse: true, createdAt: '2025-01-01T00:00:00.000Z' },
];
/** ₹60,000 of profit at the bar and ₹20,000 at the shop; a proprietor's capital and drawings sit at the bar. */
const BALANCES: Record<string, Record<string, number>> = {
	loc_bar: { led_sales: -10_000_000, led_rent: 4_000_000, led_capital: -50_000_000, led_drawings: 1_000_000 },
	loc_shop: { led_sales: -2_000_000 },
};
const PROFIT = 8_000_000;

const term = (id: string, name: string, over: Record<string, unknown> = {}) => ({
	id,
	name,
	working: false,
	profitSharePercent: 50,
	interestOnCapitalPercent: 0,
	monthlyRemunerationINR: 0,
	remunerationBasis: 'none',
	remunerationPercent: 0,
	...over,
});
const PROPRIETOR = { kind: 'proprietorship', partners: [], earlierDeeds: [], partnersCapital: 'fixed_with_current' };
const COMPANY = { kind: 'private_limited', partners: [], earlierDeeds: [], partnersCapital: 'fixed_with_current' };
/** Rina works for ₹5,000 a month and takes 12% on her capital from July; until June the two shared half and half. */
const FIRM = {
	kind: 'partnership',
	partnersCapital: 'fixed_with_current',
	deedFrom: '2026-07-01',
	interestBasis: 'daily',
	lossYearCharges: false,
	partners: [
		term('p1', 'Rina Das', {
			profitSharePercent: 60,
			interestOnCapitalPercent: 12,
			working: true,
			remunerationBasis: 'monthly',
			monthlyRemunerationINR: 5_000,
		}),
		term('p2', 'Amit Sen', { profitSharePercent: 40 }),
	],
	earlierDeeds: [
		{
			from: null,
			to: '2026-06-30',
			interestBasis: 'daily',
			lossYearCharges: false,
			partners: [term('p1', 'Rina Das'), term('p2', 'Amit Sen')],
		},
	],
};
/** Each partner's capital: ₹10,000 before the year and ₹2,000 brought in by the opening entry; Rina's moves after. */
const CAPITAL_BEFORE: Record<string, number> = { led_cap_p1: -1_000_000, led_cap_p2: -500_000 };
const statementLine = (kind: string, date: string, debitPaise: number, creditPaise: number) => ({
	voucherId: `jv_${date}`,
	number: `JV/${date}`,
	kind,
	date,
	narration: '',
	locationId: 'loc_bar',
	debitPaise,
	creditPaise,
});
const CAPITAL_LINES: Record<string, unknown[]> = {
	led_cap_p1: [
		statementLine('opening', '2026-05-15', 0, 200_000),
		statementLine('receipt', '2026-10-01', 0, 300_000),
		statementLine('payment', '2027-01-10', 100_000, 0),
	],
};
/** What the partners' capital trails must read as. */
const TRAILS = {
	p1: {
		openingPaise: 1_200_000,
		moves: [
			{ day: '2026-10-01', paise: 300_000 },
			{ day: '2027-01-10', paise: -100_000 },
		],
	},
	p2: { openingPaise: 500_000, moves: [] },
};

const record = (over: Partial<YearCloseRecord> = {}): YearCloseRecord => ({
	year: YEAR,
	accrualsConfirmedBy: 'adm_acc',
	accrualsConfirmedAt: '2027-04-10T06:00:00.000Z',
	suspenseNote: null,
	closingVoucherId: null,
	profitPaise: null,
	closedBy: null,
	closedAt: null,
	updatedAt: '2027-04-10T06:00:00.000Z',
	...over,
});

interface VoucherLine {
	ledgerId: string;
	locationId: string;
	debitPaise: number;
	creditPaise: number;
}
interface Voucher {
	id: string;
	date: string;
	source: { type: string } | null;
	reversedById: string | null;
	lines: VoucherLine[];
}

interface Options {
	profile?: unknown;
	ledgers?: TestLedger[];
	locations?: unknown[];
	records?: Record<string, YearCloseRecord>;
	vouchers?: Voucher[];
	/** The year-end stock counts; one posted count of every location by default. */
	counts?: unknown[];
}

/**
 * Every check done, so the closing entries may post. The books count each live profit voucher in the balances (a
 * closing voucher never: balances leave the closing lines out), and a ledger Year close makes joins the chart.
 */
function build(options: Options = {}) {
	const records: Record<string, YearCloseRecord> = { [YEAR]: record(), ...options.records };
	const store = {
		get: vi.fn(async (year: string) => records[year] ?? null),
		save: vi.fn(async (next: YearCloseRecord) => void (records[next.year] = next)),
	};
	const vouchers = new Map((options.vouchers ?? []).map((v) => [v.id, v]));
	const chart = { groups: GROUPS, ledgers: [...(options.ledgers ?? PROPRIETOR_LEDGERS)] };
	const books = {
		balancesAt: vi.fn(async (day: string, ids: readonly string[]) => {
			if (day !== '2027-03-31' || !ids.length) return {};
			const out: Record<string, number> = { ...BALANCES[ids[0] as string] };
			for (const v of vouchers.values())
				if (v.source?.type === 'profitShare' && !v.reversedById)
					for (const l of v.lines)
						if (ids.includes(l.locationId) && l.debitPaise - l.creditPaise)
							out[l.ledgerId] = (out[l.ledgerId] ?? 0) + l.debitPaise - l.creditPaise;
			return out;
		}),
		getVoucher: vi.fn(async (id: string) => vouchers.get(id) ?? null),
		balanceBefore: vi.fn(async (ledgerId: string) => CAPITAL_BEFORE[ledgerId] ?? 0),
		statementLines: vi.fn(async (ledgerId: string) => CAPITAL_LINES[ledgerId] ?? []),
	};
	let posted = options.vouchers?.length ?? 0;
	const ledger = {
		chart: async () => chart,
		post: vi.fn(
			async (
				request: {
					date: string;
					source: { type: string };
					lines: { ledger: { id: string }; locationId: string; debitPaise: number; creditPaise: number }[];
				},
				_context: unknown,
				_by: string | null,
			) => {
				const id = `jv_${++posted}`;
				vouchers.set(id, {
					id,
					date: request.date,
					source: request.source,
					reversedById: null,
					lines: request.lines.map((l) => ({
						ledgerId: l.ledger.id,
						locationId: l.locationId,
						debitPaise: l.debitPaise,
						creditPaise: l.creditPaise,
					})),
				});
				return { id };
			},
		),
		reverse: vi.fn(async (id: string, _write: { idempotencyKey: string }) => {
			vouchers.set(id, { ...(vouchers.get(id) as Voucher), reversedById: `${id}_undo` });
			return { id: `${id}_undo` };
		}),
		lockPeriods: vi.fn(async () => []),
		ensureRoleLedger: vi.fn(async (role: string, name: string, groupKey: string) => {
			const id = `led_made_${role}`;
			chart.ledgers.push(led(id, name, GROUPS.find((g) => g.systemKey === groupKey)?.id ?? 'g_none', [role]));
			return id;
		}),
	};
	const service = new YearCloseService(
		store as never,
		books as never,
		{ list: async () => options.locations ?? LOCATIONS } as never,
		{ unfinishedIn: async () => [] } as never,
		{ list: async () => [] } as never,
		{ summary: async () => ({}), inPeriod: async () => [] } as never,
		{
			list: async () => ({
				items: options.counts ?? [{ startedAt: '2027-03-30T10:00:00.000Z', status: 'posted' }],
			}),
		} as never,
		{ inTransitFrom: async () => [] } as never,
		{ list: async () => [] } as never,
		{ list: async () => [] } as never,
		{
			listRegistrations: async () => [],
			getProfile: async () => (options.profile === undefined ? PROPRIETOR : options.profile),
		} as never,
		{ list: async () => [] } as never,
		ledger as never,
		{
			withTransaction: vi.fn(async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' })),
		} as never,
	);
	return { service, store, books, ledger, vouchers, records, chart };
}
const closingState = async (service: YearCloseService) =>
	(await service.view(YEAR)).checks.find((c) => c.key === 'closing')?.state;
type Posted = { lines: { ledger: { id: string }; locationId: string; debitPaise: number; creditPaise: number }[] };
const balanced = (request: Posted) =>
	request.lines.reduce((sum, l) => sum + l.debitPaise, 0) ===
	request.lines.reduce((sum, l) => sum + l.creditPaise, 0);

describe('a proprietor’s profit (YC1)', () => {
	it('goes to capital by default, with drawings closed into it, at the head office', async () => {
		const view = await build().service.view(YEAR);
		expect(view).toMatchObject({
			kind: 'proprietorship',
			profitChoices: ['keep', 'to_capital', 'to_capital_keep_drawings'],
			profitChoice: { option: 'to_capital' },
			profitVoucherId: null,
		});
		expect(view.profitPlan).toMatchObject({
			option: 'to_capital',
			profitPaise: PROFIT,
			rows: [],
			bookProfitPaise: null,
			remunerationLimitPaise: null,
			chargesApplied: false,
			drawingsPaise: 1_000_000,
			// ₹5,00,000 of capital, the year's ₹80,000 in and ₹10,000 of drawings out.
			capitalAfterPaise: 57_000_000,
			reservePaise: 0,
			problems: [],
		});
		expect(view.profitPlan?.lines.map((l) => [l.ledgerName, l.debitPaise, l.creditPaise])).toEqual([
			['Profit and loss account', 2_000_000, 0],
			['Profit and loss account', 6_000_000, 0],
			['Capital', 0, PROFIT],
			['Drawings', 0, 1_000_000],
			['Capital', 1_000_000, 0],
		]);
	});

	it('keeps drawings apart when so chosen', async () => {
		const { service } = build({
			records: {
				[YEAR]: record({
					profitChoice: { option: 'to_capital_keep_drawings', reserveBasis: 'percent', reserveValue: 0 },
				}),
			},
		});
		const { profitPlan } = await service.view(YEAR);
		expect(profitPlan).toMatchObject({ drawingsPaise: 0, capitalAfterPaise: 58_000_000 });
		expect(profitPlan?.lines.map((l) => l.ledgerName)).toEqual([
			'Profit and loss account',
			'Profit and loss account',
			'Capital',
		]);
	});

	it('stays in the profit and loss account after a year closed before, or closing entries posted before choices', async () => {
		const closedBefore = build({ records: { '2025-26': record({ year: '2025-26', closedAt: at }) } });
		const view = await closedBefore.service.view(YEAR);
		expect(closedBefore.store.get).toHaveBeenCalledWith('2025-26');
		expect(view.profitChoice.option).toBe('keep');
		expect(view.profitPlan).toMatchObject({ option: 'keep', lines: [], capitalAfterPaise: null, problems: [] });
		const postedEarlier = build({ records: { [YEAR]: record({ closingVoucherId: 'jv_c' }) } });
		expect((await postedEarlier.service.view(YEAR)).profitChoice.option).toBe('keep');
		// Posted with a choice already: the kind's usual one, not "keep".
		const postedWithChoice = build({
			records: { [YEAR]: record({ closingVoucherId: 'jv_c', postedChoice: '["to_capital"]' }) },
		});
		expect((await postedWithChoice.service.view(YEAR)).profitChoice.option).toBe('to_capital');
	});

	it('has nowhere to go without an active location, so posting is refused', async () => {
		const { service, ledger } = build({ locations: LOCATIONS.map((l) => ({ ...l, active: false })) });
		expect((await service.view(YEAR)).profitPlan?.problems).toEqual(['no_location']);
		await expect(service.postClosing(YEAR, ca, now)).rejects.toMatchObject(refusal('profit_plan_no_location'));
		expect(ledger.post).not.toHaveBeenCalled();
	});
});

describe('a company’s profit (YC1)', () => {
	it('stays as surplus with part moved to general reserve, a ledger Year close makes when it isn’t there', async () => {
		const { service, ledger, records } = build({
			profile: COMPANY,
			ledgers: BASE,
			records: {
				[YEAR]: record({
					profitChoice: { option: 'to_general_reserve', reserveBasis: 'percent', reserveValue: 25 },
				}),
			},
		});
		const view = await service.view(YEAR);
		expect(view).toMatchObject({ kind: 'private_limited', profitChoices: ['keep', 'to_general_reserve'] });
		expect(view.profitPlan).toMatchObject({ reservePaise: 2_000_000, capitalAfterPaise: null, drawingsPaise: 0 });
		expect(view.profitPlan?.lines.map((l) => [l.ledgerName, l.debitPaise, l.creditPaise])).toEqual([
			['Profit and loss account', 2_000_000, 0],
			['General reserve', 0, 2_000_000],
		]);
		await service.postClosing(YEAR, ca, now);
		expect(ledger.ensureRoleLedger).toHaveBeenCalledExactlyOnceWith(
			'general_reserve',
			'General reserve',
			'reserves_and_surplus',
			'adm_ca',
		);
		expect(ledger.post.mock.calls[0]?.[0].lines.map((l) => l.ledger.id)).toEqual([
			'led_pl',
			'led_made_general_reserve',
		]);
		// The reserve's figures are part of what was posted.
		expect(records[YEAR]?.postedChoice).toBe('["to_general_reserve","percent",25]');
		expect(await closingState(service)).toBe('ok');
	});

	it('posts no profit voucher when the profit stays where it is', async () => {
		const { service, ledger, books, records } = build({ profile: null, ledgers: BASE });
		await service.postClosing(YEAR, undefined, now);
		expect(ledger.post).toHaveBeenCalledOnce();
		expect(ledger.post.mock.calls[0]?.[0].source).toEqual({ type: 'yearClose', id: YEAR, number: null });
		// The checks' view, the books read once (nothing was posted before the closing entries), the view returned.
		expect(books.balancesAt.mock.calls.filter(([day]) => day === '2027-03-31')).toHaveLength(4 + 3 + 4);
		expect(records[YEAR]).toMatchObject({
			profitVoucherId: null,
			postedChoice: '["keep"]',
			closingVoucherId: 'jv_1',
		});
	});
});

describe('a firm’s sharing (YC3)', () => {
	it('reads each partner’s capital through the year, opening entries as capital at the start, and shares as the deed says', async () => {
		const { service, books } = build({ profile: FIRM, ledgers: FIRM_LEDGERS });
		const view = await service.view(YEAR);
		expect(books.balanceBefore).toHaveBeenCalledWith('led_cap_p1', '2026-04-01', []);
		expect(books.statementLines).toHaveBeenCalledWith('led_cap_p1', '2026-04-01', '2027-03-31', []);
		// Each partner once, though both are in the earlier deed too.
		expect(books.balanceBefore).toHaveBeenCalledTimes(2);
		const expected = shareProfit({
			method: 'deed',
			from: '2026-04-01',
			to: '2027-03-31',
			profitPaise: PROFIT,
			book: FIRM as never,
			capital: TRAILS,
		});
		expect(view.profitPlan).toMatchObject({
			option: 'deed',
			profitPaise: PROFIT,
			rows: expected.rows,
			bookProfitPaise: expected.bookProfitPaise,
			remunerationLimitPaise: expected.remunerationLimitPaise,
			chargesApplied: true,
			capitalAfterPaise: null,
			problems: [],
		});
		// Nine months of ₹5,000 and her interest pass ₹20,000, so TDS is taken.
		expect(expected.rows[0]?.tdsPaise).toBeGreaterThan(0);
		expect(view.profitPlan?.lines.map((l) => l.ledgerName)).toEqual([
			'Interest on partners’ capital',
			'Partners’ remuneration',
			'Share of profit to partners',
			'Rina Das current account',
			'Rina Das current account',
			'TDS payable on partners (194T)',
			'Share of profit to partners',
			'Amit Sen current account',
		]);
	});

	it('posts the sharing first, making the ledgers it needs, then closes the books it moved', async () => {
		const { service, ledger, records } = build({ profile: FIRM, ledgers: FIRM_LEDGERS });
		const before = await service.view(YEAR);
		const view = await service.postClosing(YEAR, ca, now);
		expect(ledger.ensureRoleLedger.mock.calls).toEqual([
			['partners_profit_share', 'Share of profit to partners', 'appropriation', 'adm_ca'],
			['tds_payable_partners', 'TDS payable on partners (194T)', 'duties_and_taxes', 'adm_ca'],
		]);
		const [share, closing] = ledger.post.mock.calls.map(([request]) => request) as unknown as [
			Posted & Record<string, unknown>,
			Posted,
		];
		expect(share).toMatchObject({
			kind: 'journal',
			date: '2027-03-31',
			narration: 'Where the profit of 2026-27 goes',
			source: { type: 'profitShare', id: YEAR, number: null },
		});
		expect(String(share['idempotencyKey'])).toMatch(/^profitShare:2026-27:/);
		expect(share.lines.map((l) => l.ledger.id)).toEqual([
			'led_int',
			'led_rem',
			'led_made_partners_profit_share',
			'led_cur_p1',
			'led_cur_p1',
			'led_made_tds_payable_partners',
			'led_made_partners_profit_share',
			'led_cur_p2',
		]);
		expect(share.lines.map((l) => (l as unknown as { narration: string }).narration)).toEqual(
			before.profitPlan?.lines.map((l) => l.narration),
		);
		expect(share.lines.every((l) => l.locationId === 'loc_bar')).toBe(true);
		expect(balanced(share)).toBe(true);
		// The closing entries take the appropriation ledgers the sharing just moved back to nothing.
		const rina = before.profitPlan?.rows[0];
		expect(closing.lines).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					ledger: { id: 'led_int' },
					locationId: 'loc_bar',
					creditPaise: rina?.interestPaise,
				}),
				expect.objectContaining({
					ledger: { id: 'led_rem' },
					locationId: 'loc_bar',
					creditPaise: rina?.remunerationPaise,
				}),
			]),
		);
		expect(records[YEAR]).toMatchObject({
			profitVoucherId: 'jv_1',
			closingVoucherId: 'jv_2',
			postedChoice: '["deed"]',
			profitPaise: PROFIT,
			updatedAt: at,
		});
		// Read again with the sharing taken back out: the same plan, so the closing entries stand.
		expect(view.profitVoucherId).toBe('jv_1');
		expect(view.profitPlan?.rows).toEqual(before.profitPlan?.rows);
		expect(view.checks.find((c) => c.key === 'closing')?.state).toBe('ok');
	});

	it('cannot share without every partner’s capital ledger, a retired one’s included', async () => {
		const retired = {
			...FIRM,
			earlierDeeds: [{ ...FIRM.earlierDeeds[0], partners: [term('p1', 'Rina Das'), term('p3', 'Sudip Roy')] }],
		};
		const { service, ledger } = build({ profile: retired, ledgers: FIRM_LEDGERS });
		expect((await service.view(YEAR)).profitPlan?.problems).toEqual(['partner_ledgers_missing']);
		await expect(service.postClosing(YEAR, ca, now)).rejects.toMatchObject(
			refusal('profit_plan_partner_ledgers_missing'),
		);
		expect(ledger.post).not.toHaveBeenCalled();
	});

	it('passes on what the sharing finds wrong, as with shares that don’t make 100%', async () => {
		const short = {
			...FIRM,
			partners: [
				term('p1', 'Rina Das', { profitSharePercent: 50 }),
				term('p2', 'Amit Sen', { profitSharePercent: 40 }),
			],
			earlierDeeds: [],
		};
		const { service } = build({
			profile: short,
			ledgers: FIRM_LEDGERS,
			records: {
				[YEAR]: record({ profitChoice: { option: 'ratio_only', reserveBasis: 'percent', reserveValue: 0 } }),
			},
		});
		const { profitPlan } = await service.view(YEAR);
		expect(profitPlan).toMatchObject({ option: 'ratio_only', bookProfitPaise: null, chargesApplied: false });
		expect(profitPlan?.problems).toEqual(['partner_shares_total_100']);
	});

	it('names a partner’s missing current account by its role, and refuses to post to it', async () => {
		const { service, ledger } = build({
			profile: FIRM,
			ledgers: FIRM_LEDGERS.filter((l) => l.id !== 'led_cur_p2'),
		});
		const { profitPlan } = await service.view(YEAR);
		expect(profitPlan?.problems).toEqual([]);
		expect(profitPlan?.lines.at(-1)?.ledgerName).toBe('partner_current_p2');
		await expect(service.postClosing(YEAR, ca, now)).rejects.toMatchObject(refusal('profit_plan_ledger_missing'));
		expect(ledger.post).not.toHaveBeenCalled();
	});
});

describe('closing entries out of date (YC1)', () => {
	/** The proprietor's books as posted: the profit voucher of today's plan, then the closing entries. */
	async function posted() {
		const first = build();
		await first.service.postClosing(YEAR, ca, now);
		const vouchers = [...first.vouchers.values()];
		return (over: Partial<YearCloseRecord> = {}, change: (v: Voucher[]) => Voucher[] = (v) => v) =>
			build({
				records: { [YEAR]: { ...(first.records[YEAR] as YearCloseRecord), ...over } },
				vouchers: change(vouchers),
			});
	}

	it('stand while the choice and its sharing are as posted', async () => {
		const again = await posted();
		const { service } = again();
		const view = await service.view(YEAR);
		expect([view.profitVoucherId, view.canPostClosing]).toEqual(['jv_1', false]);
		expect(await closingState(service)).toBe('ok');
	});

	it('go out of date when the choice changed, or the posted sharing no longer matches or stands', async () => {
		const again = await posted();
		expect(
			await closingState(
				again({
					profitChoice: { option: 'to_capital_keep_drawings', reserveBasis: 'percent', reserveValue: 0 },
				}).service,
			),
		).toBe('attention');
		// Drawings closed at ₹5,000 instead of ₹10,000, and a line at a location the books no longer have.
		const differs = again({}, (vouchers) =>
			vouchers.map((v) =>
				v.id === 'jv_1'
					? {
							...v,
							lines: [
								...v.lines.map((l) =>
									l.ledgerId === 'led_drawings' ? { ...l, creditPaise: 500_000 } : l,
								),
								{ ledgerId: 'led_capital', locationId: 'loc_gone', debitPaise: 0, creditPaise: 0 },
								{ ledgerId: 'led_capital', locationId: 'loc_shop', debitPaise: 0, creditPaise: 0 },
							],
						}
					: v,
			),
		);
		expect(await closingState(differs.service)).toBe('attention');
		const reversed = again({}, (vouchers) =>
			vouchers.map((v) => (v.id === 'jv_1' ? { ...v, reversedById: 'jv_undo' } : v)),
		);
		expect((await reversed.service.view(YEAR)).profitVoucherId).toBeNull();
		expect(await closingState(reversed.service)).toBe('attention');
		const gone = again({}, (vouchers) => vouchers.filter((v) => v.id !== 'jv_1'));
		expect(await closingState(gone.service)).toBe('attention');
	});

	it('are never out of date once the year is closed', async () => {
		const again = await posted();
		const { service } = again({
			closedAt: at,
			profitChoice: { option: 'to_capital_keep_drawings', reserveBasis: 'percent', reserveValue: 0 },
		});
		expect(await closingState(service)).toBe('ok');
	});

	it('are posted again with the new choice, both old vouchers reversed first', async () => {
		const again = await posted();
		const { service, ledger, records } = again({
			profitChoice: { option: 'to_capital_keep_drawings', reserveBasis: 'percent', reserveValue: 0 },
		});
		await service.postClosing(YEAR, ca, now);
		expect(ledger.reverse.mock.calls.map(([id, write]) => [id, write.idempotencyKey])).toEqual([
			['jv_2', 'yearCloseUndo:jv_2'],
			['jv_1', 'yearCloseUndo:jv_1'],
		]);
		expect(records[YEAR]).toMatchObject({ postedChoice: '["to_capital_keep_drawings"]' });
		expect(await closingState(service)).toBe('ok');
	});
});

describe('choosing where the profit goes', () => {
	it('saves a choice the kind offers, and refuses one it doesn’t', async () => {
		const { service, store } = build();
		const toCapital = { option: 'to_capital_keep_drawings', reserveBasis: 'percent', reserveValue: 0 } as const;
		const view = await service.confirm(
			YEAR,
			{ accruals: false, suspenseNote: null, profitChoice: toCapital },
			ca,
			now,
		);
		expect(view.profitChoice).toEqual(toCapital);
		expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ profitChoice: toCapital }));
		const deed = { option: 'deed', reserveBasis: 'percent', reserveValue: 0 } as const;
		await expect(
			service.confirm(YEAR, { accruals: false, suspenseNote: null, profitChoice: deed }, ca, now),
		).rejects.toMatchObject(refusal('profit_choice_not_offered'));
		// No profile yet: a company's choices.
		const company = build({ profile: null });
		await expect(
			company.service.confirm(YEAR, { accruals: false, suspenseNote: null, profitChoice: toCapital }, ca, now),
		).rejects.toMatchObject(refusal('profit_choice_not_offered'));
		expect(company.store.save).not.toHaveBeenCalled();
	});
});

describe('the year-end stock counts by location (SC2)', () => {
	const at = (locationId: string | null, status = 'posted') => ({
		startedAt: '2027-03-30T10:00:00.000Z',
		status,
		locationId,
	});
	const stock = async (counts: unknown[], locations: unknown[] = LOCATIONS) =>
		(await build({ counts, locations }).service.view(YEAR)).checks.find((c) => c.key === 'stock_count');
	/** The bar and the shop are warehouses; the old one is closed and the kiosk keeps no stock. */
	const WITH_KIOSK = [...LOCATIONS, { id: 'loc_kiosk', active: true, warehouse: false, createdAt: '2026-03-01' }];

	it('waits for every active warehouse to be counted, a count still open at one not counting', async () => {
		expect(await stock([at('loc_bar'), at('loc_shop', 'counting')], WITH_KIOSK)).toMatchObject({
			state: 'attention',
			// The shop's count is open, and the shop is not counted yet.
			count: 2,
			of: 1,
		});
		expect(await stock([at('loc_bar'), at('loc_shop')], WITH_KIOSK)).toMatchObject({
			state: 'ok',
			count: 0,
			of: 2,
		});
	});

	it('takes a posted count of every location as covering every warehouse', async () => {
		expect(await stock([at('loc_bar'), at(null)], WITH_KIOSK)).toMatchObject({ state: 'ok', count: 0 });
	});
});
