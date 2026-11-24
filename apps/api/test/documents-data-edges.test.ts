import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { OrderDocumentsController } from '../src/documents/order-documents.controller';
import { packingSlipData } from '../src/documents/packing-slip';
import { purchaseOrderData } from '../src/documents/purchase-order';
import { goodsReceiptData, purchaseReturnData } from '../src/documents/purchase-prints';

const seller = { name: 'Saha Textile', lines: [] };
const supplier = {
	id: 'sup_1',
	legalName: 'Bishnupur Weavers Pvt Ltd',
	gstin: '19AAACB1234F1Z5',
	stateCode: '19',
	stateName: 'West Bengal',
	address: { line: '4 Temple Road', city: 'Bishnupur', pin: '722122' },
	phone: '9830000000',
	email: 'orders@bishnupur.test',
} as never;

describe('packing slip, edges', () => {
	it('names lines by any language, then the SKU, and prints no address or courier the order lacks', () => {
		const data = packingSlipData(
			{
				orderNumber: 'ST-1',
				lines: [
					{ sku: 'A-1', title: { bn: 'শাড়ি' }, quantity: 1 },
					{ lineId: 'p', sku: 'B-1', title: {}, quantity: 2, role: 'piece' },
					{ lineId: 'p>f', sku: 'C-1', title: { en: 'Cover' }, quantity: 1, role: 'free', parentLineId: 'p' },
				],
			} as never,
			seller,
			{ parcelNo: 'ST-1/P1', date: '22 Nov 2026' },
		);
		expect(data.rows?.map((row) => [row.cells['item'], row.cells['cameWith']])).toEqual([
			['শাড়ি', 'Line 1'],
			['B-1', 'Line 2'],
			// A piece saved outside a set: the set has no name to print.
			['Cover', 'Free with piece 1 of '],
		]);
		expect(data.parties).toEqual({});
		expect(data.values).not.toHaveProperty('courier');
	});

	it('prints the courier method alone when there is no provider', () => {
		const data = packingSlipData(
			{
				orderNumber: 'ST-2',
				lines: [],
				shipping: { value: 0, currency: 'INR', method: 'Surface' },
				addresses: { delivery: { fullName: 'Asha Roy', line1: '1 Lake Road', city: 'Kolkata', country: 'IN' } },
			} as never,
			seller,
			{ parcelNo: 'ST-2/P1', date: '22 Nov 2026' },
		);
		expect(data.values['courier']).toBe('Surface');
		expect(data.parties['shipTo']?.lines).toEqual(['Asha Roy', '1 Lake Road', 'Kolkata']);
	});
});

describe('purchase order print, edges', () => {
	it('prints the supplier’s address, GSTIN and contact, a metre price and a blank code', () => {
		const data = purchaseOrderData(
			{
				number: 'PO/1',
				supplierName: 'Bishnupur Weavers',
				expectedBy: '2026-12-05',
				deliverTo: 'Main shop',
				noteToSupplier: null,
				createdAt: '2026-11-22T05:10:00.000Z',
				orderedValueINR: 620,
				lines: [
					{
						title: 'Mulmul',
						optionsLabel: '',
						sku: 'FAB-1',
						supplierItemCode: null,
						quantity: 20,
						soldBy: 'metre',
						agreedPriceINR: 310,
						gstRatePct: 5,
					},
				],
			} as never,
			supplier,
			seller,
		);
		expect(data.parties['supplier']?.lines).toEqual([
			'Bishnupur Weavers Pvt Ltd',
			'4 Temple Road, Bishnupur, West Bengal 722122',
			'GSTIN 19AAACB1234F1Z5 (State 19)',
			'9830000000 · orders@bishnupur.test',
		]);
		expect(data.values).not.toHaveProperty('noteToSupplier');
		expect(data.rows?.[0]?.cells).toMatchObject({ item: 'Mulmul', supplierCode: '', rate: '₹310 / m' });
	});
});

describe('purchase prints, edges', () => {
	const line = {
		lineId: 'l1',
		title: 'Baluchari saree',
		optionsLabel: '',
		sku: 'ST-1',
		soldBy: 'piece',
		hsnOnBill: null,
		productHsn: null,
		quantity: 2,
		accepted: null,
		damaged: 0,
		missing: 0,
		unitPriceINR: 100,
		taxableINR: 200,
		gstRatePct: 5,
		lineTotalINR: 210,
	};
	const entry = {
		number: null,
		supplierName: 'Bishnupur Weavers',
		purchaseOrderNumber: null,
		billNumber: 'BW/1',
		billDate: '2026-11-20',
		goodsReceivedOn: '2026-11-22',
		lines: [line, { ...line, lineId: 'l2', hsnOnBill: null, productHsn: '5208' }],
		totals: { taxableINR: 200, cgstINR: 5, sgstINR: 5, igstINR: 0, totalINR: 210 },
	};

	it('a goods receipt not yet posted, with no PO, no HSN and nothing short', () => {
		const data = goodsReceiptData(entry as never, supplier, seller);
		expect(data.number).toBe('Not posted yet');
		expect(data.values).not.toHaveProperty('poNo');
		expect(data.rows?.map((row) => [row.cells['hsn'], row.cells['received']])).toEqual([
			['', '0'],
			['5208', '0'],
		]);
		expect(data.parties['supplier']?.lines).toContain('GSTIN 19AAACB1234F1Z5 (State 19)');
	});

	const doc = {
		number: null,
		challanNumber: null,
		sentAt: null,
		taxType: 'inter_state',
		reason: 'wrong_item',
		noteToSupplier: null,
		purchaseEntryNumber: null,
		supplierName: 'Bishnupur Weavers',
		courier: null,
		docket: null,
		totalINR: 105,
		lines: [
			{
				entryLineId: 'l2',
				title: 'Baluchari saree',
				optionsLabel: '',
				sku: 'ST-1',
				soldBy: 'piece',
				quantity: 1,
				unitCostINR: 100,
				taxableINR: 100,
				taxINR: 5,
				gstRatePct: 5,
				totalINR: 105,
			},
			{
				entryLineId: 'gone',
				title: 'Old line',
				optionsLabel: '',
				sku: 'ST-9',
				soldBy: 'piece',
				quantity: 1,
				unitCostINR: 0,
				taxableINR: 0,
				taxINR: 0,
				gstRatePct: 0,
				totalINR: 0,
			},
		],
	};

	it('a debit note not yet sent: no number, no date, IGST, and the entry without its own number', () => {
		const note = purchaseReturnData('debit-note', doc as never, entry as never, null, seller);
		expect(note).toMatchObject({ number: '', date: '', taxHeading: 'IGST' });
		expect(note.values['originalInvoiceNo']).toBe('Bill BW/1 of 20 Nov 2026 (our )');
		expect(note.rows?.map((row) => row.cells['hsn'])).toEqual(['5208', '']);
	});

	it('a return without its entry prints the entry number alone, or nothing; GST when the tax type is open', () => {
		const known = purchaseReturnData(
			'debit-note',
			{ ...doc, purchaseEntryNumber: 'PE/1', taxType: 'unknown' } as never,
			null,
			null,
			seller,
		);
		expect(known.values['originalInvoiceNo']).toBe('PE/1');
		expect(known.taxHeading).toBe('GST');
		expect(known.rows?.[0]?.cells['hsn']).toBe('');
		const none = purchaseReturnData('debit-note', doc as never, null, null, seller);
		expect(none.values['originalInvoiceNo']).toBe('');
	});

	it('a challan with no courier has no transport; a courier without a docket prints alone', () => {
		const bare = purchaseReturnData('challan', doc as never, null, supplier, seller);
		expect(bare.number).toBe('');
		expect(bare.values).not.toHaveProperty('transport');
		const courier = purchaseReturnData('challan', { ...doc, courier: 'DTDC' } as never, null, null, seller);
		expect(courier.values['transport']).toBe('DTDC');
	});
});

describe('an order’s printed documents', () => {
	const reply = () => {
		const out = { headers: {} as Record<string, string>, body: null as unknown };
		const chain = {
			header: (name: string, value: string) => ((out.headers[name] = value), chain),
			send: (body: unknown) => ((out.body = body), chain),
		};
		return { out, chain: chain as never };
	};
	const formats = {
		seller: vi.fn(async (fallback: unknown) => fallback),
		renderActive: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
	};
	const order = { id: 'ord_1', orderNumber: 'ST-1', lines: [] };

	const controller = (found: unknown, payments: unknown[] = []) =>
		new OrderDocumentsController(
			formats as never,
			{ findById: async () => found } as never,
			{ get: async () => ({ parcel: { separator: '/', letter: 'P' } }) } as never,
			{ listByOrder: async () => payments } as never,
		);

	it('refuses an order it can’t find, for the receipt and the packing slip', async () => {
		await expect(controller(null).receipt('ord_x', 'pay_1', reply().chain)).rejects.toBeInstanceOf(
			NotFoundException,
		);
		await expect(controller(null).packingSlip('ord_x', reply().chain)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('refuses a payment that is not there or has no receipt number yet', async () => {
		await expect(controller(order).receipt('ord_1', 'pay_1', reply().chain)).rejects.toMatchObject({
			response: { code: 'receipt_not_issued' },
		});
		await expect(
			controller(order, [{ id: 'pay_1', receiptNumber: null }]).receipt('ord_1', 'pay_1', reply().chain),
		).rejects.toMatchObject({ response: { code: 'receipt_not_issued' } });
	});

	it('sends the receipt and the packing slip as PDFs named by their numbers', async () => {
		const payment = {
			id: 'pay_1',
			method: 'upi',
			amountINR: 100,
			reference: 'UTR 1',
			gateway: null,
			receivedOn: '2026-11-21',
			receiptNumber: 'RC/26-27/000001',
			recordedAt: '2026-11-21T06:00:00.000Z',
		};
		const sent = reply();
		await controller(order, [{ id: 'other' }, payment]).receipt('ord_1', 'pay_1', sent.chain);
		expect(sent.out.headers['Content-Disposition']).toBe('inline; filename="RC-26-27-000001 receipt.pdf"');
		expect(sent.out.body).toBeInstanceOf(Buffer);
		const slip = reply();
		await controller(order).packingSlip('ord_1', slip.chain);
		expect(slip.out.headers['Content-Disposition']).toBe('inline; filename="ST-1-P1 packing slip.pdf"');
		expect(slip.out.headers['Content-Type']).toBe('application/pdf');
	});
});
