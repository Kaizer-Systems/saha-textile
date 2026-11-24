import { describe, expect, it } from 'vitest';

import { publishProblems, ruleSetProblems } from '../src/templates/rules';
import { starterTemplates } from '../src/templates/starter';
import { DUE_DATES } from '../src/templates/starter-packs';

import type { AccountsTemplate, TaxRuleEntry, TaxRuleList, TaxRuleSetContent } from '@saha-textile/contracts';

/** The due-date rule set RS-DUE (accounts brief G3) in the template library, and its publishing checks (AT5). */

const now = '2026-11-24T08:00:00.000Z';
const library = starterTemplates(now);
const byCode = (code: string) => library.find((t) => t.code === code) as AccountsTemplate;
const due = byCode('RS-DUE');

const entry = (key: string, over: Partial<TaxRuleEntry> = {}): TaxRuleEntry => ({
	key,
	name: key,
	code: '',
	ratePercent: 0,
	expenseRole: null,
	kinds: null,
	from: '2017-07-01',
	to: null,
	source: 'CBIC notification',
	caReview: 'pending',
	limitINR: null,
	limitPer: null,
	due: null,
	...over,
});
const dueOn = {
	returnType: 'GSTR-3B' as const,
	scheme: null,
	day: 27,
	monthsAfter: 1,
	states: ['19'],
	period: '2026-12',
};
const set = (list: TaxRuleList, ...entries: TaxRuleEntry[]): TaxRuleSetContent => ({ kind: 'taxRules', list, entries });

describe('the due-date rule set in the library', () => {
	it('opens with the GST return due dates for every kind of company, from July 2017, to be confirmed by the CA', () => {
		expect(due).toMatchObject({
			kind: 'taxRules',
			name: 'GST return due dates',
			appliesTo: { all: true, kinds: [] },
			draft: null,
		});
		expect(due.versions).toHaveLength(1);
		expect(due.versions[0]).toMatchObject({
			version: 1,
			validFrom: '2017-07-01',
			validTo: null,
			caReview: 'pending',
			content: DUE_DATES,
		});
		expect(due.versions[0]?.source).toContain('to be confirmed by the CA');
	});

	it('publishes as it stands, and with a month’s extension added', () => {
		expect(ruleSetProblems(due, DUE_DATES, library)).toEqual([]);
		const extended = { ...DUE_DATES, entries: [...DUE_DATES.entries, entry('ext_2026_12_wb', { due: dueOn })] };
		expect(ruleSetProblems(due, extended, library)).toEqual([]);
	});
});

describe('the publishing checks for due dates', () => {
	it('refuses a due-date entry without its due date', () => {
		expect(ruleSetProblems(due, set('dueDates', entry('ext_2026_12_wb')), library)).toEqual([
			'template_entry_due:ext_2026_12_wb',
		]);
	});

	it('refuses a due date in any other list', () => {
		for (const list of ['reverseCharge', 'tds', 'limits'] as const)
			expect(
				ruleSetProblems(
					due,
					set(list, entry('stray', { due: dueOn, limitINR: 1_000, limitPer: 'year' })),
					library,
				),
			).toEqual(['template_entry_due:stray']);
	});

	it('asks an amount only of TDS sections and limits, never of due dates or the reverse-charge list', () => {
		expect(ruleSetProblems(due, set('dueDates', entry('a', { due: dueOn })), library)).toEqual([]);
		expect(ruleSetProblems(due, set('reverseCharge', entry('b')), library)).toEqual([]);
		expect(ruleSetProblems(due, set('tds', entry('c')), library)).toEqual(['template_entry_limit:c']);
		expect(ruleSetProblems(due, set('limits', entry('d')), library)).toEqual(['template_entry_limit:d']);
	});

	it('stops a draft of the due dates that lost an entry’s due date from publishing', () => {
		const broken = {
			...DUE_DATES,
			entries: DUE_DATES.entries.map((e) => (e.key === 'gstr9_annual' ? { ...e, due: null } : e)),
		};
		const draft: AccountsTemplate = {
			...due,
			draft: { content: broken, validFrom: '2027-04-01', source: 'CA', notes: '', savedAt: now, savedBy: null },
		};
		expect(publishProblems(draft, library)).toContain('template_entry_due:gstr9_annual');
	});
});
