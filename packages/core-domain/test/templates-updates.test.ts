import { describe, expect, it } from 'vitest';

import { chartInstallPlan, keptChanges, reportChanges, versionChanges } from '../src/templates/update-rules';

import type {
	AccountGroup,
	ChartTemplateContent,
	Ledger,
	ReportLine,
	ReportTemplateContent,
	TaxRuleSetContent,
} from '@saha-textile/contracts';

/** Template updates (accounts templates plan AT7): what a newer version changes, what is kept, what Install adds. */

const line = (key: string, over: Partial<ReportLine> = {}): ReportLine => ({
	key,
	label: key,
	parentKey: null,
	sources: [],
	...over,
});
const report = (lines: ReportLine[]): ReportTemplateContent => ({
	kind: 'report',
	columns: 'thisAndLast',
	notes: false,
	level: null,
	lines,
});
const group = (key: string, name = key) => ({
	key,
	name,
	parentKey: null,
	nature: 'expense' as const,
	tradingAccount: false,
	roles: [],
});
const tledger = (key: string, name = key, roles: string[] = []) => ({
	key,
	name,
	groupKey: 'indirect_expenses',
	handPosting: true,
	roles,
	ruleSetCode: null,
	source: '',
});
const chart = (
	ledgers = [tledger('rent', 'Rent')],
	groups = [group('indirect_expenses', 'Indirect expenses')],
): ChartTemplateContent => ({
	kind: 'chart',
	groups,
	ledgers,
});
const rules = (entries: Partial<TaxRuleSetContent['entries'][number]>[]): TaxRuleSetContent =>
	({ kind: 'taxRules', entries }) as TaxRuleSetContent;
const bookGroup = (systemKey: string, name: string) =>
	({
		id: `grp_${systemKey}`,
		systemKey,
		name,
		parentId: null,
		nature: 'expense',
		roles: [],
	}) as unknown as AccountGroup;
const bookLedger = (systemKey: string | null, name: string, roles: string[] = []) =>
	({
		id: `led_${systemKey ?? name}`,
		systemKey,
		name,
		groupId: 'grp_indirect_expenses',
		nature: 'expense',
		roles,
	}) as unknown as Ledger;

describe('what a newer version changes (AT7)', () => {
	it('lists a report’s lines added, removed, renamed and moved or re-sourced', () => {
		const before = report([line('a'), line('b'), line('c')]);
		const after = report([
			line('a', { label: 'Assets' }),
			line('b', { parentKey: 'a' }),
			line('d', { sources: [{ kind: 'role', key: 'cash' }] }),
		]);
		expect(reportChanges(before, after)).toEqual({
			added: ['d'],
			removed: ['c'],
			renamed: ['Assets'],
			changed: ['b'],
		});
		expect(reportChanges(null, after).added).toEqual(['Assets', 'b', 'd']);
	});

	it('compares like with like, whatever the template holds', () => {
		expect(versionChanges(chart([]), chart()).added).toEqual(['Rent']);
		expect(versionChanges(null, chart()).added).toEqual(['Indirect expenses', 'Rent']);
		expect(versionChanges(rules([]), chart()).added).toEqual(['Indirect expenses', 'Rent']);
		const entry = { key: 'rent', name: 'Rent', expenseRole: 'rent' };
		expect(versionChanges(rules([]), rules([entry])).added).toEqual(['Rent']);
		expect(versionChanges(chart(), rules([entry])).added).toEqual(['Rent']);
		expect(versionChanges(report([]), report([line('x')])).added).toEqual(['x']);
		expect(versionChanges(chart(), report([line('x')])).added).toEqual(['x']);
	});
});

describe('the company’s own changes, kept (AT7)', () => {
	const books = {
		groups: [bookGroup('indirect_expenses', 'Overheads')],
		ledgers: [
			bookLedger('rent', 'Rent', ['none']),
			bookLedger(null, 'Shop rent (Barasat)', ['rent']),
			bookLedger(null, 'Advocate (Kolkata)', ['legal_fees']),
			bookLedger('freight_inward', 'Freight inward'),
		],
	};

	it('names a renamed group and a role given to the company’s own ledger', () => {
		const content = chart(
			[
				tledger('rent', 'Rent'),
				tledger('freight_inward', 'Freight inward'),
				tledger('security_services', 'Security'),
			],
			[group('indirect_expenses', 'Indirect expenses'), group('direct_expenses', 'Direct expenses')],
		);
		expect(keptChanges(content, books, content)).toEqual([
			{ kind: 'name', label: 'Indirect expenses', ours: 'Overheads', theirs: 'Indirect expenses' },
			{ kind: 'role', label: 'Rent', ours: 'Shop rent (Barasat)', theirs: 'Rent' },
		]);
	});

	it('names each rule set entry whose expense goes to the company’s own ledger', () => {
		const content = rules([
			{ key: 'shop_rent', name: 'Shop rent', expenseRole: 'rent' },
			{ key: 'advocate', name: "Advocate's fees", expenseRole: 'legal_fees' },
			{ key: 'gta', name: 'Goods transport', expenseRole: 'freight_inward' },
			{ key: 'tds', name: 'A limit', expenseRole: null },
		]);
		expect(keptChanges(content, books, chart())).toEqual([
			{ kind: 'role', label: 'Shop rent', ours: 'Shop rent (Barasat)', theirs: 'Rent' },
			{ kind: 'role', label: "Advocate's fees", ours: 'Advocate (Kolkata)', theirs: 'legal_fees' },
		]);
		expect(keptChanges(report([line('x')]), books, chart())).toEqual([]);
	});
});

describe('what Install adds to the books (AT7)', () => {
	it('adds only groups and ledgers the books lack, and never a role someone already plays', () => {
		const books = {
			groups: [bookGroup('indirect_expenses', 'Overheads')],
			ledgers: [bookLedger(null, 'Shop rent (Barasat)', ['rent']), bookLedger('freight_inward', 'Freight')],
		};
		const content = chart(
			[
				tledger('freight_inward', 'Freight inward'),
				tledger('rent', 'Rent'),
				tledger('legal_fees', 'Legal fees'),
				tledger('agency', 'Agency', ['rent', 'commission']),
			],
			[group('indirect_expenses'), group('direct_expenses')],
		);
		const plan = chartInstallPlan(content, books);
		expect(plan.groups.map((g) => g.key)).toEqual(['direct_expenses']);
		expect(plan.ledgers.map((l) => [l.key, l.roles])).toEqual([
			['rent', ['none']],
			['legal_fees', []],
			['agency', ['commission']],
		]);
	});
});
