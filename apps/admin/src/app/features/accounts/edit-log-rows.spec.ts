import { describe, expect, it } from 'vitest';

import { editLogRows, logWhen } from './edit-log-rows';

import type { EditLogEntry } from '@saha-textile/contracts';

/** Q11's table from a document's audit rows. */

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key);
const inr = (value: number) => `₹${value}`;
const at = '2026-11-25T05:11:00.000Z';
const entry = (action: string, patch: Partial<EditLogEntry> = {}): EditLogEntry => ({
	at,
	who: 'Meera',
	role: 'Store manager',
	action,
	diffs: [],
	metadata: {},
	...patch,
});

describe('the edit log rows (Q11)', () => {
	it('writes when as day, month and time', () => {
		expect(logWhen(at)).toMatch(/^25 Nov \d{2}:\d{2}$/);
	});

	it('names the role the first time a person appears, and the system as System', () => {
		const rows = editLogRows(
			[
				entry('creditNote.draft', { metadata: { from: 'R1' } }),
				entry('creditNote.save'),
				entry('creditNote.print', { who: 'Sudip', role: null }),
				entry('creditNote.posted', {
					who: null,
					role: null,
					metadata: {
						stock: [{ sku: 'BAN-3', quantity: 1 }],
						outputTaxINR: 222.86,
						inputTaxINR: 0,
						refund: 'due',
						totalINR: 4680,
					},
				}),
			],
			t,
			inr,
		);
		expect(rows.map((r) => [r.who, r.what, r.after])).toEqual([
			['Meera (Store manager)', 'log_drafted', 'log_from_return{"number":"R1"}'],
			['Meera', 'log_saved', '—'],
			['Sudip', 'log_printed', 'PDF'],
			[
				'log_system',
				'log_posted',
				'log_posted_stock{"items":"+1 BAN-3"} · log_posted_tax{"amount":"₹222.86"} · log_posted_refund_due{"amount":"₹4680"}',
			],
		]);
	});

	it('gives each changed field its own row with before and after', () => {
		const rows = editLogRows(
			[
				entry('creditNote.save', {
					diffs: [
						{ field: 'quantity:Cotton Handloom Saree', before: 1, after: 0 },
						{ field: 'reason', before: 'Damaged', after: null },
					],
				}),
			],
			t,
			inr,
		);
		expect(rows.map((r) => [r.what, r.field, r.before, r.after])).toEqual([
			['log_edited', 'Cotton Handloom Saree · log_field_qty', '1', '0'],
			['log_edited', 'log_field_reason', 'Damaged', '—'],
		]);
	});

	it('words drafts of each kind, issue, refusals, cancels, refunds, debit notes, locks and anything else', () => {
		const rows = editLogRows(
			[
				entry('creditNote.draft', { metadata: { kind: 'price_adjustment' } }),
				entry('creditNote.draft'),
				entry('creditNote.issue', { metadata: { number: 'CN/1' } }),
				entry('creditNote.posted', {
					metadata: { stock: [], outputTaxINR: 4.76, inputTaxINR: 156, refund: 'kept', totalINR: 100 },
				}),
				entry('orderReturn.print'),
				entry('creditNote.cancel_refused', { metadata: { why: ['superAdmin', 'monthFiled'] } }),
				entry('creditNote.cancel', { metadata: { reason: 'Wrong invoice' } }),
				entry('creditNote.refund', { metadata: { reference: 'UTR1' } }),
				entry('debitNote.issue', { metadata: { number: 'DN/1', reason: 'Filed' } }),
				entry('document.lock.take_over', { diffs: [{ field: 'holder', before: 'Meera', after: 'Owner' }] }),
				entry('document.lock.take_over'),
				entry('document.lock.ask_release'),
				entry('creditNote.delete'),
			],
			t,
			inr,
		);
		expect(rows.map((r) => [r.what, r.field, r.before, r.after, r.why])).toEqual([
			['log_drafted', '—', '—', 'cn_kind_price_adjustment', '—'],
			['log_drafted', '—', '—', 'cn_kind_goods_returned', '—'],
			['log_issued', 'log_field_number', '—', 'CN/1', '—'],
			[
				'log_posted',
				'log_field_books',
				'—',
				'log_posted_tax{"amount":"₹4.76"} · log_posted_input_tax{"amount":"₹156"} · log_posted_refund_kept{"amount":"₹100"}',
				'—',
			],
			['log_printed', '—', '—', 'PDF', '—'],
			['log_tried_cancel', '—', '—', 'log_refused{"why":"log_refused_superAdmin, log_refused_monthFiled"}', '—'],
			['log_cancelled', '—', '—', '—', 'Wrong invoice'],
			['log_refunded', 'log_field_refund', '—', 'UTR1', '—'],
			['log_debit_note', 'log_field_number', '—', 'DN/1', 'Filed'],
			['log_took_over', '—', 'Meera', 'Owner', '—'],
			['log_took_over', '—', '—', '—', '—'],
			['log_asked_release', '—', '—', '—', '—'],
			['creditNote.delete', '—', '—', '—', '—'],
		]);
	});

	it('words a refund voucher’s issue, the gateway’s answer, retries, payment by hand and prints', () => {
		const rows = editLogRows(
			[
				entry('refundVoucher.issue', { metadata: { reason: 'order_cancelled', number: 'RF/1' } }),
				entry('refundVoucher.outcome', { who: null, metadata: { how: 'gateway', status: 'failed' } }),
				entry('refundVoucher.retry', { diffs: [{ field: 'status', before: 'failed', after: 'refunded' }] }),
				entry('refundVoucher.by_hand'),
				entry('refundVoucher.print'),
			],
			t,
			inr,
		);
		expect(rows.map((r) => [r.what, r.field, r.before, r.after])).toEqual([
			['log_rf_issued_order_cancelled', 'log_field_number', '—', 'RF/1'],
			['log_rf_outcome_gateway_failed', '—', '—', '—'],
			['log_rf_retry', 'log_field_status', 'rf_status_failed', 'rf_status_refunded'],
			['log_rf_by_hand', 'log_field_status', '—', '—'],
			['log_printed', '—', '—', 'PDF'],
		]);
	});
});
