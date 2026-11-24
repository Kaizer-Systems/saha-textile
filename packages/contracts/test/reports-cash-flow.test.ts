import { describe, expect, it } from 'vitest';

import { CashFlow, PeriodQuery, Ratios } from '../src/reports';

/** Cash flow by the indirect method and the ratios (accounts brief U1): what the screens ask for and get. */

const refused = (input: unknown) => expect(input).toBe(false);

describe('a period', () => {
	it('runs from one day to another, both as YYYY-MM-DD', () => {
		expect(PeriodQuery.parse({ from: '2026-04-01', to: '2027-03-31' })).toEqual({
			from: '2026-04-01',
			to: '2027-03-31',
		});
		refused(PeriodQuery.safeParse({ from: '2026-04-01' }).success);
		refused(PeriodQuery.safeParse({ from: '1 Apr 2026', to: '2027-03-31' }).success);
	});
});

describe('the cash flow statement', () => {
	const flow = {
		from: '2026-04-01',
		to: '2027-03-31',
		lines: [
			{ section: 'operating', key: 'profit', paise: 320_000 },
			{ section: 'investing', key: 'fixed_assets', paise: -300_000 },
			{ section: 'financing', key: 'secured_loans', paise: 250_000 },
		],
		sections: { operating: 205_000, investing: -300_000, financing: 300_000 },
		netChange: 205_000,
		openingCash: 500_000,
		closingCash: 705_000,
	};

	it('gives its lines by section, the sections, the change and the cash at both ends, in whole paise', () => {
		expect(CashFlow.parse(flow)).toEqual(flow);
	});

	it('refuses a line outside the three sections, part of a paisa, or a missing section', () => {
		refused(CashFlow.safeParse({ ...flow, lines: [{ section: 'tax', key: 'gst', paise: 0 }] }).success);
		refused(CashFlow.safeParse({ ...flow, netChange: 0.5 }).success);
		refused(CashFlow.safeParse({ ...flow, sections: { operating: 0, investing: 0 } }).success);
		refused(CashFlow.safeParse({ ...flow, closingCash: undefined }).success);
	});
});

describe('the ratios', () => {
	it('gives each ratio by name, empty where it can’t be worked out', () => {
		const values = { currentRatio: 3.33, debtorDays: 109.5, debtEquity: null };
		expect(Ratios.parse({ from: '2026-04-01', to: '2027-03-31', values })).toEqual({
			from: '2026-04-01',
			to: '2027-03-31',
			values,
		});
		refused(Ratios.safeParse({ from: '2026-04-01', to: '2027-03-31', values: { currentRatio: '3.33' } }).success);
		refused(Ratios.safeParse({ from: '2026-04-01', values }).success);
	});
});
