import { describe, expect, it, vi } from 'vitest';

import { AccountsPrints } from '../src/ledger/accounts-prints';

/** The picks bar's Print (accounts brief A1): picked documents of one tab, one PDF, drafts and by-hand left out. */

const seller = { name: 'K.R. Marketing', lines: [] };
const store = <T>(rows: Record<string, T>) => ({
	get: vi.fn(async (id: string) => rows[id] ?? null),
	findById: vi.fn(async (id: string) => rows[id] ?? null),
});

function setup() {
	const formats = {
		seller: vi.fn(async () => seller),
		renderActiveCopies: vi.fn(async (_kind: string, pages: unknown[]) => new Uint8Array(pages.length)),
	};
	const order = {
		id: 'ord_1',
		orderNumber: 'ST-2611-514203',
		buyer: { name: 'Meera' },
		addresses: {},
		totalINR: 9560,
	};
	const prints = new AccountsPrints(
		formats as never,
		store({
			pay_1: {
				id: 'pay_1',
				orderId: 'ord_1',
				receiptNumber: 'RC/26-27/000014',
				amountINR: 9560,
				method: 'upi',
				receivedOn: '2026-11-23',
				recordedAt: '2026-11-23T05:00:00.000Z',
				currency: 'INR',
				amount: 9560,
				reference: '4021',
			},
			pay_2: { id: 'pay_2', orderId: 'ord_gone', receiptNumber: 'RC/26-27/000013' },
			pay_3: { id: 'pay_3', orderId: 'ord_1', receiptNumber: null },
		}) as never,
		store({ ord_1: order }) as never,
		store({ pv_1: { id: 'pv_1' } }) as never,
		store({ cn_1: { id: 'cn_1', number: 'CN/1' }, cn_2: { id: 'cn_2', number: null } }) as never,
		store({ dn_1: { id: 'dn_1' } }) as never,
		store({ rf_1: { id: 'rf_1' } }) as never,
		store({ si_1: { id: 'si_1', number: 'SI/1' }, si_2: { id: 'si_2', number: null } }) as never,
		store({
			sa_1: {
				id: 'sa_1',
				kind: 'adjustment',
				number: 'SA/1',
				title: 'Petticoat',
				soldBy: 'piece',
				action: 'remove',
				quantity: 2,
				requestedAt: '2026-11-22T05:00:00.000Z',
				decidedAt: null,
			},
			sa_2: { id: 'sa_2', kind: 'adjustment', number: null },
			cnt_1: { id: 'cnt_1', kind: 'count', number: 'SC/1' },
		}) as never,
	);
	return { prints, formats };
}

vi.mock('../src/documents/credit-note-print', () => ({
	creditNoteData: (note: { id: string }) => ({ doc: 'creditNote', id: note.id }),
	debitNoteData: (note: { id: string }) => ({ doc: 'debitNote', id: note.id }),
}));
vi.mock('../src/documents/refund-voucher-print', () => ({
	refundVoucherData: (voucher: { id: string }) => ({ doc: 'refundVoucher', id: voucher.id }),
}));
vi.mock('../src/documents/self-invoice-print', () => ({
	selfInvoiceData: (invoice: { id: string }) => ({ doc: 'selfInvoice', id: invoice.id }),
	paymentVoucherData: (voucher: { id: string }) => ({ doc: 'paymentVoucher', id: voucher.id }),
}));
vi.mock('../src/documents/record-prints', () => ({
	orderReceiptData: (_order: unknown, payment: { id: string }) => ({ doc: 'receipt', id: payment.id }),
}));

describe('printing the picked documents', () => {
	it('prints each tab’s picked documents on its format, in the order picked, leaving out what has no print', async () => {
		const { prints, formats } = setup();
		const pages = async (tab: Parameters<AccountsPrints['picked']>[0], ids: string[]) => {
			const file = await prints.picked(tab, ids);
			const [kind, sent] = formats.renderActiveCopies.mock.lastCall as [
				string,
				Array<{ id?: string; number?: string }>,
			];
			return { file, kind, ids: sent.map((page) => page.id ?? page.number) };
		};
		expect(await pages('receipts', ['pay_3', 'pay_1', 'pay_2', 'le_1'])).toEqual({
			file: { fileName: 'receipts-1.pdf', data: new Uint8Array(1) },
			kind: 'receipt',
			ids: ['pay_1'],
		});
		expect((await pages('paymentVouchers', ['pv_1', 'jv_p'])).ids).toEqual(['pv_1']);
		expect((await pages('creditNotes', ['cn_2', 'cn_1'])).ids).toEqual(['cn_1']);
		expect((await pages('debitNotes', ['dn_1', 'dn_x'])).ids).toEqual(['dn_1']);
		expect((await pages('refundVouchers', ['rf_1', 'rf_x'])).ids).toEqual(['rf_1']);
		expect((await pages('selfInvoices', ['si_1', 'si_2', 'si_x'])).ids).toEqual(['si_1']);
		const stock = await pages('stockAdjustments', ['sa_1', 'sa_2', 'cnt_1', 'sa_x']);
		expect([stock.kind, stock.ids]).toEqual(['stockAdjustment', ['SA/1']]);
	});

	it('refuses a tab with no print, and a pick with nothing printable', async () => {
		const { prints } = setup();
		await expect(prints.picked('journal', ['jv_1'])).rejects.toMatchObject({
			response: { message: 'list_has_no_print' },
		});
		await expect(prints.picked('creditNotes', ['cn_2'])).rejects.toMatchObject({
			response: { message: 'nothing_to_print' },
		});
	});
});
