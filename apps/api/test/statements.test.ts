import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { StatementsController } from '../src/reports/statements.controller';
import { isLayoutFor, StatementsService } from '../src/reports/statements.service';

/** The financial statements (accounts brief U2, U3): as at a day, last year beside it, and profit by location. */

const refusal = (code: string) => ({ response: { message: code } });
const owner = { userId: 'adm_1', permissions: ['accounts.index'] } as never;

const CHART = {
	groups: [],
	ledgers: [
		{ id: 'led_sales', name: 'Sales', groupId: 'g', nature: 'income', systemKey: 'sales', roles: [] },
		{ id: 'led_rent', name: 'Rent', groupId: 'g', nature: 'expense', systemKey: 'rent', roles: [] },
		{ id: 'led_cash', name: 'Cash', groupId: 'g', nature: 'asset', systemKey: 'cash', roles: [] },
	],
};
/** A layout of three lines: income, expenses and cash. */
const layout = (code: string, columns: 'thisYear' | 'thisAndLast' = 'thisAndLast') => ({
	code,
	name: `Layout ${code}`,
	version: 2,
	content: {
		kind: 'report',
		columns,
		notes: false,
		level: null,
		lines: [
			{ key: 'income', label: 'Income', parentKey: null, sources: [{ kind: 'ledger', key: 'sales' }] },
			{ key: 'expenses', label: 'Expenses', parentKey: null, sources: [{ kind: 'ledger', key: 'rent' }] },
			{ key: 'cash', label: 'Cash', parentKey: null, sources: [{ kind: 'ledger', key: 'cash' }] },
		],
	},
});
const LAYOUTS = [layout('RP-APPROP'), layout('RP-SCH3-PL'), layout('RP-SCH3-BS')];

/** Balances by day and the locations asked for (debit positive). */
const BALANCES: Record<string, Record<string, number>> = {
	'2026-11-30|': { led_sales: -500_000, led_rent: 120_000, led_cash: 380_000 },
	'2026-03-31|': { led_sales: -200_000, led_rent: 50_000, led_cash: 150_000 },
	'2025-03-31|': { led_sales: -20_000, led_rent: 5_000, led_cash: 15_000 },
	'2026-11-30|loc_bar': { led_sales: -300_000, led_rent: 100_000, led_cash: 200_000 },
	'2026-03-31|loc_bar': { led_sales: -100_000, led_rent: 40_000 },
	'2026-11-30|loc_shop': { led_sales: -200_000, led_rent: 20_000 },
	'2026-03-31|loc_shop': { led_sales: -100_000, led_rent: 10_000 },
};

function build(options: { layouts?: unknown[] } = {}) {
	const ledger = {
		chart: async () => CHART,
		balancesAtLocations: vi.fn(
			async (day: string, _principal: unknown, only: readonly string[]) =>
				BALANCES[`${day}|${only.join(',')}`] ?? {},
		),
	};
	const locations = {
		list: vi.fn(async () => [
			{ id: 'loc_bar', name: 'Barasat', active: true },
			{ id: 'loc_shop', name: 'Shop', active: true },
			{ id: 'loc_old', name: 'Old godown', active: false },
		]),
	};
	const service = new StatementsService(
		ledger as never,
		{ installedReports: async () => options.layouts ?? LAYOUTS } as never,
		locations as never,
	);
	return { service, ledger, locations };
}

describe('which installed layout a statement uses', () => {
	it('takes -BS layouts for the balance sheet and -PL ones for profit and loss', () => {
		for (const code of ['RP-SCH3-BS', 'RP-NCE-BS-PROP', 'RP-LLP-BS']) {
			expect(isLayoutFor('balanceSheet', code)).toBe(true);
			expect(isLayoutFor('profitLoss', code)).toBe(false);
		}
		expect(isLayoutFor('profitLoss', 'RP-SCH3-PL')).toBe(true);
		expect(isLayoutFor('balanceSheet', 'RP-SCH3-PL')).toBe(false);
		expect(isLayoutFor('balanceSheet', 'RP-APPROP')).toBe(false);
		expect(isLayoutFor('profitLoss', 'RP-APPROP')).toBe(false);
	});
});

describe('a statement as at a day (U2)', () => {
	it('works the installed layout out on the books, with last year-end beside it', async () => {
		const { service, ledger } = build();
		const pl = await service.statement('profitLoss', { asAt: '2026-11-30' }, owner, '2026-12-01');
		expect(pl).toMatchObject({
			asAt: '2026-11-30',
			lastAsAt: '2026-03-31',
			code: 'RP-SCH3-PL',
			name: 'Layout RP-SCH3-PL',
			version: 2,
			problems: [],
		});
		// The year's movement for income and expenses, the balance for cash; last year from its own opening.
		expect(pl.rows.map((r) => [r.key, r.thisYearPaise, r.lastYearPaise])).toEqual([
			['income', 300_000, 180_000],
			['expenses', 70_000, 45_000],
			['cash', 380_000, 150_000],
		]);
		expect(ledger.balancesAtLocations).toHaveBeenCalledWith('2025-03-31', owner, []);
		const bs = await service.statement('balanceSheet', { asAt: '2026-11-30' }, owner, '2026-12-01');
		expect(bs.code).toBe('RP-SCH3-BS');
	});

	it('reads today when no day is given, one location when asked, and only this year for a one-column layout', async () => {
		const { service, ledger } = build({ layouts: [layout('RP-NCE-PL', 'thisYear')] });
		const today = await service.statement('profitLoss', { locationId: 'loc_bar' }, owner, '2027-02-10');
		expect(today).toMatchObject({ asAt: '2027-02-10', lastAsAt: null });
		// February falls in the year from April before it.
		expect(ledger.balancesAtLocations).toHaveBeenCalledWith('2027-02-10', owner, ['loc_bar']);
		expect(ledger.balancesAtLocations).toHaveBeenCalledWith('2026-03-31', owner, ['loc_bar']);
		expect(today.rows.every((r) => r.lastYearPaise === null)).toBe(true);
		const now = await service.statement('profitLoss', {}, undefined);
		expect(now.asAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('refuses a statement whose layout isn’t installed', async () => {
		const refused = build({ layouts: [layout('RP-APPROP')] }).service.statement('balanceSheet', {}, owner);
		await expect(refused).rejects.toBeInstanceOf(BadRequestException);
		await expect(refused).rejects.toMatchObject(refusal('statement_not_installed'));
	});
});

describe('profit and loss by location (U3)', () => {
	it('gives each active location its own column and the total from every location together', async () => {
		const { service, locations } = build();
		const report = await service.plByLocation({ from: '2026-04-01', to: '2026-11-30' }, owner);
		expect(locations.list).toHaveBeenCalledWith(owner);
		expect(report).toMatchObject({
			from: '2026-04-01',
			to: '2026-11-30',
			code: 'RP-SCH3-PL',
			name: 'Layout RP-SCH3-PL',
			locations: [
				{ id: 'loc_bar', name: 'Barasat' },
				{ id: 'loc_shop', name: 'Shop' },
			],
			problems: [],
		});
		expect(report.rows.map((r) => [r.key, r.depth, r.side, r.byLocation, r.totalPaise])).toEqual([
			['income', 0, 'credit', { loc_bar: 200_000, loc_shop: 100_000 }, 300_000],
			['expenses', 0, 'debit', { loc_bar: 60_000, loc_shop: 10_000 }, 70_000],
			['cash', 0, 'debit', { loc_bar: 200_000, loc_shop: 0 }, 380_000],
		]);
	});

	it('refuses a period that ends before it starts', async () => {
		await expect(
			build().service.plByLocation({ from: '2026-12-01', to: '2026-11-30' }, owner),
		).rejects.toMatchObject(refusal('report_period_backwards'));
	});
});

describe('the statement routes', () => {
	it('hand each call to its service; the audit report needs accounts.lock, the rest accounts.index', () => {
		const statements = {
			statement: vi.fn((...args: unknown[]) => ['statement', ...args]),
			plByLocation: vi.fn((...args: unknown[]) => ['plByLocation', ...args]),
		};
		const books = {
			ageing: vi.fn((...args: unknown[]) => ['ageing', ...args]),
			auditReport: vi.fn((...args: unknown[]) => ['auditReport', ...args]),
		};
		const c = new StatementsController(statements as never, books as never);
		const period = { from: '2026-04-01', to: '2026-11-30' };
		const audit = { ...period, chip: 'all', page: 1, pageSize: 50 } as const;
		expect([
			c.statement('profitLoss', { asAt: '2026-11-30' }, owner),
			c.statement('balanceSheet', {}),
			c.plByLocation(period, owner),
			c.plByLocation(period),
			c.ageing('suppliers'),
			c.audit(audit),
		]).toEqual([
			['statement', 'profitLoss', { asAt: '2026-11-30' }, owner],
			['statement', 'balanceSheet', {}, undefined],
			['plByLocation', period, owner],
			['plByLocation', period, undefined],
			['ageing', 'suppliers'],
			['auditReport', audit],
		]);
		const perm = (m: keyof StatementsController) =>
			new Reflector().get(PERMISSIONS_KEY, StatementsController.prototype[m]);
		expect([perm('statement'), perm('plByLocation'), perm('ageing'), perm('audit')]).toEqual([
			['accounts.index'],
			['accounts.index'],
			['accounts.index'],
			['accounts.lock'],
		]);
	});
});
