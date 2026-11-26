import { describe, expect, it } from 'vitest';

import type {
	AccountGroup,
	AccountsTemplate,
	ChartTemplateContent,
	Ledger,
	ReportTemplateContent,
} from '@saha-textile/contracts';

import { reportRows, type ReportBooks } from '../src/templates/report-rules';
import { starterTemplates } from '../src/templates/starter';
import { APPROPRIATION, APPROPRIATION_V2, FIRM_SHARE_LEDGERS, STARTER_REPORTS } from '../src/templates/starter-packs';

/**
 * Year close's profit in the statements and the starter library (brief 25 YC1–YC3): earlier years' profit carried into
 * the profit and loss account in both columns, a firm's chart version 3 with the sharing ledgers, and the appropriation
 * account's version 2.
 */

const group = (id: string, nature: AccountGroup['nature']) =>
	({ id, systemKey: id, name: id, parentId: null, nature, roles: [] }) as unknown as AccountGroup;
const ledgerOf = (id: string, groupId: string, nature: Ledger['nature']) =>
	({ id, systemKey: id, name: `Ledger ${id}`, groupId, nature, roles: [], active: true }) as unknown as Ledger;

const books: ReportBooks = {
	groups: [
		group('cash_in_hand', 'asset'),
		group('capital_account', 'equity'),
		group('reserves_and_surplus', 'equity'),
		group('sales_accounts', 'income'),
		group('indirect_expenses', 'expense'),
	],
	ledgers: [
		ledgerOf('cash', 'cash_in_hand', 'asset'),
		ledgerOf('capital', 'capital_account', 'equity'),
		ledgerOf('profit_and_loss', 'reserves_and_surplus', 'equity'),
		ledgerOf('sales', 'sales_accounts', 'income'),
		ledgerOf('rent', 'indirect_expenses', 'expense'),
	],
};

// Balances never move with the closing entries: on the eve of 2026-27 the books still hold the earlier years' sales
// ₹40,000 and rent ₹30,000 (₹10,000 profit); this year adds ₹60,000 of sales and ₹20,000 of rent (₹40,000 profit).
const thisYear = {
	closing: { cash: 100_000, capital: -50_000, sales: -100_000, rent: 50_000 },
	opening: { cash: 60_000, capital: -50_000, sales: -40_000, rent: 30_000 },
};
// 2025-26 closed with ₹40,000 of sales and ₹30,000 of rent, ₹15,000 and ₹10,000 of them from the years before.
const lastYear = {
	closing: thisYear.opening,
	opening: { cash: 5_000, capital: -50_000, sales: -15_000, rent: 10_000 },
};

const balanceSheet: ReportTemplateContent = {
	kind: 'report',
	columns: 'thisAndLast',
	notes: false,
	level: null,
	lines: [
		{ key: 'cash', label: 'Cash', parentKey: null, sources: [{ kind: 'group', key: 'cash_in_hand' }] },
		{ key: 'capital', label: 'Capital', parentKey: null, sources: [{ kind: 'group', key: 'capital_account' }] },
		{
			key: 'earlier',
			label: 'Profit and loss account',
			parentKey: null,
			sources: [{ kind: 'ledger', key: 'profit_and_loss' }],
		},
		{
			key: 'year',
			label: 'Profit for the year',
			parentKey: null,
			sources: [
				{ kind: 'group', key: 'sales_accounts' },
				{ kind: 'group', key: 'indirect_expenses' },
			],
		},
	],
};

describe('earlier years’ profit in the statements', () => {
	it('carries it into the profit and loss account in both columns, and the balance sheet balances', () => {
		const { rows } = reportRows(balanceSheet, books, thisYear, lastYear);
		expect(rows.map((row) => [row.key, row.side, row.thisYearPaise, row.lastYearPaise])).toEqual([
			['cash', 'debit', 100_000, 60_000],
			['capital', 'credit', 50_000, 50_000],
			['earlier', 'credit', 10_000, 5_000],
			['year', 'credit', 40_000, 5_000],
		]);
		const [cash, ...funds] = rows;
		expect(funds.reduce((sum, row) => sum + (row.thisYearPaise ?? 0), 0)).toBe(cash?.thisYearPaise);
		expect(funds.reduce((sum, row) => sum + (row.lastYearPaise ?? 0), 0)).toBe(cash?.lastYearPaise);
	});

	it('carries it with no year before shown', () => {
		const { rows } = reportRows(balanceSheet, books, thisYear, null);
		expect(rows.find((row) => row.key === 'earlier')).toMatchObject({ thisYearPaise: 10_000, lastYearPaise: null });
	});

	it('carries nothing in the first year', () => {
		const first = { closing: thisYear.closing, opening: {} };
		const { rows } = reportRows(balanceSheet, books, first, null);
		expect(rows.find((row) => row.key === 'earlier')?.thisYearPaise).toBe(0);
		expect(rows.find((row) => row.key === 'year')?.thisYearPaise).toBe(50_000);
	});
});

describe('the starter library after brief 25', () => {
	const library = starterTemplates('2026-11-25T10:00:00.000Z');
	const byCode = (code: string) => library.find((t) => t.code === code) as AccountsTemplate;
	const chart = (t: AccountsTemplate, at: number) => t.versions[at]?.content as ChartTemplateContent;

	it('gives a firm’s and an LLP’s chart a third version from 25 November with the share of profit and TDS on partners', () => {
		for (const code of ['CH-FIRM', 'CH-LLP']) {
			const t = byCode(code);
			expect(t.versions.map((v) => [v.version, v.validFrom])).toEqual([
				[1, '2026-04-01'],
				[2, '2026-04-01'],
				[3, '2026-11-25'],
			]);
			expect(chart(t, 2).ledgers).toEqual([...chart(t, 1).ledgers, ...FIRM_SHARE_LEDGERS]);
			expect(chart(t, 2).groups).toEqual(chart(t, 1).groups);
			expect(t.versions[2]?.source).toContain('share of profit and TDS on partners');
		}
		expect(FIRM_SHARE_LEDGERS.map((l) => [l.key, l.groupKey, l.roles])).toEqual([
			['partners_profit_share', 'appropriation', ['partners_profit_share']],
			['tds_payable_partners', 'duties_and_taxes', ['tds_payable_partners']],
		]);
		expect(FIRM_SHARE_LEDGERS[1]?.source).toContain('s.194T');
	});

	it('keeps a proprietor’s and a company’s chart as they were', () => {
		expect(byCode('CH-PROP').versions).toHaveLength(2);
		expect(byCode('CH-OPC').versions).toHaveLength(3);
		expect(byCode('CH-PVT').versions).toHaveLength(3);
	});

	it('has a role for every line of the new appropriation account in a firm’s third chart', () => {
		const roles = new Set(chart(byCode('CH-FIRM'), 2).ledgers.flatMap((l) => l.roles));
		for (const line of APPROPRIATION_V2.lines)
			for (const source of line.sources) if (source.kind === 'role') expect(roles).toContain(source.key);
	});

	it('gives the appropriation account a second version from 25 November and every other report one', () => {
		const appropriation = byCode('RP-APPROP');
		expect(appropriation.versions.map((v) => [v.version, v.validFrom, v.content])).toEqual([
			[1, '2026-04-01', APPROPRIATION],
			[2, '2026-11-25', APPROPRIATION_V2],
		]);
		expect(APPROPRIATION_V2.lines.map((l) => l.key)).toEqual([
			'net_profit',
			'interest',
			'remuneration',
			'to_partners',
			'balance',
		]);
		for (const starter of STARTER_REPORTS.filter((s) => !s.later))
			expect(byCode(starter.code).versions).toHaveLength(1);
	});
});
