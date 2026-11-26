import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { BooksExportController, BooksExportService } from '../src/reports/books-export';
import { ReportsModule } from '../src/reports/reports.module';

/** Exporting the books (accounts brief W4): Tally, the trial balance, ledger lines or the edit log, each logged. */

const refusal = (code: string) => ({ response: { message: code } });
const owner = { userId: 'adm_owner', permissions: ['accounts.index'] } as never;

const CHART = {
	groups: [
		{ id: 'g_cash', parentId: null, systemKey: 'cash_in_hand', name: 'Cash-in-hand' },
		{ id: 'g_cap', parentId: null, systemKey: 'capital_account', name: 'Capital account' },
		// Under Cash-in-hand, with no key of its own: placed by its parent.
		{ id: 'g_boxes', parentId: 'g_cash', systemKey: null, name: 'Cash boxes' },
		// A key Tally has no primary group for, and no parent: Suspense A/c.
		{ id: 'g_odd', parentId: null, systemKey: 'branch_shares', name: 'Odd' },
	],
	ledgers: [
		{ id: 'led_cash', name: 'Cash', groupId: 'g_cash' },
		{ id: 'led_box', name: 'Counter box', groupId: 'g_boxes' },
		{ id: 'led_cap', name: 'Capital', groupId: 'g_cap' },
		{ id: 'led_odd', name: 'Odd & ends', groupId: 'g_odd' },
		// Its group is gone.
		{ id: 'led_lost', name: 'Lost', groupId: 'g_gone' },
	],
};
const line = (ledgerId: string, locationId: string, debitPaise: number, creditPaise: number, narration = '') => ({
	ledgerId,
	locationId,
	debitPaise,
	creditPaise,
	narration,
});
const VOUCHERS = [
	{
		id: 'jv_1',
		number: 'JV/1',
		kind: 'journal',
		date: '2026-11-10',
		narration: 'Capital brought in',
		source: null,
		lines: [line('led_cash', 'loc_bar', 500_000, 0, 'Cash in'), line('led_cap', 'loc_bar', 0, 500_000)],
	},
	{
		id: 'jv_2',
		number: 'JV/2',
		kind: 'payment',
		date: '2026-11-12',
		narration: 'Shop float',
		source: { type: 'cashTransfer' },
		lines: [line('led_box', 'loc_shop', 10_000, 0), line('led_gone', 'loc_shop', 0, 10_000)],
	},
	{
		id: 'jv_close',
		number: 'JV/9',
		kind: 'journal',
		date: '2026-11-30',
		narration: 'Closing entries',
		source: { type: 'yearClose' },
		lines: [line('led_cap', 'loc_bar', 100, 0)],
	},
];

function build(
	options: { pages?: { items: unknown[]; total: number }[]; balances?: Record<string, Record<string, number>> } = {},
) {
	const pages = options.pages ?? [{ items: VOUCHERS, total: 3 }];
	const books = {
		listVouchers: vi.fn(async (query: { page: number }) => pages[query.page - 1] ?? { items: [], total: 0 }),
		balancesAt: async () => ({}),
	};
	const ledger = {
		chart: async () => CHART,
		balancesAtLocations: vi.fn(
			async (day: string, _principal: unknown, only: readonly string[]) =>
				(options.balances ?? {})[`${day}|${only.join(',')}`] ?? {},
		),
	};
	const reports = {
		auditReport: vi.fn(async () => ({
			rows: [
				{
					at: '2026-11-10T06:00:00.000Z',
					who: 'Rina Das',
					action: 'accounts.voucher.update',
					entityType: 'journalVoucher',
					entityId: 'jv_1',
					detail: 'narration: a → b',
				},
				{
					at: '2026-11-11T06:00:00.000Z',
					who: '',
					action: 'accounts.period.lock',
					entityType: null,
					entityId: null,
					detail: '',
				},
			],
		})),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new BooksExportService(books as never, ledger as never, reports as never, audit as never);
	return { service, books, ledger, reports, audit };
}
const query = (format: string, over: Record<string, unknown> = {}) =>
	({ format, from: '2026-11-01', to: '2026-11-30', ...over }) as never;

describe('exporting the books (W4)', () => {
	it('writes the trial balance in the import template’s columns, only ledgers with a balance', async () => {
		const { service, ledger, audit } = build({
			balances: { '2026-11-30|': { led_cash: 500_000, led_cap: -500_000, led_odd: 0, led_lost: 2_500 } },
		});
		const file = await service.export(query('trial_balance_csv'), owner);
		expect(ledger.balancesAtLocations).toHaveBeenCalledWith('2026-11-30', owner, []);
		expect(file).toEqual({
			fileName: 'trial-balance-2026-11-30.csv',
			text: [
				'Ledger,Group,Debit,Credit',
				'Cash,Cash-in-hand,5000.00,',
				'Capital,Capital account,,5000.00',
				'Lost,,25.00,',
			].join('\n'),
		});
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: 'adm_owner',
				action: 'accounts.export',
				entityType: 'books',
				entityId: null,
				retentionTier: 'financial_security',
				metadata: { format: 'trial_balance_csv', from: '2026-11-01', to: '2026-11-30', locationId: null },
			}),
		);
	});

	it('writes every ledger line of the period at one location, page by page', async () => {
		const { service, books, audit } = build({
			pages: [
				{ items: VOUCHERS.slice(0, 1), total: 3 },
				{ items: VOUCHERS.slice(1), total: 3 },
			],
		});
		const file = await service.export(query('ledger_lines_csv', { locationId: 'loc_shop' }), undefined);
		expect(books.listVouchers).toHaveBeenCalledTimes(2);
		expect(books.listVouchers).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 500, page: 1 }));
		expect(file).toEqual({
			fileName: 'ledger-lines-2026-11-01-to-2026-11-30.csv',
			text: [
				'Date,Voucher,Kind,Ledger,Location,Narration,Debit,Credit',
				'2026-11-12,JV/2,payment,Counter box,loc_shop,Shop float,100.00,',
				'2026-11-12,JV/2,payment,led_gone,loc_shop,Shop float,,100.00',
			].join('\n'),
		});
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: null,
				metadata: expect.objectContaining({ locationId: 'loc_shop' }),
			}),
		);
		const all = await build().service.export(query('ledger_lines_csv'), owner);
		expect(all.text.split('\n')[1]).toBe('2026-11-10,JV/1,journal,Cash,loc_bar,Cash in,5000.00,');
	});

	it('stops at an empty page, and refuses more vouchers than an export reads', async () => {
		const short = build({ pages: [{ items: VOUCHERS.slice(0, 1), total: 9 }] });
		await short.service.export(query('ledger_lines_csv'), owner);
		expect(short.books.listVouchers).toHaveBeenCalledTimes(2);
		await expect(
			build({ pages: [{ items: VOUCHERS, total: 20_001 }] }).service.export(query('ledger_lines_csv'), owner),
		).rejects.toMatchObject(refusal('export_too_large'));
	});

	it('writes the edit log of the period', async () => {
		const { service, reports } = build();
		const file = await service.export(query('edit_log_csv'), owner);
		expect(reports.auditReport).toHaveBeenCalledWith({
			from: '2026-11-01',
			to: '2026-11-30',
			chip: 'all',
			page: 1,
			pageSize: 500,
		});
		expect(file).toEqual({
			fileName: 'edit-log-2026-11-01-to-2026-11-30.csv',
			text: [
				'When,Who,What,Record,Change',
				'2026-11-10T06:00:00.000Z,Rina Das,accounts.voucher.update,journalVoucher jv_1,narration: a → b',
				'2026-11-11T06:00:00.000Z,,accounts.period.lock,,',
			].join('\n'),
		});
	});

	it('writes a Tally file: opening balances the day before, each ledger under Tally’s group, closing entries left out', async () => {
		const { service, ledger } = build({
			balances: { '2026-10-31|loc_bar': { led_cash: 100_000, led_cap: -100_000 } },
		});
		const file = await service.export(query('tally_xml', { locationId: 'loc_bar' }), owner);
		expect(ledger.balancesAtLocations).toHaveBeenCalledWith('2026-10-31', owner, ['loc_bar']);
		expect(file.fileName).toBe('tally-2026-11-01-to-2026-11-30.xml');
		const parent = (name: string) =>
			new RegExp(`<LEDGER NAME="${name}"[^>]*><NAME>[^<]*</NAME><PARENT>([^<]*)</PARENT><OPENINGBALANCE>([^<]*)<`)
				.exec(file.text)
				?.slice(1);
		expect(parent('Cash')).toEqual(['Cash-in-Hand', '-1000.00']);
		expect(parent('Counter box')).toEqual(['Cash-in-Hand', '0.00']);
		expect(parent('Capital')).toEqual(['Capital Account', '1000.00']);
		expect(parent('Odd &amp; ends')).toEqual(['Suspense A/c', '0.00']);
		expect(parent('Lost')).toEqual(['Suspense A/c', '0.00']);
		// Only the bar's voucher: the shop's has no line here, and the closing entries never leave.
		expect(file.text.match(/<VOUCHERNUMBER>([^<]*)</g)).toEqual(['<VOUCHERNUMBER>JV/1<']);
	});

	it('refuses a period that ends before it starts', async () => {
		const refused = build().service.export(query('tally_xml', { from: '2026-12-01' }), owner);
		await expect(refused).rejects.toBeInstanceOf(BadRequestException);
		await expect(refused).rejects.toMatchObject(refusal('report_period_backwards'));
	});
});

describe('the export route', () => {
	it('hands the call to the service with accounts.index, and is part of the reports', () => {
		const exports = { export: vi.fn((...args: unknown[]) => ['export', ...args]) };
		const c = new BooksExportController(exports as never);
		const q = query('tally_xml');
		expect([c.export(q, owner), c.export(q)]).toEqual([
			['export', q, owner],
			['export', q, undefined],
		]);
		expect(new Reflector().get(PERMISSIONS_KEY, BooksExportController.prototype.export)).toEqual([
			'accounts.index',
		]);
		expect(Reflect.getMetadata('controllers', ReportsModule)).toContain(BooksExportController);
		expect(Reflect.getMetadata('providers', ReportsModule)).toContain(BooksExportService);
	});
});
