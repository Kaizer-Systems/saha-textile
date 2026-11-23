import { CreditNote, DebitNote, OrderReturn } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { creditNoteData, debitNoteData, returnNoteData } from '../src/documents/credit-note-print';
import { CreditNotesController, ReturnsController } from '../src/returns/returns.controller';

/** The returns routes, the credit note routes and the note prints (accounts brief B1–B11). */

const line = (patch: Record<string, unknown> = {}) => ({
	lineId: 'a',
	sku: 'BAN-3',
	title: 'Banarasi Silk Saree',
	hsn: '5007',
	quantity: 1,
	unitPriceINR: 4_680,
	ratePercent: 5,
	taxableINR: 4_457.14,
	cgstINR: 111.43,
	sgstINR: 111.43,
	totalINR: 4_680,
	...patch,
});
const base = {
	date: '2026-11-25',
	gstRegistrationId: 'reg_wb',
	gstin: '19DBYPS6736R1ZZ',
	locationId: 'loc_bar',
	orderId: 'ord_1',
	orderNumber: 'ST-2611-482190',
	invoiceId: 'ti_1',
	invoiceNumber: 'TI/26-27/000145',
	buyer: { name: 'Ananya Das', gstin: null, address: 'Kolkata', stateCode: '19' },
	placeOfSupply: '19',
	interState: false,
	taxableINR: 4_457.14,
	cgstINR: 111.43,
	sgstINR: 111.43,
	igstINR: 0,
	roundOffINR: 0,
	totalINR: 4_680,
	createdAt: '2026-11-25T05:00:00.000Z',
};
const note = CreditNote.parse({
	...base,
	id: 'cn_1',
	number: 'CN/26-27/000012',
	status: 'issued',
	kind: 'goods_returned',
	invoiceDate: '2026-11-18',
	reason: 'Damaged on arrival',
	refundTo: 'original_payment',
	lines: [
		line(),
		line({
			lineId: 'delivery',
			sku: '',
			hsn: '996812',
			delivery: true,
			totalINR: 0,
			taxableINR: 0,
			cgstINR: 0,
			sgstINR: 0,
			unitPriceINR: 0,
			ratePercent: 0,
		}),
	],
	deadline: '2027-11-30',
});
const debit = DebitNote.parse({
	...base,
	id: 'dn_1',
	number: 'DN/26-27/000001',
	creditNoteId: 'cn_1',
	creditNoteNumber: 'CN/26-27/000012',
	reason: 'October already filed',
	interState: true,
	placeOfSupply: '96',
	buyer: { name: 'Rang Mahal', gstin: '27AAKFR1234M1Z2', address: 'Mumbai', stateCode: '27' },
	lines: [line({ unit: 'MTR', quantity: 2.5, igstINR: 222.86, cgstINR: 0, sgstINR: 0 })],
	cgstINR: 0,
	sgstINR: 0,
	igstINR: 222.86,
});
const seller = { name: 'K.R. Marketing', lines: [] };

describe('note prints (Rule 53)', () => {
	it('prints a credit note quoting its invoice, CGST and SGST, the delivery share and where the money goes', () => {
		const data = creditNoteData(note, seller);
		expect(data.values).toMatchObject({
			noteNo: 'CN/26-27/000012',
			originalInvoiceNo: 'TI/26-27/000145',
			placeOfSupply: 'West Bengal (19)',
			refundTo: 'The original payment',
		});
		expect(data.taxHeading).toBe('CGST + SGST');
		expect(data.rows?.map((r) => r.cells['item'])).toEqual(['Banarasi Silk Saree', 'Delivery charge share']);
		expect(data.rows?.[1]?.cells['qty']).toBe('—');
		expect(data.hsnSummary).toHaveLength(1);
		expect(data.totals?.totals.at(-1)).toEqual({ label: 'Credited', value: '₹4,680.00' });
		expect(creditNoteData({ ...note, number: null, refundTo: 'customer_account' }, seller)).toMatchObject({
			number: 'Draft',
			values: { refundTo: 'Kept on the customer’s account' },
		});
		expect(creditNoteData({ ...note, refundTo: 'bank_transfer' }, seller).values['refundTo']).toBe(
			'A bank transfer to the customer',
		);
	});

	it('prints a debit note to the buyer, in IGST, metres as metres, saying which note it undoes', () => {
		const data = debitNoteData(debit, seller);
		expect(data.values['reason']).toBe('October already filed (undoes credit note CN/26-27/000012)');
		expect(data.taxHeading).toBe('IGST');
		expect(data.rows?.[0]?.cells['qty']).toBe('2.5 m');
		expect(data.parties?.['party']?.lines).toContain('GSTIN 27AAKFR1234M1Z2');
		expect(
			debitNoteData({ ...debit, buyer: { ...debit.buyer, stateCode: '96' } }, seller).parties?.['party']?.lines,
		).toContain('Outside India (96)');
		expect(
			debitNoteData({ ...debit, buyer: { ...debit.buyer, stateCode: '00' } }, seller).parties?.['party']?.lines,
		).toContain('00 (00)');
	});
});

const entry = OrderReturn.parse({
	id: 'ret_1',
	number: 'ST-2611-482190/R1',
	orderId: 'ord_1',
	orderNumber: 'ST-2611-482190',
	invoiceId: 'ti_1',
	invoiceNumber: 'TI/26-27/000145',
	status: 'checked',
	lines: [
		{
			lineId: 'a',
			sku: 'BAN-3',
			title: 'Banarasi',
			quantity: 1,
			unitPriceINR: 4_680,
			outcome: 'damaged',
			note: 'Zari pulled',
		},
		{ lineId: 'b', sku: 'COT-1', title: 'Cotton', quantity: 2, unitPriceINR: 1_000 },
	],
	reason: 'damaged_on_arrival',
	how: 'pickup',
	refundTo: 'original_payment',
	createdAt: '2026-11-22T05:00:00.000Z',
	updatedAt: '2026-11-22T05:00:00.000Z',
});

describe('return note print (B3)', () => {
	it('prints what came back, its condition, the reason in words and where the refund goes', () => {
		const data = returnNoteData(entry, { buyer: note.buyer }, seller);
		expect(data.values).toMatchObject({
			returnNo: 'ST-2611-482190/R1',
			orderNo: 'ST-2611-482190',
			date: '22 Nov 2026',
			reason: 'Damaged on arrival',
			refund: '₹6,680.00 to the original payment',
		});
		expect(data.rows?.map((r) => r.cells['condition'])).toEqual([
			'Damaged, kept (not for sale): Zari pulled',
			'Not checked yet',
		]);
		expect(data.parties?.['customer']?.lines).toContain('Ananya Das');
		expect(returnNoteData({ ...entry, note: 'Box torn' }, { buyer: note.buyer }, seller).values['reason']).toBe(
			'Damaged on arrival: Box torn',
		);
	});
});

describe('returns routes', () => {
	const calls: unknown[][] = [];
	const service = new Proxy(
		{ returnNote: async () => ({ entry, invoice: { buyer: note.buyer } }) },
		{
			get: (target, name) =>
				(target as Record<string | symbol, unknown>)[name] ??
				((...args: unknown[]) => (calls.push([name, ...args]), Promise.resolve(name))),
		},
	);
	const formats = { seller: async () => seller, renderActive: async () => new Uint8Array([37]) };
	const routes = new ReturnsController(service as never, formats as never);
	const principal = { userId: 'adm_1' } as never;

	it('passes each route to the service with who is acting', async () => {
		expect(await routes.view('ord_1')).toBe('view');
		await routes.start('ord_1', {} as never, principal);
		await routes.start('ord_1', {} as never);
		await routes.priceAdjustment('ord_1', {} as never, principal);
		await routes.priceAdjustment('ord_1', {} as never);
		await routes.undelivered('ord_1', 'shp_1', principal);
		await routes.undelivered('ord_1', 'shp_1');
		await routes.getReturn('ret_1');
		await routes.step('ret_1', { to: 'received' }, principal);
		await routes.step('ret_1', { to: 'received' });
		await routes.check('ret_1', { lines: [] }, principal);
		await routes.check('ret_1', { lines: [] });
		await routes.creditNoteFromReturn('ret_1', principal);
		await routes.creditNoteFromReturn('ret_1');
		expect(calls.map((c) => c[0])).toEqual([
			'view',
			'start',
			'start',
			'priceAdjustment',
			'priceAdjustment',
			'undelivered',
			'undelivered',
			'getReturn',
			'step',
			'step',
			'check',
			'check',
			'fromReturn',
			'fromReturn',
		]);
		expect(calls[1]?.at(-1)).toBe('adm_1');
		expect(calls[2]?.at(-1)).toBeNull();
	});

	it('prints the return note named by its number, and logs the print', async () => {
		const headers: Record<string, string> = {};
		const reply = {
			header(name: string, value: string) {
				headers[name] = value;
				return this;
			},
			send: () => undefined,
		};
		await routes.returnNotePdf('ret_1', reply as never, principal);
		await routes.returnNotePdf('ret_1', reply as never);
		expect(headers['Content-Disposition']).toBe('inline; filename="ST-2611-482190-R1 return note.pdf"');
		expect(calls.slice(-2)).toEqual([
			['printed', 'orderReturn', 'ret_1', 'adm_1'],
			['printed', 'orderReturn', 'ret_1', null],
		]);
	});
});

describe('credit note routes', () => {
	const calls: unknown[][] = [];
	const service = new Proxy(
		{ creditNote: async () => note, debitNoteById: async () => debit },
		{
			get: (target, name) =>
				(target as Record<string | symbol, unknown>)[name] ??
				((...args: unknown[]) => (calls.push([name, ...args]), Promise.resolve(name))),
		},
	);
	const rendered: string[] = [];
	const formats = {
		seller: async () => seller,
		renderActive: async (doc: string) => (rendered.push(doc), new Uint8Array([37])),
	};
	const editLog = { entries: async (type: string, id: string) => [type, id] };
	const routes = new CreditNotesController(service as never, formats as never, editLog as never);
	const principal = { userId: 'adm_1' } as never;
	const reply = () => {
		const headers: Record<string, string> = {};
		return {
			headers,
			header(name: string, value: string) {
				headers[name] = value;
				return this;
			},
			send: () => undefined,
		};
	};

	it('lists, reads, saves, deletes, issues, checks, cancels and undoes, with who is acting', async () => {
		await routes.list({ from: '2026-11-01', to: '2026-11-30', search: '', status: null, page: 1, pageSize: 25 });
		expect(await routes.get('cn_1')).toBe(note);
		await routes.save('cn_1', { version: 0, lines: [] }, principal);
		await routes.save('cn_1', { version: 0, lines: [] });
		await routes.remove('cn_1', principal);
		await routes.remove('cn_1');
		await routes.issue('cn_1', { version: 0 }, principal);
		await routes.issue('cn_1', { version: 0 });
		await routes.cancelChecks('cn_1', principal);
		await routes.cancel('cn_1', { reason: 'Wrong invoice' }, principal);
		await routes.refund('cn_1', { how: 'gateway' }, principal);
		await routes.refund('cn_1', { how: 'gateway' });
		await routes.debitNote('cn_1', { reason: 'October filed' }, principal);
		await routes.debitNote('cn_1', { reason: 'October filed' });
		expect(await routes.getDebitNote('dn_1')).toBe(debit);
		expect(calls.map((c) => c[0])).toEqual([
			'listCreditNotes',
			'saveDraft',
			'saveDraft',
			'deleteDraft',
			'deleteDraft',
			'issue',
			'issue',
			'cancelChecks',
			'cancel',
			'refund',
			'refund',
			'debitNote',
			'debitNote',
		]);
	});

	it('prints a credit note and a debit note as PDFs named by their numbers', async () => {
		const first = reply();
		await routes.creditNotePdf('cn_1', first as never, principal);
		await routes.creditNotePdf('cn_1', reply() as never);
		expect(calls.slice(-2)).toEqual([
			['printed', 'creditNote', 'cn_1', 'adm_1'],
			['printed', 'creditNote', 'cn_1', null],
		]);
		expect(first.headers['Content-Disposition']).toBe('inline; filename="CN-26-27-000012.pdf"');
		const second = reply();
		await routes.debitNotePdf('dn_1', second as never);
		expect(second.headers['Content-Type']).toBe('application/pdf');
		expect(rendered).toEqual(['creditNote', 'creditNote', 'debitNote']);
		expect(await routes.creditNoteLog('cn_1')).toEqual(['creditNote', 'cn_1']);
	});
});
