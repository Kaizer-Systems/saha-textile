import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExpenseBill, ExpenseBillWrite } from '@saha-textile/contracts';
import { expenseBillPosting, expenseBillTotals } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { ExpenseBillsController, ExpenseBillsModule, ExpenseBillsService } from '../src/expense-bills/expense-bills';
import { LedgerModule } from '../src/ledger/ledger.module';
import { OrdersSetupModule } from '../src/orders-setup/orders-setup.module';

/**
 * Purchases › Expense bills (brief 25 EB1): a registered supplier's bill for something that isn't stock, saved as a
 * draft, posted once with its EB number, and cancelled by posting the opposite of its voucher.
 */

const at = '2026-11-25T10:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const ca = { userId: 'adm_ca', permissions: ['accounts.post'] } as never;

/** A West Bengal supplier, a Maharashtra one, and a carpenter without a GSTIN. */
const SUPPLIERS: Record<string, unknown> = {
	sup_wb: { id: 'sup_wb', name: 'Kolkata Rentals', gstin: '19AAACK1234A1Z5' },
	sup_mh: { id: 'sup_mh', name: 'Pune Software', gstin: '27AAACP1234A1Z5' },
	sup_none: { id: 'sup_none', name: 'Carpenter', gstin: null },
};
const LOCATIONS = [
	{ id: 'loc_bar', stateCode: '19' },
	{ id: 'loc_pune', stateCode: '27' },
];
const write = (over: Partial<ExpenseBillWrite> = {}): ExpenseBillWrite => ({
	supplierId: 'sup_wb',
	billNumber: 'KR/1123',
	billDate: '2026-11-20',
	locationId: 'loc_bar',
	lines: [
		{
			expenseLedgerId: 'led_rent',
			what: 'Shop rent, November',
			sac: '997212',
			taxableINR: 20_000,
			gstRatePct: 18,
			credit: 'claim',
			blockedClause: '',
		},
	],
	note: '',
	...over,
});
const bill = (over: Partial<ExpenseBill> = {}): ExpenseBill => ({
	...write(),
	...expenseBillTotals(write().lines, false),
	id: 'eb_1',
	number: null,
	status: 'draft',
	interState: false,
	voucherId: null,
	postedAt: null,
	postedBy: null,
	createdAt: '2026-11-20T06:00:00.000Z',
	updatedAt: '2026-11-20T06:00:00.000Z',
	version: 2,
	...over,
});

interface Options {
	stored?: ExpenseBill | null;
	saveFails?: unknown;
	original?: unknown;
}

function build(options: Options = {}) {
	const bills = {
		list: vi.fn(async () => ['bill']),
		get: vi.fn(async () => (options.stored === undefined ? bill() : options.stored)),
		save: vi.fn(async (next: ExpenseBill, _expected: number | null, _context?: unknown) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			return next;
		}),
	};
	const ledger = {
		post: vi.fn(async (_request: unknown, _context: unknown, _by: string | null) => ({ id: 'jv_9' })),
		voucherByKey: vi.fn(async (_key: string, _context: unknown) => options.original ?? null),
	};
	const numbers = { issue: vi.fn(async () => 'EB/26-27/000003') };
	const transactions = {
		withTransaction: vi.fn(async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' })),
	};
	const service = new ExpenseBillsService(
		bills as never,
		{ findById: async (id: string) => SUPPLIERS[id] ?? null } as never,
		{ list: async () => LOCATIONS } as never,
		ledger as never,
		numbers as never,
		transactions as never,
	);
	return { service, bills, ledger, numbers, transactions };
}

describe('reading expense bills', () => {
	it('lists them as the store finds them, and refuses one it doesn’t have', async () => {
		const { service, bills } = build({ stored: null });
		expect(await service.list({ supplierId: 'sup_wb', status: 'draft' })).toEqual(['bill']);
		expect(bills.list).toHaveBeenCalledWith({ supplierId: 'sup_wb', status: 'draft' });
		await expect(service.get('eb_gone')).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.get('eb_gone')).rejects.toMatchObject(refusal('expense_bill_not_found'));
	});
});

describe('saving a draft', () => {
	it('works out the figures in the location’s State: CGST and SGST from a supplier there', async () => {
		const { service, bills } = build();
		const saved = await service.create(write(), now);
		expect(saved).toMatchObject({
			...write(),
			interState: false,
			taxableINR: 20_000,
			cgstINR: 1_800,
			sgstINR: 1_800,
			igstINR: 0,
			totalINR: 23_600,
			number: null,
			status: 'draft',
			voucherId: null,
			postedAt: null,
			postedBy: null,
			createdAt: at,
			updatedAt: at,
			version: 0,
		});
		expect(saved.id).toMatch(/^eb_[0-9a-f-]{36}$/);
		expect(bills.save.mock.calls[0]?.[1]).toBeNull();
	});

	it('takes IGST from another State’s supplier, and no tax from one without a GSTIN charging none', async () => {
		const { service } = build();
		expect(await service.create(write({ supplierId: 'sup_mh' }), now)).toMatchObject({
			interState: true,
			cgstINR: 0,
			igstINR: 3_600,
		});
		const zero = write({
			supplierId: 'sup_none',
			lines: [{ ...write().lines[0], gstRatePct: 0 } as ExpenseBillWrite['lines'][number]],
		});
		expect(await service.create(zero, now)).toMatchObject({ interState: false, totalINR: 20_000 });
	});

	it('refuses an unknown supplier or location, and GST on an unregistered supplier’s bill', async () => {
		const { service, bills } = build();
		await expect(service.create(write({ supplierId: 'sup_gone' }))).rejects.toMatchObject(
			refusal('supplier_unknown'),
		);
		await expect(service.create(write({ locationId: 'loc_gone' }))).rejects.toMatchObject(
			refusal('location_unknown'),
		);
		await expect(service.create(write({ supplierId: 'sup_none' }))).rejects.toMatchObject(
			refusal('use_self_invoice'),
		);
		await expect(service.create(write({ supplierId: 'sup_none' }))).rejects.toBeInstanceOf(BadRequestException);
		expect(bills.save).not.toHaveBeenCalled();
	});
});

describe('changing a draft', () => {
	it('saves the change with its figures worked again, at the version the screen had', async () => {
		const { service, bills } = build();
		// The screen read version 1; the store holds version 2 and decides.
		const changed = await service.update('eb_1', { ...write({ supplierId: 'sup_mh' }), version: 1 }, now);
		expect(changed).toMatchObject({
			id: 'eb_1',
			supplierId: 'sup_mh',
			interState: true,
			igstINR: 3_600,
			updatedAt: at,
		});
		expect(bills.save.mock.calls[0]?.[1]).toBe(1);
		expect(bills.save.mock.calls[0]?.[0].version).toBe(2);
	});

	it('refuses a bill no longer a draft, one changed meanwhile, and passes any other failure on', async () => {
		const edit = { ...write(), version: 2 };
		await expect(build({ stored: bill({ status: 'posted' }) }).service.update('eb_1', edit)).rejects.toMatchObject(
			refusal('expense_bill_not_draft'),
		);
		const changed = build({ saveFails: new Error('expense_bill_changed') }).service.update('eb_1', edit);
		await expect(changed).rejects.toBeInstanceOf(ConflictException);
		await expect(
			build({ saveFails: new Error('expense_bill_changed') }).service.update('eb_1', edit),
		).rejects.toMatchObject(refusal('expense_bill_changed'));
		const diskFull = new Error('disk full');
		await expect(build({ saveFails: diskFull }).service.update('eb_1', edit)).rejects.toBe(diskFull);
		await expect(build({ saveFails: 'odd' }).service.update('eb_1', edit)).rejects.toBe('odd');
	});
});

describe('posting a bill (EB1)', () => {
	it('gives it its EB number and one voucher on the bill’s day, then saves it posted, all in one transaction', async () => {
		const { service, bills, ledger, numbers, transactions } = build();
		const posted = await service.post('eb_1', ca, now);
		expect(transactions.withTransaction).toHaveBeenCalledOnce();
		expect(numbers.issue).toHaveBeenCalledWith('expenseBill', { session: 'tx' }, new Date('2026-11-20T06:30:00Z'));
		expect(ledger.post).toHaveBeenCalledWith(
			{
				kind: 'document',
				date: '2026-11-20',
				narration: 'Expense bill EB/26-27/000003 (KR/1123)',
				source: { type: 'expenseBill', id: 'eb_1', number: 'EB/26-27/000003' },
				idempotencyKey: 'expenseBill:eb_1',
				lines: expenseBillPosting(bill()),
			},
			{ session: 'tx' },
			'adm_ca',
		);
		expect(posted).toMatchObject({
			number: 'EB/26-27/000003',
			status: 'posted',
			voucherId: 'jv_9',
			postedAt: at,
			postedBy: 'adm_ca',
			updatedAt: at,
		});
		expect(bills.save.mock.calls[0]?.slice(1)).toEqual([2, { session: 'tx' }]);
	});

	it('posts as no one when no one is signed in, and refuses a bill already posted', async () => {
		const { service, ledger } = build();
		expect((await service.post('eb_1', undefined)).postedBy).toBeNull();
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
		await expect(build({ stored: bill({ status: 'posted' }) }).service.post('eb_1', ca)).rejects.toMatchObject(
			refusal('expense_bill_not_draft'),
		);
	});
});

describe('cancelling a bill', () => {
	const ORIGINAL = {
		id: 'jv_9',
		lines: [
			{ ledgerId: 'led_rent', locationId: 'loc_bar', debitPaise: 20_000_00, creditPaise: 0 },
			{ ledgerId: 'led_input_cgst', locationId: 'loc_bar', debitPaise: 1_800_00, creditPaise: 0 },
			{ ledgerId: 'led_creditors', locationId: 'loc_bar', debitPaise: 0, creditPaise: 21_800_00 },
		],
	};

	it('posts the opposite of a posted bill’s voucher on the day it is cancelled, and keeps its number', async () => {
		const { service, ledger, bills } = build({
			stored: bill({ status: 'posted', number: 'EB/26-27/000003', voucherId: 'jv_9' }),
			original: ORIGINAL,
		});
		// 25 Nov 2026, 23:30 in India.
		const cancelled = await service.cancel('eb_1', 'Billed twice', ca, new Date('2026-11-25T18:00:00Z'));
		expect(ledger.voucherByKey).toHaveBeenCalledWith('expenseBill:eb_1', { session: 'tx' });
		expect(ledger.post).toHaveBeenCalledWith(
			{
				kind: 'document',
				date: '2026-11-25',
				narration: 'Cancelled expense bill EB/26-27/000003: Billed twice',
				source: { type: 'expenseBill', id: 'eb_1', number: 'EB/26-27/000003' },
				idempotencyKey: 'expenseBill:eb_1:cancel',
				lines: [
					{ ledger: { id: 'led_rent' }, locationId: 'loc_bar', debitPaise: 0, creditPaise: 20_000_00 },
					{ ledger: { id: 'led_input_cgst' }, locationId: 'loc_bar', debitPaise: 0, creditPaise: 1_800_00 },
					{ ledger: { id: 'led_creditors' }, locationId: 'loc_bar', debitPaise: 21_800_00, creditPaise: 0 },
				],
			},
			{ session: 'tx' },
			'adm_ca',
		);
		expect(cancelled).toMatchObject({ status: 'cancelled', number: 'EB/26-27/000003' });
		expect(bills.save.mock.calls[0]?.slice(1)).toEqual([2, { session: 'tx' }]);
	});

	it('names a bill without its EB number by the supplier’s, as no one when no one is signed in', async () => {
		const { service, ledger } = build({ stored: bill({ status: 'posted' }), original: ORIGINAL });
		await service.cancel('eb_1', 'Wrong supplier', undefined, now);
		expect(ledger.post.mock.calls[0]?.[0]).toMatchObject({
			narration: 'Cancelled expense bill KR/1123: Wrong supplier',
			source: { number: null },
		});
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
	});

	it('cancels a draft without posting, and refuses one cancelled already', async () => {
		const { service, ledger } = build();
		expect(await service.cancel('eb_1', 'Not needed', ca, now)).toMatchObject({
			status: 'cancelled',
			updatedAt: at,
		});
		expect(ledger.post).not.toHaveBeenCalled();
		await expect(
			build({ stored: bill({ status: 'cancelled' }) }).service.cancel('eb_1', 'Again', ca),
		).rejects.toMatchObject(refusal('expense_bill_cancelled'));
	});
});

describe('the expense bill routes', () => {
	it('hand each call to the service; reading needs accounts.index, drafts accounts.edit, posting accounts.post', () => {
		const service = new Proxy(
			{},
			{
				get:
					(_target, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new ExpenseBillsController(service as never);
		const body = write();
		expect([
			c.list({ status: 'posted' }),
			c.get('eb_1'),
			c.create(body),
			c.update('eb_1', { ...body, version: 1 }),
			c.post('eb_1', ca),
			c.post('eb_1'),
			c.cancel('eb_1', { reason: 'Billed twice' }, ca),
			c.cancel('eb_1', { reason: 'Billed twice' }),
		]).toEqual([
			['list', { status: 'posted' }],
			['get', 'eb_1'],
			['create', body],
			['update', 'eb_1', { ...body, version: 1 }],
			['post', 'eb_1', ca],
			['post', 'eb_1', undefined],
			['cancel', 'eb_1', 'Billed twice', ca],
			['cancel', 'eb_1', 'Billed twice', undefined],
		]);
		const perm = (m: keyof ExpenseBillsController) =>
			new Reflector().get(PERMISSIONS_KEY, ExpenseBillsController.prototype[m]);
		expect(['list', 'get', 'create', 'update', 'post', 'cancel'].map((m) => perm(m as never))).toEqual([
			['accounts.index'],
			['accounts.index'],
			['accounts.edit'],
			['accounts.edit'],
			['accounts.post'],
			['accounts.post'],
		]);
		expect(Reflect.getMetadata('path', ExpenseBillsController)).toBe('admin/expense-bills');
		expect(
			['get', 'update', 'post', 'cancel'].map((m) =>
				Reflect.getMetadata('path', ExpenseBillsController.prototype[m as keyof ExpenseBillsController]),
			),
		).toEqual([':id', ':id', ':id/post', ':id/cancel']);
		expect(Reflect.getMetadata('imports', ExpenseBillsModule)).toEqual([LedgerModule, OrdersSetupModule]);
		expect(Reflect.getMetadata('controllers', ExpenseBillsModule)).toEqual([ExpenseBillsController]);
		expect(Reflect.getMetadata('providers', ExpenseBillsModule)).toEqual([ExpenseBillsService]);
	});
});
