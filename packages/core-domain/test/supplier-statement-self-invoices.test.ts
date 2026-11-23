import { describe, expect, it } from 'vitest';

import { supplierStatement } from '../src/purchasing/supplier-account';

/** Reverse charge on the supplier's statement (accounts brief D): self-invoices and the vouchers that paid them. */

const invoice = (patch: Record<string, unknown> = {}) =>
	({
		id: 'si_1',
		number: 'SI/26-27/000002',
		date: '2026-11-21',
		taxableINR: 60_000,
		rule: { name: 'Rent of the shop' },
		cancelledAt: null,
		cancelReason: null,
		...patch,
	}) as never;
const voucher = (patch: Record<string, unknown> = {}) =>
	({
		id: 'pv_7',
		number: 'PV/26-27/000007',
		date: '2026-11-22',
		amountINR: 60_000,
		against: { kind: 'selfInvoice', id: 'si_1', number: 'SI/26-27/000002' },
		cancelledAt: null,
		cancelReason: null,
		...patch,
	}) as never;

describe('self-invoices on the supplier statement', () => {
	it('owes the taxable value from the self-invoice, settled by its payment vouchers, with cancels put back', () => {
		const rows = supplierStatement({
			entries: [],
			payments: [],
			returns: [],
			selfInvoices: [
				invoice(),
				invoice({ id: 'si_draft', number: null, date: null }),
				invoice({
					id: 'si_2',
					number: 'SI/26-27/000003',
					taxableINR: 3_000,
					cancelledAt: '2026-11-23T10:00:00.000Z',
					cancelReason: 'Typed twice',
				}),
				invoice({
					id: 'si_3',
					number: 'SI/26-27/000004',
					taxableINR: 100,
					cancelledAt: '2026-11-23T11:00:00.000Z',
				}),
			],
			selfInvoicePayments: [
				voucher(),
				voucher({
					id: 'pv_8',
					number: 'PV/26-27/000008',
					amountINR: 500,
					cancelledAt: '2026-11-24T10:00:00.000Z',
					cancelReason: 'Paid twice',
				}),
				voucher({
					id: 'pv_9',
					number: 'PV/26-27/000009',
					amountINR: 1,
					cancelledAt: '2026-11-24T11:00:00.000Z',
				}),
				voucher({ id: 'pv_bill', against: { kind: 'purchaseEntry', id: 'pe_1', number: 'PE/1' } }),
			],
		});
		expect(
			rows.map((r) => [
				r.date,
				r.kind,
				r.documentNumber,
				r.details,
				r.billINR,
				r.paidOrCreditedINR,
				r.balanceINR,
			]),
		).toEqual([
			['2026-11-21', 'self_invoice', 'SI/26-27/000002', 'Rent of the shop', 60_000, 0, 60_000],
			['2026-11-21', 'self_invoice', 'SI/26-27/000003', 'Rent of the shop', 3_000, 0, 63_000],
			['2026-11-21', 'self_invoice', 'SI/26-27/000004', 'Rent of the shop', 100, 0, 63_100],
			['2026-11-22', 'self_invoice_payment', 'PV/26-27/000007', 'SI/26-27/000002', 0, 60_000, 3_100],
			['2026-11-22', 'self_invoice_payment', 'PV/26-27/000008', 'SI/26-27/000002', 0, 500, 2_600],
			['2026-11-22', 'self_invoice_payment', 'PV/26-27/000009', 'SI/26-27/000002', 0, 1, 2_599],
			['2026-11-23', 'self_invoice_cancelled', 'SI/26-27/000003', 'Typed twice', 0, 3_000, -401],
			['2026-11-23', 'self_invoice_cancelled', 'SI/26-27/000004', '', 0, 100, -501],
			['2026-11-24', 'self_invoice_payment_cancelled', 'PV/26-27/000008', 'Paid twice', 500, 0, -1],
			['2026-11-24', 'self_invoice_payment_cancelled', 'PV/26-27/000009', '', 1, 0, 0],
		]);
		expect(supplierStatement({ entries: [], payments: [], returns: [] })).toEqual([]);
		// A debit note sent before it had a number still lists its settlements.
		const unnumbered = supplierStatement({
			entries: [],
			payments: [],
			returns: [
				{
					id: 'pr_1',
					status: 'sent',
					sentAt: '2026-11-20T10:00:00.000Z',
					number: null,
					purchaseEntryNumber: null,
					totalINR: 100,
					settlements: [
						{ how: 'refund', amountINR: 40, date: '2026-11-21', reference: null },
						{ how: 'credit_note', amountINR: 60, date: '2026-11-22', reference: null },
					],
				} as never,
			],
		});
		expect(unnumbered.map((r) => [r.kind, r.documentNumber])).toEqual([
			['debit_note', ''],
			['refund_received', ''],
			['credit_note', ''],
		]);
	});
});
