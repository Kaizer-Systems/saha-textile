import { describe, expect, it } from 'vitest';

import { dueFromRules, financialYear } from '../src/gst/gst-calendar';
import { DUE_DATES, QRMP_22ND_STATES } from '../src/templates/starter-packs';

import type { TaxRuleEntry } from '@saha-textile/contracts';

/**
 * When GST returns fall due (accounts brief G3), read from the due-date rule set RS-DUE, and the starter set checked
 * against the law: GSTR-1 by the 11th (monthly) or the 13th after the quarter (QRMP, from January 2021); GSTR-3B by
 * the 20th (monthly) or, under QRMP, the 22nd or 24th by State (rule 61(5) read with Notification 01/2020-CT and the
 * QRMP amendments); GSTR-9 by 31 December after the financial year (s.44, rule 80).
 */

/** QRMP GSTR-3B on the 22nd: Chhattisgarh, Madhya Pradesh, Gujarat, Dadra and Nagar Haveli and Daman and Diu,
 * Maharashtra, Karnataka, Goa, Lakshadweep, Kerala, Tamil Nadu, Puducherry, Andaman and Nicobar Islands, Telangana,
 * Andhra Pradesh. */
const ON_22ND = ['22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37'];
/** On the 24th: Jammu and Kashmir, Himachal Pradesh, Punjab, Chandigarh, Uttarakhand, Haryana, Delhi, Rajasthan,
 * Uttar Pradesh, Bihar, Sikkim, Arunachal Pradesh, Nagaland, Manipur, Mizoram, Tripura, Meghalaya, Assam,
 * West Bengal, Jharkhand, Odisha, Ladakh. */
const ON_24TH = [
	'01',
	'02',
	'03',
	'04',
	'05',
	'06',
	'07',
	'08',
	'09',
	'10',
	'11',
	'12',
	'13',
	'14',
	'15',
	'16',
	'17',
	'18',
	'19',
	'20',
	'21',
	'38',
];

const RULES = DUE_DATES.entries;
const WEST_BENGAL = '19';
const MAHARASHTRA = '27';

/** A due-date entry as the CA adds one: a standing rule, or with `period` an extension for that month. */
const rule = (
	key: string,
	due: Partial<NonNullable<TaxRuleEntry['due']>> & Pick<NonNullable<TaxRuleEntry['due']>, 'returnType' | 'day'>,
	from = '2017-07-01',
	to: string | null = null,
): TaxRuleEntry => ({
	key,
	name: key,
	code: '',
	ratePercent: 0,
	expenseRole: null,
	kinds: null,
	from,
	to,
	source: 'CBIC notification',
	caReview: 'pending',
	limitINR: null,
	limitPer: null,
	due: { scheme: null, monthsAfter: 1, states: [], period: null, ...due },
});

describe('the starter due-date rule set, checked against the law', () => {
	it('holds six standing rules, each with its due date and source', () => {
		expect(DUE_DATES.list).toBe('dueDates');
		expect(RULES.map((e) => e.key)).toEqual([
			'gstr1_monthly',
			'gstr1_qrmp',
			'gstr3b_monthly',
			'gstr3b_qrmp_22',
			'gstr3b_qrmp_24',
			'gstr9_annual',
		]);
		for (const entry of RULES) {
			expect(entry.due?.period).toBeNull();
			expect(entry.source).not.toBe('');
			expect(entry.caReview).toBe('pending');
		}
	});

	it('lists the fourteen States and territories Notification 01/2020-CT puts on the 22nd', () => {
		expect([...QRMP_22ND_STATES].sort()).toEqual(ON_22ND);
	});
});

describe('monthly returns', () => {
	it('falls GSTR-1 due on the 11th and GSTR-3B on the 20th of the next month', () => {
		expect(dueFromRules(RULES, 'GSTR-1', '2026-11', 'monthly', WEST_BENGAL)).toBe('2026-12-11');
		expect(dueFromRules(RULES, 'GSTR-3B', '2026-11', 'monthly', WEST_BENGAL)).toBe('2026-12-20');
	});

	it('runs December into January of the next year, and writes every month with two digits', () => {
		expect(dueFromRules(RULES, 'GSTR-1', '2026-12', 'monthly', WEST_BENGAL)).toBe('2027-01-11');
		expect(dueFromRules(RULES, 'GSTR-3B', '2026-12', 'monthly', MAHARASHTRA)).toBe('2027-01-20');
		expect(dueFromRules(RULES, 'GSTR-1', '2026-01', 'monthly', WEST_BENGAL)).toBe('2026-02-11');
		expect(dueFromRules(RULES, 'GSTR-3B', '2026-09', 'monthly', WEST_BENGAL)).toBe('2026-10-20');
	});

	it('is the same for every State', () => {
		for (const state of [...ON_22ND, ...ON_24TH]) {
			expect(dueFromRules(RULES, 'GSTR-1', '2026-03', 'monthly', state)).toBe('2026-04-11');
			expect(dueFromRules(RULES, 'GSTR-3B', '2026-02', 'monthly', state)).toBe('2026-03-20');
		}
	});
});

describe('quarterly returns under QRMP', () => {
	it('has no return in the first two months of a quarter', () => {
		for (const month of ['2026-01', '2026-02', '2026-04', '2026-05', '2026-07', '2026-08', '2026-10', '2026-11']) {
			expect(dueFromRules(RULES, 'GSTR-1', month, 'qrmp', WEST_BENGAL)).toBeNull();
			expect(dueFromRules(RULES, 'GSTR-3B', month, 'qrmp', MAHARASHTRA)).toBeNull();
		}
	});

	it('falls GSTR-1 due on the 13th after each quarter, the December quarter in January', () => {
		expect(dueFromRules(RULES, 'GSTR-1', '2026-03', 'qrmp', WEST_BENGAL)).toBe('2026-04-13');
		expect(dueFromRules(RULES, 'GSTR-1', '2026-06', 'qrmp', WEST_BENGAL)).toBe('2026-07-13');
		expect(dueFromRules(RULES, 'GSTR-1', '2026-09', 'qrmp', MAHARASHTRA)).toBe('2026-10-13');
		expect(dueFromRules(RULES, 'GSTR-1', '2026-12', 'qrmp', MAHARASHTRA)).toBe('2027-01-13');
	});

	it('falls GSTR-3B due on the 22nd in the fourteen States and territories the notification names', () => {
		for (const state of ON_22ND)
			expect(dueFromRules(RULES, 'GSTR-3B', '2026-09', 'qrmp', state)).toBe('2026-10-22');
	});

	it('falls GSTR-3B due on the 24th everywhere else, West Bengal included', () => {
		expect(dueFromRules(RULES, 'GSTR-3B', '2026-12', 'qrmp', WEST_BENGAL)).toBe('2027-01-24');
		for (const state of ON_24TH)
			expect(dueFromRules(RULES, 'GSTR-3B', '2026-06', 'qrmp', state)).toBe('2026-07-24');
	});

	it('has no QRMP due date before QRMP began in January 2021, while monthly filing went on', () => {
		expect(dueFromRules(RULES, 'GSTR-1', '2020-12', 'qrmp', WEST_BENGAL)).toBeNull();
		expect(dueFromRules(RULES, 'GSTR-3B', '2020-12', 'qrmp', MAHARASHTRA)).toBeNull();
		expect(dueFromRules(RULES, 'GSTR-1', '2021-03', 'qrmp', WEST_BENGAL)).toBe('2021-04-13');
		expect(dueFromRules(RULES, 'GSTR-3B', '2020-12', 'monthly', WEST_BENGAL)).toBe('2021-01-20');
	});
});

describe('the annual return', () => {
	it('names the financial year a month falls in, April to March, and its last month', () => {
		expect(financialYear('2026-02')).toEqual({ label: '2025-26', lastMonth: '2026-03' });
		expect(financialYear('2026-03')).toEqual({ label: '2025-26', lastMonth: '2026-03' });
		expect(financialYear('2026-04')).toEqual({ label: '2026-27', lastMonth: '2027-03' });
		expect(financialYear('2026-12')).toEqual({ label: '2026-27', lastMonth: '2027-03' });
	});

	it('writes the year across a century as the law does, 1999-00', () => {
		expect(financialYear('2000-01')).toEqual({ label: '1999-00', lastMonth: '2000-03' });
		expect(financialYear('2099-04')).toEqual({ label: '2099-00', lastMonth: '2100-03' });
	});

	it('falls GSTR-9 due on 31 December after the year, under either scheme and in every State', () => {
		for (const month of ['2026-04', '2026-12', '2027-03']) {
			const year = financialYear(month);
			expect(dueFromRules(RULES, 'GSTR-9', year.lastMonth, 'monthly', WEST_BENGAL)).toBe('2027-12-31');
			expect(dueFromRules(RULES, 'GSTR-9', year.lastMonth, 'qrmp', MAHARASHTRA)).toBe('2027-12-31');
		}
	});
});

describe('extensions and changed rules', () => {
	const westBengalDecember = rule(
		'ext_gstr3b_2026_12_wb',
		{ returnType: 'GSTR-3B', scheme: 'monthly', day: 27, states: [WEST_BENGAL], period: '2026-12' },
		'2026-12-01',
	);

	it('moves one State’s return for one month, the other States and months keep the rule', () => {
		const rules = [...RULES, westBengalDecember];
		expect(dueFromRules(rules, 'GSTR-3B', '2026-12', 'monthly', WEST_BENGAL)).toBe('2027-01-27');
		expect(dueFromRules(rules, 'GSTR-3B', '2026-12', 'monthly', MAHARASHTRA)).toBe('2027-01-20');
		expect(dueFromRules(rules, 'GSTR-3B', '2026-11', 'monthly', WEST_BENGAL)).toBe('2026-12-20');
		expect(dueFromRules(rules, 'GSTR-1', '2026-12', 'monthly', WEST_BENGAL)).toBe('2027-01-11');
		expect(dueFromRules(rules, 'GSTR-3B', '2026-12', 'qrmp', WEST_BENGAL)).toBe('2027-01-24');
	});

	it('takes the latest of two extensions for the same month', () => {
		const further = rule(
			'ext_gstr3b_2026_12_wb_again',
			{ returnType: 'GSTR-3B', day: 31, states: [WEST_BENGAL], period: '2026-12' },
			'2026-12-01',
		);
		const first = { ...westBengalDecember, from: '2026-11-15' };
		expect(dueFromRules([...RULES, further, first], 'GSTR-3B', '2026-12', 'monthly', WEST_BENGAL)).toBe(
			'2027-01-31',
		);
	});

	it('applies an extension for every State and scheme to both, but never makes a QRMP return in a quarter’s first months', () => {
		const everyone = rule('ext_gstr1_2026_12', { returnType: 'GSTR-1', day: 20, period: '2026-12' }, '2026-12-01');
		expect(dueFromRules([...RULES, everyone], 'GSTR-1', '2026-12', 'monthly', MAHARASHTRA)).toBe('2027-01-20');
		expect(dueFromRules([...RULES, everyone], 'GSTR-1', '2026-12', 'qrmp', WEST_BENGAL)).toBe('2027-01-20');
		const november = rule('ext_gstr1_2026_11', { returnType: 'GSTR-1', day: 20, period: '2026-11' }, '2026-11-01');
		expect(dueFromRules([...RULES, november], 'GSTR-1', '2026-11', 'qrmp', WEST_BENGAL)).toBeNull();
	});

	it('prefers a State’s own standing rule to the general one, whatever their order or age', () => {
		const reversed = [...RULES].reverse();
		expect(dueFromRules(reversed, 'GSTR-3B', '2026-09', 'qrmp', MAHARASHTRA)).toBe('2026-10-22');
		const newerGeneral = rule('gstr3b_qrmp_23', { returnType: 'GSTR-3B', scheme: 'qrmp', day: 23 }, '2026-01-01');
		expect(dueFromRules([...RULES, newerGeneral], 'GSTR-3B', '2026-09', 'qrmp', MAHARASHTRA)).toBe('2026-10-22');
		expect(dueFromRules([...RULES, newerGeneral], 'GSTR-3B', '2026-09', 'qrmp', WEST_BENGAL)).toBe('2026-10-23');
	});

	it('follows a changed rule from the month it applies, the old rule for months before', () => {
		const changed = rule('gstr3b_monthly_21', { returnType: 'GSTR-3B', scheme: 'monthly', day: 21 }, '2027-04-01');
		expect(dueFromRules([...RULES, changed], 'GSTR-3B', '2027-03', 'monthly', WEST_BENGAL)).toBe('2027-04-20');
		expect(dueFromRules([...RULES, changed], 'GSTR-3B', '2027-04', 'monthly', WEST_BENGAL)).toBe('2027-05-21');
		const ended = RULES.map((e) => (e.key === 'gstr3b_monthly' ? { ...e, to: '2027-03-31' } : e));
		expect(dueFromRules(ended, 'GSTR-3B', '2027-03', 'monthly', WEST_BENGAL)).toBe('2027-04-20');
		expect(dueFromRules(ended, 'GSTR-3B', '2027-04', 'monthly', WEST_BENGAL)).toBeNull();
	});

	it('keeps a due day inside its month, 29 February in a leap year', () => {
		const lastDay = (key: string, period: string, monthsAfter: number) =>
			dueFromRules(
				[rule(key, { returnType: 'GSTR-3B', day: 31, monthsAfter, period })],
				'GSTR-3B',
				period,
				'monthly',
				WEST_BENGAL,
			);
		expect(lastDay('jan_2027', '2027-01', 1)).toBe('2027-02-28');
		expect(lastDay('jan_2028', '2028-01', 1)).toBe('2028-02-29');
		expect(lastDay('mar_2027', '2027-03', 1)).toBe('2027-04-30');
		expect(lastDay('may_2027', '2027-05', 12)).toBe('2028-05-31');
	});

	it('answers nothing without a rule for the return, and reads past entries that are not due dates', () => {
		expect(dueFromRules([], 'GSTR-1', '2026-11', 'monthly', WEST_BENGAL)).toBeNull();
		const reverseCharge = { ...rule('legal', { returnType: 'GSTR-1', day: 11 }), due: null };
		expect(dueFromRules([reverseCharge], 'GSTR-1', '2026-11', 'monthly', WEST_BENGAL)).toBeNull();
		const gstr1Only = RULES.filter((e) => e.due?.returnType === 'GSTR-1');
		expect(dueFromRules(gstr1Only, 'GSTR-9', '2026-03', 'monthly', WEST_BENGAL)).toBeNull();
	});
});

describe('an extension notified after the month it extends', () => {
	// CBIC extends September's GSTR-3B for West Bengal on 15 October, days before the 20th: entered with that date.
	const notifiedLate = rule(
		'ext_gstr3b_2026_09_wb',
		{ returnType: 'GSTR-3B', scheme: 'monthly', day: 27, states: [WEST_BENGAL], period: '2026-09' },
		'2026-10-15',
		'2026-10-31',
	);

	it('moves the month it names, whatever day it was notified or until', () => {
		expect(dueFromRules([...RULES, notifiedLate], 'GSTR-3B', '2026-09', 'monthly', WEST_BENGAL)).toBe('2026-10-27');
		expect(dueFromRules([...RULES, notifiedLate], 'GSTR-3B', '2026-09', 'monthly', MAHARASHTRA)).toBe('2026-10-20');
		expect(dueFromRules([...RULES, notifiedLate], 'GSTR-3B', '2026-10', 'monthly', WEST_BENGAL)).toBe('2026-11-20');
	});

	it('still needs a standing rule to be in force for the month', () => {
		const later = rule(
			'gstr3b_monthly_from_2027',
			{ returnType: 'GSTR-3B', scheme: 'monthly', day: 25 },
			'2027-01-01',
		);
		expect(dueFromRules([later], 'GSTR-3B', '2026-12', 'monthly', WEST_BENGAL)).toBeNull();
		expect(dueFromRules([later], 'GSTR-3B', '2027-01', 'monthly', WEST_BENGAL)).toBe('2027-02-25');
	});
});
