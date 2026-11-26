import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExpenseBill, PaymentVoucher } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesService } from '../src/self-invoices/self-invoices.service';

/**
 * Cancelling an expense bill's payment voucher (brief 25 EB2): the payment is reversed as any voucher's is, and the
 * bill is owed that much again, the voucher dropped from it; no self-invoice is read.
 */

const at = '2026-11-25T10:00:00.000Z';
const now = new Date(at);
const owner = { userId: 'adm_owner', permissions: ['accounts.lock'] } as never;
const refusal = (code: string) => ({ response: { message: code } });

const voucher = (over: Partial<PaymentVoucher> = {}) =>
	PaymentVoucher.parse({
		id: 'pv_11',
		number: 'PV/26-27/000011',
		date: '2026-11-24',
		supplierId: 'sup_wb',
		payeeName: 'Kolkata Rentals',
		payeeAddress: '',
		against: { kind: 'expenseBill', id: 'eb_1', number: 'EB/26-27/000003', detail: 'Shop rent, November' },
		amountINR: 13_600,
		mode: 'bank_transfer',
		reference: null,
		paidFromLedgerId: 'led_hdfc',
		reverseChargeTaxINR: null,
		supplierPaymentId: null,
		journalVoucherId: 'jv_2',
		locationId: 'loc_bar',
		createdAt: '2026-11-24T06:00:00.000Z',
		createdBy: 'adm_ca',
		...over,
	});
/** Paid in full by two vouchers: ₹10,000 and ₹13,600. */
const BILL = ExpenseBill.parse({
	supplierId: 'sup_wb',
	supplierName: 'Kolkata Rentals',
	billNumber: 'KR/1123',
	billDate: '2026-11-20',
	locationId: 'loc_bar',
	lines: [{ expenseLedgerId: 'led_rent', what: 'Shop rent, November', taxableINR: 20_000, gstRatePct: 18 }],
	id: 'eb_1',
	number: 'EB/26-27/000003',
	status: 'posted',
	interState: false,
	taxableINR: 20_000,
	cgstINR: 1_800,
	sgstINR: 1_800,
	igstINR: 0,
	blockedTaxINR: 0,
	totalINR: 23_600,
	paidINR: 23_600,
	paymentVouchers: [
		{ id: 'pv_10', number: 'PV/26-27/000010' },
		{ id: 'pv_11', number: 'PV/26-27/000011' },
	],
	createdAt: '2026-11-20T06:00:00.000Z',
	updatedAt: '2026-11-24T06:00:00.000Z',
	version: 4,
});

function build(options: { voucher?: PaymentVoucher; bill?: ExpenseBill | null; saveFails?: unknown } = {}) {
	const invoices = { get: vi.fn(async () => null) };
	const vouchers = {
		get: async () => options.voucher ?? voucher(),
		cancel: vi.fn(async (_next: PaymentVoucher, _context?: unknown) => undefined),
	};
	const expenseBills = {
		get: vi.fn(async () => (options.bill === undefined ? BILL : options.bill)),
		save: vi.fn(async (next: ExpenseBill, _version: number, _context?: unknown) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			return next;
		}),
	};
	const ledger = {
		isSuperAdmin: async () => true,
		post: vi.fn(async (_request: unknown, _context: unknown, _by: string | null) => ({ id: 'jv_undo' })),
	};
	const log = { append: vi.fn(async () => undefined) };
	const unused = {} as never;
	const service = new SelfInvoicesService(
		invoices as never,
		vouchers as never,
		unused,
		unused,
		unused,
		unused,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
		unused,
		ledger as never,
		unused,
		unused,
		log as never,
		unused,
		{ list: async () => [] } as never,
		expenseBills as never,
	);
	return { service, invoices, vouchers, expenseBills, ledger, log };
}
const cancel = (service: SelfInvoicesService) =>
	service.cancelPaymentVoucher('pv_11', { reason: 'Paid twice' }, owner, now);

describe('cancelling an expense bill’s payment voucher (EB2)', () => {
	it('reverses the payment and leaves the bill owed that much again, without the voucher', async () => {
		const { service, invoices, vouchers, expenseBills, ledger, log } = build();
		const cancelled = await cancel(service);
		expect(invoices.get).not.toHaveBeenCalled();
		expect(ledger.post.mock.calls[0]?.[0]).toMatchObject({
			date: '2026-11-25',
			lines: [
				{ ledger: { role: 'creditors_control' }, locationId: 'loc_bar', creditPaise: 13_600_00 },
				{ ledger: { id: 'led_hdfc' }, locationId: 'loc_bar', debitPaise: 13_600_00 },
			],
			idempotencyKey: 'paymentVoucher:pv_11:cancel',
		});
		expect(cancelled).toMatchObject({
			status: 'cancelled',
			reversalVoucherId: 'jv_undo',
			cancelReason: 'Paid twice',
		});
		expect(vouchers.cancel).toHaveBeenCalledWith(cancelled, { session: 'tx' });
		expect(expenseBills.get).toHaveBeenCalledWith('eb_1');
		expect(expenseBills.save).toHaveBeenCalledWith(
			{
				...BILL,
				paidINR: 10_000,
				paymentVouchers: [{ id: 'pv_10', number: 'PV/26-27/000010' }],
				updatedAt: at,
			},
			4,
			{ session: 'tx' },
		);
		expect(log.append).toHaveBeenCalledWith(
			'adm_owner',
			'paymentVoucher.cancel',
			'paymentVoucher',
			'pv_11',
			[{ field: 'status', before: 'paid', after: 'cancelled' }],
			{ reason: 'Paid twice' },
		);
	});

	it('puts a cash payment back in the cash', async () => {
		const { service, ledger } = build({ voucher: voucher({ mode: 'cash', paidFromLedgerId: null }) });
		await cancel(service);
		expect(ledger.post.mock.calls[0]?.[0]).toMatchObject({
			lines: [{ ledger: { role: 'creditors_control' } }, { ledger: { role: 'cash' }, debitPaise: 13_600_00 }],
		});
	});

	it('refuses when the bill is gone or changed meanwhile, and passes any other failure on', async () => {
		await expect(cancel(build({ bill: null }).service)).rejects.toBeInstanceOf(NotFoundException);
		await expect(cancel(build({ bill: null }).service)).rejects.toMatchObject(refusal('expense_bill_not_found'));
		const changed = new Error('expense_bill_changed');
		await expect(cancel(build({ saveFails: changed }).service)).rejects.toBeInstanceOf(ConflictException);
		await expect(cancel(build({ saveFails: changed }).service)).rejects.toMatchObject(
			refusal('expense_bill_changed'),
		);
		const diskFull = new Error('disk full');
		await expect(cancel(build({ saveFails: diskFull }).service)).rejects.toBe(diskFull);
		await expect(cancel(build({ saveFails: 'odd' }).service)).rejects.toBe('odd');
	});
});
