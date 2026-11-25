import { describe, expect, it } from 'vitest';

import type { DeedTerm } from '@saha-textile/contracts';

import {
	deedOn,
	defaultProfitChoice,
	partnerTdsPaise,
	profitChoiceFor,
	profitPlanLines,
	remunerationLimitPaise,
	shareProfit,
	splitByWeights,
	type DeedBook,
} from '../src/ledger/profit-share';
import { profitByLocation, withProfitCarried, yearFigures } from '../src/ledger/year-close';
import { deedsInOrder } from '../src/company/company-rules';

const term = (id: string, name: string, share: number, monthly: number, over: Partial<DeedTerm> = {}): DeedTerm => ({
	id,
	name,
	working: true,
	profitSharePercent: share,
	interestOnCapitalPercent: 12,
	monthlyRemunerationINR: monthly,
	remunerationBasis: 'monthly',
	remunerationPercent: 0,
	...over,
});

const book = (over: Partial<DeedBook> = {}): DeedBook => ({
	deedFrom: '2026-04-01',
	interestBasis: 'daily',
	lossYearCharges: false,
	partners: [term('p_a', 'Arindam', 60, 60_000), term('p_r', 'Rupa', 40, 40_000)],
	earlierDeeds: [],
	...over,
});

const capital = {
	p_a: { openingPaise: 100_000_000, moves: [] },
	p_r: { openingPaise: 50_000_000, moves: [] },
};

describe('brief 25 YC3: the firm example', () => {
	const result = shareProfit({
		method: 'deed',
		from: '2026-04-01',
		to: '2027-03-31',
		profitPaise: 180_000_000,
		book: book(),
		capital,
	});

	it('pays 12% interest, the deed remuneration and the rest 60:40', () => {
		expect(result.rows.map((r) => [r.interestPaise, r.remunerationPaise, r.sharePaise, r.totalPaise])).toEqual([
			[12_000_000, 72_000_000, 25_200_000, 109_200_000],
			[6_000_000, 48_000_000, 16_800_000, 70_800_000],
		]);
	});

	it('shows the s.40(b) limit on book profit after interest and what goes over it', () => {
		expect(result.bookProfitPaise).toBe(162_000_000);
		expect(result.remunerationLimitPaise).toBe(115_200_000);
		expect(result.remunerationDisallowedPaise).toBe(4_800_000);
		expect(result.interestDisallowedPaise).toBe(0);
	});

	it('takes 10% TDS on interest and remuneration', () => {
		expect(result.rows.map((r) => r.tdsPaise)).toEqual([8_400_000, 5_400_000]);
		expect(result.problems).toEqual([]);
	});

	it('posts through the appropriation ledgers to each current account', () => {
		const { lines } = profitPlanLines({
			choice: { option: 'deed', reserveBasis: 'percent', reserveValue: 0 },
			profitByLocation: { loc_ho: 180_000_000 },
			ownersLocationId: 'loc_ho',
			drawingsByLocation: {},
			share: result,
			partnersCapital: 'fixed_with_current',
		});
		const debit = lines.reduce((sum, l) => sum + l.debitPaise, 0);
		const credit = lines.reduce((sum, l) => sum + l.creditPaise, 0);
		expect(debit).toBe(credit);
		expect(lines.filter((l) => l.role === 'tds_payable_partners').map((l) => l.creditPaise)).toEqual([
			8_400_000, 5_400_000,
		]);
		expect(lines.find((l) => l.role === 'partner_current_p_a' && l.creditPaise)?.creditPaise).toBe(109_200_000);
	});
});

describe('sharing through the year', () => {
	it('weights the ratio and the interest by the days each deed ruled', () => {
		const result = shareProfit({
			method: 'deed',
			from: '2026-04-01',
			to: '2027-03-31',
			profitPaise: 36_500_000,
			book: book({
				deedFrom: '2026-10-01',
				earlierDeeds: [
					{
						from: null,
						to: '2026-09-30',
						interestBasis: 'daily',
						lossYearCharges: false,
						partners: [
							term('p_a', 'Arindam', 50, 0, { interestOnCapitalPercent: 0 }),
							term('p_r', 'Rupa', 50, 0, { interestOnCapitalPercent: 0 }),
						],
					},
				],
				partners: [
					term('p_a', 'Arindam', 100, 0, { interestOnCapitalPercent: 0 }),
					term('p_r', 'Rupa', 0, 0, { interestOnCapitalPercent: 0, working: false }),
				],
			}),
			capital,
		});
		// 183 days at 50:50, 182 days at 100:0.
		expect(result.rows.map((r) => r.sharePaise)).toEqual([27_350_000, 9_150_000]);
	});

	it('counts capital brought in from the next day', () => {
		const result = shareProfit({
			method: 'deed',
			from: '2026-04-01',
			to: '2027-03-31',
			profitPaise: 50_000_000,
			book: book({ partners: [term('p_a', 'Arindam', 100, 0)] }),
			capital: { p_a: { openingPaise: 0, moves: [{ day: '2026-10-01', paise: 36_500_000 }] } },
		});
		// ₹3,65,000 earns 12% for the 181 days from 2 Oct to 31 Mar.
		expect(result.rows[0]?.interestPaise).toBe(Math.round((36_500_000 * 0.12 * 181) / 365));
	});

	it('shares a loss in the ratio only, unless the deed pays charges in a loss year', () => {
		const loss = { method: 'deed' as const, from: '2026-04-01', to: '2027-03-31', profitPaise: -1_000_001, capital };
		const plain = shareProfit({ ...loss, book: book() });
		expect(plain.chargesApplied).toBe(false);
		expect(plain.rows.map((r) => r.sharePaise)).toEqual([-600_001, -400_000]);
		const charged = shareProfit({ ...loss, book: book({ lossYearCharges: true }) });
		expect(charged.chargesApplied).toBe(true);
		expect(charged.rows[0]?.interestPaise).toBe(12_000_000);
	});

	it('names deeds whose shares are not 100% and a year with no partners', () => {
		const result = shareProfit({
			method: 'ratio_only',
			from: '2026-04-01',
			to: '2026-04-02',
			profitPaise: 100,
			book: book({ partners: [] }),
			capital: {},
		});
		expect(result.problems).toEqual(['partner_shares_total_100', 'partners_missing']);
		expect(result.bookProfitPaise).toBeNull();
	});
});

describe('the pieces', () => {
	it('splits to the paisa', () => {
		expect(splitByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
		expect(splitByWeights(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
		expect(splitByWeights(5, [0, 0])).toEqual([0, 0]);
	});

	it('limits remuneration and takes TDS only over ₹20,000', () => {
		expect(remunerationLimitPaise(-5)).toBe(30_000_000);
		expect(remunerationLimitPaise(50_000_000)).toBe(45_000_000);
		expect(partnerTdsPaise(2_000_000)).toBe(0);
		expect(partnerTdsPaise(2_000_100)).toBe(200_000);
	});

	it('offers each kind its choices', () => {
		expect(defaultProfitChoice('proprietorship', false).option).toBe('to_capital');
		expect(defaultProfitChoice('llp', false).option).toBe('deed');
		expect(defaultProfitChoice('private_limited', false).option).toBe('keep');
		expect(defaultProfitChoice('partnership', true).option).toBe('keep');
		const reserve = { option: 'to_general_reserve' as const, reserveBasis: 'amount' as const, reserveValue: 5 };
		expect(profitChoiceFor('private_limited', reserve, false)).toBe(reserve);
		expect(profitChoiceFor('proprietorship', reserve, false).option).toBe('to_capital');
	});

	it('finds the deed ruling a day', () => {
		const deeds = book({
			earlierDeeds: [{ from: null, to: '2026-03-31', interestBasis: 'opening', lossYearCharges: true, partners: [] }],
		});
		expect(deedOn(deeds, '2026-03-31').interestBasis).toBe('opening');
		expect(deedOn(deeds, '2026-04-01').interestBasis).toBe('daily');
	});

	it('keeps deeds in order', () => {
		const deed = { interestBasis: 'daily' as const, lossYearCharges: false, partners: [] };
		expect(deedsInOrder({ deedFrom: null, earlierDeeds: [] })).toBe(true);
		expect(
			deedsInOrder({
				deedFrom: '2026-04-01',
				earlierDeeds: [
					{ ...deed, from: null, to: '2025-03-31' },
					{ ...deed, from: '2025-04-01', to: '2026-03-31' },
				],
			}),
		).toBe(true);
		expect(deedsInOrder({ deedFrom: null, earlierDeeds: [{ ...deed, from: null, to: '2026-03-31' }] })).toBe(false);
		expect(
			deedsInOrder({ deedFrom: '2026-04-01', earlierDeeds: [{ ...deed, from: '2026-03-31', to: '2026-03-01' }] }),
		).toBe(false);
	});
});

describe('proprietor and company choices', () => {
	const base = { ownersLocationId: 'loc_ho', share: null, partnersCapital: 'fixed_with_current' as const };

	it('moves the profit to capital and closes drawings into it (YC1)', () => {
		const { lines, drawingsPaise } = profitPlanLines({
			...base,
			choice: { option: 'to_capital', reserveBasis: 'percent', reserveValue: 0 },
			profitByLocation: { loc_ho: 15_000_000, loc_br: 5_500_000 },
			drawingsByLocation: { loc_ho: 31_000_000 },
		});
		expect(drawingsPaise).toBe(31_000_000);
		expect(lines.map((l) => [l.role, l.locationId, l.debitPaise, l.creditPaise])).toEqual([
			['profit_and_loss', 'loc_ho', 15_000_000, 0],
			['profit_and_loss', 'loc_br', 5_500_000, 0],
			['capital', 'loc_ho', 0, 20_500_000],
			['drawings', 'loc_ho', 0, 31_000_000],
			['capital', 'loc_ho', 31_000_000, 0],
		]);
	});

	it('keeps drawings apart when asked', () => {
		const { lines } = profitPlanLines({
			...base,
			choice: { option: 'to_capital_keep_drawings', reserveBasis: 'percent', reserveValue: 0 },
			profitByLocation: { loc_ho: 100 },
			drawingsByLocation: { loc_ho: 50 },
		});
		expect(lines).toHaveLength(2);
	});

	it('moves a % or an amount to general reserve, never more than the profit', () => {
		const at = (reserveBasis: 'amount' | 'percent', reserveValue: number, profit: number) =>
			profitPlanLines({
				...base,
				choice: { option: 'to_general_reserve', reserveBasis, reserveValue },
				profitByLocation: { loc_ho: profit },
				drawingsByLocation: {},
			}).reservePaise;
		expect(at('percent', 10, 2_000_000)).toBe(200_000);
		expect(at('amount', 50_000, 2_000_000)).toBe(2_000_000);
		expect(at('amount', 5, -100)).toBe(0);
	});

	it('posts nothing to keep, or to share without a sharing', () => {
		for (const option of ['keep', 'deed'] as const)
			expect(
				profitPlanLines({
					...base,
					choice: { option, reserveBasis: 'percent', reserveValue: 0 },
					profitByLocation: { loc_ho: 100 },
					drawingsByLocation: {},
				}).lines,
			).toEqual([]);
	});
});

describe('the year in reports', () => {
	const chart = {
		groups: [
			{ id: 'g_inc', parentId: null, nature: 'income' },
			{ id: 'g_app', parentId: null, nature: 'expense', systemKey: 'appropriation' },
			{ id: 'g_app_sub', parentId: 'g_app', nature: 'expense' },
			{ id: 'g_cap', parentId: null, nature: 'equity' },
		],
		ledgers: [
			{ id: 'sales', groupId: 'g_inc' },
			{ id: 'share', groupId: 'g_app_sub' },
			{ id: 'pl', groupId: 'g_cap' },
		],
	};

	it("reads the profit before sharing at each location", () => {
		const byLocation = {
			loc_ho: { closing: { sales: -1_000, share: 400 }, opening: {} },
			loc_br: { closing: { sales: -300 }, opening: { sales: -100 } },
		};
		expect(profitByLocation(chart, byLocation, 'pl')).toEqual({ loc_ho: 1_000, loc_br: 200 });
	});

	it("carries earlier years' profit into the profit and loss account", () => {
		const ledgers = [
			{ id: 'sales', nature: 'income', systemKey: 'sales' },
			{ id: 'pl', nature: 'equity', systemKey: 'profit_and_loss' },
			{ id: 'cash', nature: 'asset', systemKey: null },
		];
		expect(withProfitCarried(ledgers, { sales: -900, cash: 900 }, { sales: -600 })).toEqual({
			sales: -900,
			cash: 900,
			pl: -600,
		});
		expect(yearFigures(ledgers, { sales: -900, cash: 900 }, { sales: -600 })).toEqual({
			sales: -300,
			cash: 900,
			pl: -600,
		});
		expect(withProfitCarried(ledgers.slice(0, 1), { sales: -1 }, { sales: -1 })).toEqual({ sales: -1 });
	});
});
