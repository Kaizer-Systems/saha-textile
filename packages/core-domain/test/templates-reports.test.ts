import { describe, expect, it } from 'vitest';

import { reportOrder, reportProblems, reportRows, type ReportBooks } from '../src/templates/report-rules';
import { starterTemplates } from '../src/templates/starter';

import type {
	AccountGroup,
	AccountsTemplate,
	ChartTemplateContent,
	Ledger,
	ReportLine,
	ReportTemplateContent,
} from '@saha-textile/contracts';

/** Report templates (accounts templates plan AT6): the lines, the publishing checks and the preview figures. */

const now = '2026-11-24T08:00:00.000Z';
const library = starterTemplates(now);
const byCode = (code: string) => library.find((t) => t.code === code) as AccountsTemplate;
const common = (() => {
	const t = byCode('CH-COMMON');
	return t.versions[t.versions.length - 1]?.content as ChartTemplateContent;
})();
const line = (key: string, over: Partial<ReportLine> = {}): ReportLine => ({
	key,
	label: key,
	parentKey: null,
	sources: [],
	...over,
});
const report = (lines: ReportLine[], over: Partial<ReportTemplateContent> = {}): ReportTemplateContent => ({
	kind: 'report',
	columns: 'thisAndLast',
	notes: false,
	level: null,
	lines,
	...over,
});
const balanceSheet = { code: 'RP-TEST', appliesTo: { all: true, kinds: [] } };

describe('the lines of a report', () => {
	it('puts them in tree order, a line whose parent is missing at the top, leaving out loops and repeats', () => {
		const order = reportOrder([
			line('assets'),
			line('cash', { parentKey: 'assets' }),
			line('stray', { parentKey: 'gone' }),
			line('a', { parentKey: 'b' }),
			line('b', { parentKey: 'a' }),
			line('assets'),
		]);
		expect(order.map((row) => [row.line.key, row.depth])).toEqual([
			['assets', 0],
			['cash', 1],
			['stray', 0],
		]);
	});
});

describe('the publishing checks (AT6)', () => {
	it('passes lines whose sources every kind’s chart has', () => {
		const group = common.groups[0]?.key as string;
		const ledger = common.ledgers[0]?.key as string;
		const content = report([
			line('total'),
			line('cash', { parentKey: 'total', sources: [{ kind: 'role', key: 'cash' }] }),
			line('first', {
				parentKey: 'total',
				sources: [
					{ kind: 'group', key: group },
					{ kind: 'ledger', key: ledger },
				],
			}),
		]);
		expect(reportProblems(balanceSheet, content, library)).toEqual([]);
		expect(reportProblems(balanceSheet, report([line('heading')]), library)).toEqual([]);
	});

	it('names repeated keys, missing parents, loops and sources a kind’s chart lacks', () => {
		const content = report([
			line('x'),
			line('x'),
			line('y', { parentKey: 'nowhere' }),
			line('a', { parentKey: 'b' }),
			line('b', { parentKey: 'a' }),
			line('z', { sources: [{ kind: 'role', key: 'yacht_hire' }] }),
		]);
		const problems = reportProblems(
			{ code: 'RP-LLP', appliesTo: { all: false, kinds: ['llp'] } },
			content,
			library,
		);
		expect(problems).toEqual([
			'template_duplicate_key:x',
			'template_unknown_parent:y',
			'template_report_cycle:a',
			'template_report_cycle:b',
			'template_report_source:yacht_hire:llp',
		]);
		expect(
			reportProblems(balanceSheet, report([line('z', { sources: [{ kind: 'ledger', key: 'yacht' }] })]), library),
		).toHaveLength(5);
	});

	it('says when the charts a kind opens don’t fit together', () => {
		const clash: AccountsTemplate = {
			...byCode('CH-PROP'),
			code: 'CH-CLASH',
			appliesTo: { all: false, kinds: ['proprietorship'] },
		};
		const content = report([line('cash', { sources: [{ kind: 'role', key: 'cash' }] })]);
		expect(reportProblems(balanceSheet, content, [...library, clash])).toContain(
			'template_duplicate_key:capital_account',
		);
	});
});

const group = (id: string, nature: AccountGroup['nature'], parentId: string | null = null, roles: string[] = []) =>
	({ id, systemKey: id, name: id, parentId, nature, roles }) as unknown as AccountGroup;
const ledgerOf = (id: string, groupId: string, nature: Ledger['nature'], roles: string[] = []) =>
	({ id, systemKey: id, name: `Ledger ${id}`, groupId, nature, roles, active: true }) as unknown as Ledger;
const books: ReportBooks = {
	groups: [
		group('assets', 'asset'),
		group('current_assets', 'asset', 'assets'),
		group('cash_in_hand', 'asset', 'current_assets'),
		group('capital_account', 'equity'),
		group('sales_accounts', 'income'),
		group('indirect_expenses', 'expense'),
		group('sundry_creditors', 'liability'),
	],
	ledgers: [
		ledgerOf('cash', 'cash_in_hand', 'asset'),
		ledgerOf('capital', 'capital_account', 'equity'),
		ledgerOf('drawings', 'capital_account', 'equity'),
		ledgerOf('sales', 'sales_accounts', 'income'),
		ledgerOf('shop_rent', 'indirect_expenses', 'expense', ['rent']),
		ledgerOf('suppliers', 'sundry_creditors', 'liability'),
	],
};
const thisYear = {
	closing: {
		cash: 50_000,
		capital: -100_000,
		drawings: 20_000,
		sales: -300_000,
		shop_rent: 40_000,
		suppliers: -10_000,
	},
	opening: { cash: 99_999, sales: -100_000, shop_rent: 10_000 },
};
const lastYear = { closing: { cash: 30_000, capital: -100_000, sales: -100_000, shop_rent: 10_000 }, opening: {} };

describe('Preview with this company', () => {
	it('adds up each line: closing balances, the year’s movement for income and expense, credit lines read positive', () => {
		const content = report([
			line('assets'),
			line('cash', { parentKey: 'assets', sources: [{ kind: 'role', key: 'cash_in_hand' }] }),
			line('funds', {
				sources: [
					{ kind: 'ledger', key: 'capital' },
					{ kind: 'ledger', key: 'drawings' },
				],
			}),
			line('profit', {
				sources: [
					{ kind: 'group', key: 'sales_accounts' },
					{ kind: 'role', key: 'rent' },
				],
			}),
			line('creditors', { sources: [{ kind: 'group', key: 'sundry_creditors' }] }),
			line('current', {
				sources: [
					{ kind: 'group', key: 'current_assets' },
					{ kind: 'ledger', key: 'cash' },
				],
			}),
		]);
		const { rows, problems } = reportRows(content, books, thisYear, lastYear);
		expect(problems).toEqual([]);
		expect(rows.map((row) => [row.key, row.depth, row.side, row.thisYearPaise, row.lastYearPaise])).toEqual([
			['assets', 0, 'debit', 50_000, 30_000],
			['cash', 1, 'debit', 50_000, 30_000],
			['funds', 0, 'credit', 80_000, 100_000],
			['profit', 0, 'credit', 170_000, 90_000],
			['creditors', 0, 'credit', 10_000, 0],
			['current', 0, 'debit', 50_000, 30_000],
		]);
		expect(rows.every((row) => row.ledgers.length === 0)).toBe(true);
	});

	it('lists each line’s own ledgers with a note per line, and the year before only when shown', () => {
		const content = report(
			[
				line('heading'),
				line('funds', { parentKey: 'heading', sources: [{ kind: 'group', key: 'capital_account' }] }),
			],
			{ notes: true, columns: 'thisYear' },
		);
		const { rows } = reportRows(content, books, thisYear, null);
		expect(rows[0]).toMatchObject({
			key: 'heading',
			side: 'credit',
			thisYearPaise: 80_000,
			lastYearPaise: null,
			ledgers: [],
		});
		expect(rows[1]?.ledgers).toEqual([
			{ name: 'Ledger capital', thisYearPaise: 100_000, lastYearPaise: null },
			{ name: 'Ledger drawings', thisYearPaise: -20_000, lastYearPaise: null },
		]);
		expect(reportRows(content, books, thisYear, lastYear).rows[1]?.ledgers[1]).toEqual({
			name: 'Ledger drawings',
			thisYearPaise: -20_000,
			lastYearPaise: 0,
		});
	});

	it('names every source the books don’t have, and shows nothing for it', () => {
		const content = report([
			line('lost', {
				sources: [
					{ kind: 'ledger', key: 'yacht' },
					{ kind: 'group', key: 'nowhere' },
					{ kind: 'role', key: 'nobody' },
				],
			}),
		]);
		const { rows, problems } = reportRows(content, books, thisYear, lastYear);
		expect(problems).toEqual([
			'report_source_unknown:ledger:yacht',
			'report_source_unknown:group:nowhere',
			'report_source_unknown:role:nobody',
		]);
		expect(rows[0]).toMatchObject({ side: 'debit', thisYearPaise: 0, lastYearPaise: 0 });
	});
});
