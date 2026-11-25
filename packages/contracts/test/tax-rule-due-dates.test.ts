import { describe, expect, it } from 'vitest';

import { TaxRuleEntry, TaxRuleList, TaxRuleSetContent } from '../src/accounts-templates';

/** GST return due dates as tax rules (RS-DUE, accounts brief G3): what an entry's due date takes and refuses. */

const entry = { key: 'gstr3b_monthly', name: 'GSTR-3B, monthly filers', ratePercent: 0, from: '2017-07-01' };
const due = { returnType: 'GSTR-3B', day: 20 };

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const withDue = (over: Record<string, unknown>) => TaxRuleEntry.safeParse({ ...entry, due: { ...due, ...over } });

describe('due dates in tax rules', () => {
	it('lists due dates beside the reverse-charge list, TDS sections and limits', () => {
		expect(TaxRuleList.options).toEqual(['reverseCharge', 'tds', 'limits', 'dueDates']);
		expect(TaxRuleSetContent.parse({ kind: 'taxRules', list: 'dueDates' })).toEqual({
			kind: 'taxRules',
			list: 'dueDates',
			entries: [],
		});
	});

	it('gives an entry of another list no due date', () => {
		expect(TaxRuleEntry.parse(entry).due).toBeNull();
		expect(TaxRuleEntry.parse({ ...entry, due: null }).due).toBeNull();
	});

	it('takes a standing rule for every scheme and State, due the month after', () => {
		expect(TaxRuleEntry.parse({ ...entry, due }).due).toEqual({
			returnType: 'GSTR-3B',
			scheme: null,
			day: 20,
			monthsAfter: 1,
			states: [],
			period: null,
		});
	});

	it('takes one State’s extension for one month, and GSTR-9 nine months after March', () => {
		const extension = { returnType: 'GSTR-3B', scheme: 'monthly', day: 27, states: ['19'], period: '2026-12' };
		expect(TaxRuleEntry.parse({ ...entry, due: extension }).due).toEqual({ ...extension, monthsAfter: 1 });
		const annual = { returnType: 'GSTR-9', scheme: null, day: 31, monthsAfter: 9 };
		expect(TaxRuleEntry.parse({ ...entry, due: annual }).due).toEqual({ ...annual, states: [], period: null });
		expect(TaxRuleEntry.parse({ ...entry, due: { ...due, scheme: 'qrmp' } }).due?.scheme).toBe('qrmp');
	});

	it('keeps the day from 1 to 31 and the months after from 1 to 12, whole', () => {
		accepted(withDue({ day: 1 }).success);
		accepted(withDue({ day: 31 }).success);
		refused(withDue({ day: 0 }).success);
		refused(withDue({ day: 32 }).success);
		refused(withDue({ day: 20.5 }).success);
		accepted(withDue({ monthsAfter: 12 }).success);
		refused(withDue({ monthsAfter: 0 }).success);
		refused(withDue({ monthsAfter: 13 }).success);
	});

	it('refuses another return or scheme, a State code that is not two digits, more than 40 States, or a month not YYYY-MM', () => {
		refused(withDue({ returnType: 'GSTR-2' }).success);
		refused(withDue({ scheme: 'quarterly' }).success);
		refused(withDue({ states: ['9'] }).success);
		refused(withDue({ states: ['WB'] }).success);
		accepted(withDue({ states: Array.from({ length: 40 }, (_, at) => String(at + 1).padStart(2, '0')) }).success);
		refused(withDue({ states: Array.from({ length: 41 }, (_, at) => String(at + 1).padStart(2, '0')) }).success);
		refused(withDue({ period: '2026-13' }).success);
		refused(withDue({ period: '2026-12-01' }).success);
		refused(TaxRuleEntry.safeParse({ ...entry, due: { day: 20 } }).success);
		refused(TaxRuleEntry.safeParse({ ...entry, due: { returnType: 'GSTR-1' } }).success);
	});
});
