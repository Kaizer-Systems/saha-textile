import { describe, expect, it } from 'vitest';

import type { CompanyProfile, DeedTerm } from '@saha-textile/contracts';

import {
	appropriationLedgerIds,
	deedOn,
	defaultProfitChoice,
	PARTNER_TDS_LIMIT_PAISE,
	partnerRole,
	partnerTdsPaise,
	PROFIT_CHOICES,
	PROFIT_LEDGERS,
	profitChoiceFor,
	profitPlanLines,
	remunerationLimitPaise,
	shareProfit,
	splitByWeights,
	type DeedBook,
} from '../src/ledger/profit-share';
import { profitByLocation, withProfitCarried, yearFigures } from '../src/ledger/year-close';
import { companyProblems, deedsInOrder } from '../src/company/company-rules';

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
		const loss = {
			method: 'deed' as const,
			from: '2026-04-01',
			to: '2027-03-31',
			profitPaise: -1_000_001,
			capital,
		};
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
			earlierDeeds: [
				{ from: null, to: '2026-03-31', interestBasis: 'opening', lossYearCharges: true, partners: [] },
			],
		});
		expect(deedOn(deeds, '2026-03-31')?.interestBasis).toBe('opening');
		expect(deedOn(deeds, '2026-04-01')?.interestBasis).toBe('daily');
	});

	it('finds no deed before today’s began, or in a gap between deeds', () => {
		const later = book({
			deedFrom: '2026-10-01',
			earlierDeeds: [
				{ from: '2026-04-01', to: '2026-06-30', interestBasis: 'opening', lossYearCharges: true, partners: [] },
			],
		});
		expect(deedOn(later, '2026-06-30')?.interestBasis).toBe('opening');
		expect(deedOn(later, '2026-07-01')).toBeNull();
		expect(deedOn(later, '2026-09-30')).toBeNull();
		expect(deedOn(later, '2026-10-01')?.interestBasis).toBe('daily');
		expect(deedOn(book({ deedFrom: null }), '2020-01-01')?.interestBasis).toBe('daily');
	});

	it('shares equally and charges nothing for the days no deed covers (s.13(b), s.40(b))', () => {
		// The deed starts on 1 October with no earlier one: April to September share 50:50 with no interest or pay.
		const result = shareProfit({
			method: 'deed',
			from: '2026-04-01',
			to: '2027-03-31',
			profitPaise: 180_000_000,
			book: book({ deedFrom: '2026-10-01' }),
			capital,
		});
		const [a, r] = result.rows;
		// Remuneration for October to March only: 6 months at ₹60,000 and ₹40,000.
		expect([a?.remunerationPaise, r?.remunerationPaise]).toEqual([36_000_000, 24_000_000]);
		// Interest at 12% for 182 of 365 days on ₹10,00,000 and ₹5,00,000.
		expect(a?.interestPaise).toBe(Math.round((100_000_000 * 0.12 * 182) / 365));
		expect(r?.interestPaise).toBe(Math.round((50_000_000 * 0.12 * 182) / 365));
		// Ratio: 183 days at 50:50 and 182 at 60:40.
		expect(a?.sharePercent).toBe(Math.round(((183 * 50 + 182 * 60) / 365) * 100) / 100);
		expect(result.rows.reduce((sum, row) => sum + row.totalPaise, 0)).toBe(180_000_000);
		expect(result.problems).toEqual([]);
	});

	it('shares a year before the deed began equally, paying nothing', () => {
		const result = shareProfit({
			method: 'deed',
			from: '2026-04-01',
			to: '2027-03-31',
			profitPaise: 100_000,
			book: book({ deedFrom: '2027-06-01' }),
			capital,
		});
		expect(result.rows.map((row) => [row.interestPaise, row.remunerationPaise, row.sharePaise])).toEqual([
			[0, 0, 50_000],
			[0, 0, 50_000],
		]);
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

	it('reads the profit before sharing at each location', () => {
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

const year = { from: '2026-04-01', to: '2027-03-31' } as const;

describe('the deed’s terms, one by one', () => {
	it('pays a working partner a % of book profit, none to one whose deed says none, and the rest in the ratio', () => {
		const result = shareProfit({
			...year,
			method: 'deed',
			profitPaise: 180_000_000,
			book: book({
				partners: [
					term('p_a', 'Arindam', 60, 0, {
						remunerationBasis: 'percent_of_book_profit',
						remunerationPercent: 50,
					}),
					// A monthly sum left in the form is not paid once the deed says no remuneration.
					term('p_r', 'Rupa', 40, 40_000, { remunerationBasis: 'none' }),
				],
			}),
			capital,
		});
		// Book profit ₹16,20,000 after ₹1,80,000 interest; half of it to Arindam; ₹8,10,000 left, 60:40.
		expect(result.bookProfitPaise).toBe(162_000_000);
		expect(result.rows.map((r) => [r.interestPaise, r.remunerationPaise, r.sharePaise, r.tdsPaise])).toEqual([
			[12_000_000, 81_000_000, 48_600_000, 9_300_000],
			[6_000_000, 0, 32_400_000, 600_000],
		]);
		expect(result.remunerationDisallowedPaise).toBe(0);
	});

	it('pays no % of a loss, though the deed charges interest and monthly sums in a loss year', () => {
		const result = shareProfit({
			...year,
			method: 'deed',
			profitPaise: -10_000_000,
			book: book({
				lossYearCharges: true,
				partners: [
					term('p_a', 'Arindam', 60, 0, {
						remunerationBasis: 'percent_of_book_profit',
						remunerationPercent: 50,
					}),
					term('p_r', 'Rupa', 40, 1_000),
				],
			}),
			capital,
		});
		expect(result.chargesApplied).toBe(true);
		expect(result.bookProfitPaise).toBe(-28_000_000);
		// s.40(b)(v): a loss still allows ₹3,00,000.
		expect(result.remunerationLimitPaise).toBe(30_000_000);
		// ₹1,80,000 interest and ₹12,000 to Rupa widen the ₹1,00,000 loss to ₹2,92,000, shared 60:40.
		expect(result.rows.map((r) => [r.remunerationPaise, r.sharePaise, r.totalPaise])).toEqual([
			[0, -17_520_000, -5_520_000],
			[1_200_000, -11_680_000, -4_480_000],
		]);
	});

	it('counts interest on each day’s capital, moves taken in date order, or on the opening capital alone', () => {
		const trail = {
			p_a: {
				openingPaise: 100_000_000,
				moves: [
					{ day: '2026-10-01', paise: 36_500_000 },
					{ day: '2026-07-01', paise: 36_500_000 },
				],
			},
		};
		const sole = [term('p_a', 'Arindam', 100, 0)];
		const daily = shareProfit({
			...year,
			method: 'deed',
			profitPaise: 50_000_000,
			book: book({ partners: sole }),
			capital: trail,
		});
		// ₹10,00,000 all year at 12%, and ₹120 a day on each ₹3,65,000: 273 days from 2 July, 181 from 2 October.
		expect(daily.rows[0]?.interestPaise).toBe(12_000_000 + 12_000 * 273 + 12_000 * 181);
		const opening = shareProfit({
			...year,
			method: 'deed',
			profitPaise: 50_000_000,
			book: book({ partners: sole, interestBasis: 'opening' }),
			capital: trail,
		});
		expect(opening.rows[0]?.interestPaise).toBe(12_000_000);
	});

	it('pays no interest on capital overdrawn or never brought in', () => {
		const result = shareProfit({
			...year,
			method: 'deed',
			profitPaise: 50_000_000,
			book: book({ partners: [term('p_a', 'Arindam', 50, 0), term('p_r', 'Rupa', 50, 0)] }),
			capital: { p_a: { openingPaise: -10_000_000, moves: [] } },
		});
		expect(result.rows.map((r) => r.interestPaise)).toEqual([0, 0]);
		expect(result.rows.map((r) => r.sharePaise)).toEqual([25_000_000, 25_000_000]);
	});

	it('pays a deed’s rate above 12% but shows the part s.40(b)(iv) disallows, and book profit after the allowed part only', () => {
		const result = shareProfit({
			...year,
			method: 'deed',
			profitPaise: 100_000_000,
			book: book({ partners: [term('p_a', 'Arindam', 100, 0, { interestOnCapitalPercent: 15 })] }),
			capital,
		});
		expect(result.rows[0]).toMatchObject({ interestPaise: 15_000_000, interestAllowedPaise: 12_000_000 });
		expect(result.interestDisallowedPaise).toBe(3_000_000);
		expect(result.bookProfitPaise).toBe(88_000_000);
	});

	it('shares a deed’s terms for the days it ruled, a partner who left listed after today’s partners', () => {
		const result = shareProfit({
			...year,
			method: 'deed',
			profitPaise: 54_500_000,
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
							term('p_old', 'Bimal', 50, 10_000, { interestOnCapitalPercent: 0 }),
						],
					},
				],
				partners: [
					term('p_a', 'Arindam', 50, 0, { interestOnCapitalPercent: 0 }),
					term('p_r', 'Rupa', 50, 20_000, { interestOnCapitalPercent: 0 }),
				],
			}),
			capital,
		});
		// Bimal is paid ₹10,000 for April to September, Rupa ₹20,000 for October to March; ₹3,65,000 left, Arindam
		// half all year, Bimal half of 183 days, Rupa half of 182.
		expect(result.rows.map((r) => [r.partnerId, r.remunerationPaise, r.sharePaise, r.sharePercent])).toEqual([
			['p_a', 0, 18_250_000, 50],
			['p_r', 12_000_000, 9_100_000, 24.93],
			['p_old', 6_000_000, 9_150_000, 25.07],
		]);
		expect(result.problems).toEqual([]);
	});

	it('shares the whole profit in the ratio alone, with no charges, limit or TDS (a share is exempt under s.10(2A))', () => {
		const result = shareProfit({ ...year, method: 'ratio_only', profitPaise: 180_000_000, book: book(), capital });
		expect(result).toMatchObject({
			chargesApplied: false,
			bookProfitPaise: null,
			remunerationLimitPaise: null,
			remunerationDisallowedPaise: 0,
			interestDisallowedPaise: 0,
		});
		expect(result.rows.map((r) => [r.interestPaise, r.remunerationPaise, r.sharePaise, r.tdsPaise])).toEqual([
			[0, 0, 108_000_000, 0],
			[0, 0, 72_000_000, 0],
		]);
		const { lines } = profitPlanLines({
			choice: { option: 'ratio_only', reserveBasis: 'percent', reserveValue: 0 },
			profitByLocation: { loc_ho: 180_000_000 },
			ownersLocationId: 'loc_ho',
			drawingsByLocation: {},
			share: result,
			partnersCapital: 'fixed_with_current',
		});
		expect(lines.map((l) => [l.role, l.debitPaise, l.creditPaise])).toEqual([
			['partners_profit_share', 108_000_000, 0],
			['partner_current_p_a', 0, 108_000_000],
			['partners_profit_share', 72_000_000, 0],
			['partner_current_p_r', 0, 72_000_000],
		]);
	});

	it('lists partners whose shares are all nought at 0%, and names the problem', () => {
		const result = shareProfit({
			...year,
			method: 'ratio_only',
			profitPaise: 100,
			book: book({ partners: [term('p_a', 'Arindam', 0, 0), term('p_r', 'Rupa', 0, 0)] }),
			capital,
		});
		expect(result.rows.map((r) => [r.sharePercent, r.sharePaise])).toEqual([
			[0, 0],
			[0, 0],
		]);
		expect(result.problems).toEqual(['partner_shares_total_100', 'partners_missing']);
	});
});

describe('the profit voucher and its ledgers', () => {
	const yc3 = shareProfit({ ...year, method: 'deed', profitPaise: 180_000_000, book: book(), capital });

	it('credits each partner’s capital account when capital is fluctuating', () => {
		const { lines } = profitPlanLines({
			choice: { option: 'deed', reserveBasis: 'percent', reserveValue: 0 },
			profitByLocation: { loc_ho: 180_000_000 },
			ownersLocationId: 'loc_ho',
			drawingsByLocation: {},
			share: yc3,
			partnersCapital: 'fluctuating',
		});
		expect(lines.filter((l) => l.role === 'partner_capital_p_a').map((l) => [l.debitPaise, l.creditPaise])).toEqual(
			[
				[0, 109_200_000],
				[8_400_000, 0],
			],
		);
		expect(lines.some((l) => l.role.startsWith('partner_current_'))).toBe(false);
		expect(lines.every((l) => l.locationId === 'loc_ho')).toBe(true);
	});

	it('takes a proprietor’s loss off capital', () => {
		const { lines, drawingsPaise } = profitPlanLines({
			choice: { option: 'to_capital', reserveBasis: 'percent', reserveValue: 0 },
			profitByLocation: { loc_ho: -50_000 },
			ownersLocationId: 'loc_ho',
			drawingsByLocation: { loc_ho: 0 },
			share: null,
			partnersCapital: 'fixed_with_current',
		});
		expect(drawingsPaise).toBe(0);
		expect(lines.map((l) => [l.role, l.debitPaise, l.creditPaise])).toEqual([
			['profit_and_loss', 0, 50_000],
			['capital', 50_000, 0],
		]);
	});

	it('puts nothing to reserve from a loss by %', () => {
		const { lines, reservePaise } = profitPlanLines({
			choice: { option: 'to_general_reserve', reserveBasis: 'percent', reserveValue: 10 },
			profitByLocation: { loc_ho: -2_000_000 },
			ownersLocationId: 'loc_ho',
			drawingsByLocation: {},
			share: null,
			partnersCapital: 'fixed_with_current',
		});
		expect([lines, reservePaise]).toEqual([[], 0]);
	});

	it('names a partner’s accounts from the id, safe and at most 60 characters', () => {
		expect(partnerRole('current', 'P-A.1')).toBe('partner_current_p_a_1');
		expect(partnerRole('capital', 'x'.repeat(80))).toBe(`partner_capital_${'x'.repeat(44)}`);
	});

	it('makes the sharing ledgers under appropriation, TDS under duties and taxes, the reserve under reserves', () => {
		expect(Object.fromEntries(Object.entries(PROFIT_LEDGERS).map(([key, l]) => [key, l.groupKey]))).toEqual({
			interest_on_partners_capital: 'appropriation',
			partners_remuneration: 'appropriation',
			partners_profit_share: 'appropriation',
			tds_payable_partners: 'duties_and_taxes',
			general_reserve: 'reserves_and_surplus',
		});
		expect(PARTNER_TDS_LIMIT_PAISE).toBe(2_000_000);
	});

	it('finds the appropriation ledgers by system key or role, however deep, and none in a group that is gone', () => {
		const chart = {
			groups: [
				{ id: 'g_app', parentId: null, systemKey: 'appropriation' },
				{ id: 'g_deep', parentId: 'g_mid', systemKey: null },
				{ id: 'g_mid', parentId: 'g_app' },
				{ id: 'g_role', parentId: null, roles: ['appropriation'] },
				{ id: 'g_other', parentId: null, roles: ['sales'] },
				{ id: 'g_orphan', parentId: 'g_gone' },
			],
			ledgers: [
				{ id: 'interest', groupId: 'g_app' },
				{ id: 'share', groupId: 'g_deep' },
				{ id: 'remuneration', groupId: 'g_role' },
				{ id: 'sales', groupId: 'g_other' },
				{ id: 'stray', groupId: 'g_orphan' },
				{ id: 'lost', groupId: 'g_gone' },
			],
		};
		expect([...appropriationLedgerIds(chart)]).toEqual(['interest', 'share', 'remuneration']);
	});
});

describe('choices and splits at their edges', () => {
	it('offers each kind of business its own choices, keep first', () => {
		expect(PROFIT_CHOICES).toEqual({
			proprietorship: ['keep', 'to_capital', 'to_capital_keep_drawings'],
			partnership: ['keep', 'deed', 'ratio_only'],
			llp: ['keep', 'deed', 'ratio_only'],
			private_limited_opc: ['keep', 'to_general_reserve'],
			private_limited: ['keep', 'to_general_reserve'],
		});
		expect(defaultProfitChoice('private_limited_opc', false)).toEqual({
			option: 'keep',
			reserveBasis: 'percent',
			reserveValue: 0,
		});
		expect(defaultProfitChoice('proprietorship', true).option).toBe('keep');
	});

	it('takes the default when nothing was saved, keeping today’s behaviour once a year was closed', () => {
		expect(profitChoiceFor('llp', null, false).option).toBe('deed');
		expect(profitChoiceFor('llp', null, true).option).toBe('keep');
		const ratio = { option: 'ratio_only' as const, reserveBasis: 'percent' as const, reserveValue: 0 };
		expect(profitChoiceFor('partnership', ratio, true)).toBe(ratio);
	});

	it('gives a paisa to the first of equal shares and never writes minus nought', () => {
		expect(splitByWeights(1, [1, 1])).toEqual([1, 0]);
		const loss = splitByWeights(-1, [1, 1]);
		expect(loss).toEqual([-1, 0]);
		expect(Object.is(loss[1], 0)).toBe(true);
		expect(splitByWeights(10, [0.6, 0.4])).toEqual([6, 4]);
	});

	it('limits remuneration at 90% of the first ₹6,00,000 and 60% of the rest, never below ₹3,00,000', () => {
		expect(remunerationLimitPaise(0)).toBe(30_000_000);
		expect(remunerationLimitPaise(30_000_000)).toBe(30_000_000);
		expect(remunerationLimitPaise(60_000_000)).toBe(54_000_000);
		expect(remunerationLimitPaise(100_000_000)).toBe(78_000_000);
		expect(partnerTdsPaise(0)).toBe(0);
		expect(partnerTdsPaise(2_000_001)).toBe(200_000);
		expect(partnerTdsPaise(12_345_678)).toBe(1_234_600);
	});
});

describe('deeds in order on the company profile (YC2)', () => {
	const partner = (id: string) => ({
		id,
		name: id,
		pan: 'ABCPS1234D',
		working: true,
		capitalINR: 0,
		profitSharePercent: 50,
		interestOnCapitalPercent: 0,
		monthlyRemunerationINR: 0,
		remunerationBasis: 'monthly' as const,
		remunerationPercent: 0,
		designated: true,
		dpin: null,
	});
	const deed = { interestBasis: 'daily' as const, lossYearCharges: false, partners: [] };
	const firm: CompanyProfile = {
		kind: 'partnership',
		legalName: 'Saha Textile',
		tradeName: '',
		pan: null,
		tan: null,
		cin: null,
		llpin: 'AAA-0000',
		udyam: null,
		financialYearStartMonth: 4,
		booksStartOn: null,
		homeCurrency: 'INR',
		proprietor: null,
		otherBusinesses: [],
		partners: [partner('a'), partner('b')],
		partnersCapital: 'fixed_with_current',
		deedFrom: '2026-04-01',
		interestBasis: 'daily',
		lossYearCharges: false,
		earlierDeeds: [{ ...deed, from: '2025-04-01', to: '2024-03-31' }],
		directors: [],
		shareholders: [],
		authorisedCapitalINR: 0,
		paidUpCapitalINR: 0,
		faceValueINR: 10,
		nomineeName: null,
		revision: 0,
		updatedAt: null,
		updatedBy: null,
	};

	it('names deed dates out of order for a firm or an LLP, never for a company', () => {
		expect(companyProblems(firm)).toEqual(['deed_dates_out_of_order']);
		expect(companyProblems({ ...firm, kind: 'llp' })).toEqual(['deed_dates_out_of_order']);
		expect(companyProblems({ ...firm, earlierDeeds: [] })).toEqual([]);
		expect(companyProblems({ ...firm, kind: 'private_limited', cin: 'U17100WB2020PTC123456' })).not.toContain(
			'deed_dates_out_of_order',
		);
	});

	it('wants every deed after the first to start on its own date, after the one before ended', () => {
		const earlierDeeds = [
			{ ...deed, from: null, to: '2025-03-31' },
			{ ...deed, from: null, to: '2026-03-31' },
		];
		expect(deedsInOrder({ deedFrom: '2026-04-01', earlierDeeds })).toBe(false);
		expect(
			deedsInOrder({
				deedFrom: '2026-04-01',
				earlierDeeds: [
					earlierDeeds[0] as (typeof earlierDeeds)[number],
					{ ...deed, from: '2025-03-31', to: '2026-03-31' },
				],
			}),
		).toBe(false);
		expect(
			deedsInOrder({ deedFrom: '2026-03-31', earlierDeeds: [earlierDeeds[0] as (typeof earlierDeeds)[number]] }),
		).toBe(true);
		expect(
			deedsInOrder({ deedFrom: '2025-03-31', earlierDeeds: [earlierDeeds[0] as (typeof earlierDeeds)[number]] }),
		).toBe(false);
	});
});

describe('the year’s profit and figures at their edges', () => {
	const chart = {
		groups: [
			{ id: 'g_inc', parentId: null, nature: 'income' },
			{ id: 'g_exp', parentId: null, nature: 'expense' },
			{ id: 'g_app', parentId: null, nature: 'expense', roles: ['appropriation'] },
			{ id: 'g_cap', parentId: null, nature: 'equity' },
		],
		ledgers: [
			{ id: 'sales', groupId: 'g_inc' },
			{ id: 'rent', groupId: 'g_exp' },
			{ id: 'interest', groupId: 'g_app' },
			{ id: 'pl', groupId: 'g_cap' },
		],
	};

	it('reads a location’s loss as negative, and leaves out a location that broke even', () => {
		const byLocation = {
			loc_ho: { closing: { sales: -1_000, rent: 400, interest: 300 }, opening: {} },
			loc_br: { closing: { sales: -200, rent: 700 }, opening: {} },
			loc_new: { closing: { sales: -500, rent: 500 }, opening: {} },
		};
		expect(profitByLocation(chart, byLocation, 'pl')).toEqual({ loc_ho: 600, loc_br: -500 });
	});

	it('finds the profit and loss account by role, and shows a nominal ledger that never moved at nought', () => {
		const ledgers = [
			{ id: 'sales', nature: 'income', systemKey: null },
			{ id: 'rent', nature: 'expense', systemKey: null },
			{ id: 'pl', nature: 'equity', systemKey: null, roles: ['profit_and_loss'] },
		];
		expect(yearFigures(ledgers, { sales: -900 }, { sales: -600 })).toEqual({ sales: -300, rent: 0, pl: -600 });
		expect(withProfitCarried(ledgers, { sales: -900 }, {})).toEqual({ sales: -900 });
	});
});
