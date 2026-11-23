import { TaxInvoice } from '@saha-textile/contracts';
import { ourBlocks } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { documentHtml, documentHtmlCopies } from '../src/documents/document-html';
import { taxInvoiceData } from '../src/documents/tax-invoice-print';

const party = { name: 'K.R. Marketing', gstin: '19DBYPS6736R1ZZ', address: 'Barasat', stateCode: '19' };
const invoice = TaxInvoice.parse({
	id: 'ti_1',
	number: 'TI/26-27/000001',
	date: '2026-11-23',
	gstRegistrationId: 'reg_wb',
	gstin: '19DBYPS6736R1ZZ',
	locationId: 'loc_bar',
	orderId: 'ord_1',
	orderNumber: 'ST-2611-000001',
	seller: party,
	buyer: { name: 'Rang Mahal', gstin: '27AAKFR1234M1Z2', address: 'Linking Road, Mumbai', stateCode: '27' },
	placeOfSupply: '27',
	interState: true,
	lines: [
		{
			lineId: 'a',
			sku: 'S1',
			title: 'Saree',
			hsn: '5007',
			quantity: 1,
			unitPriceINR: 36_500,
			ratePercent: 5,
			taxableINR: 34_761.9,
			igstINR: 1_738.1,
			totalINR: 36_500,
		},
	],
	taxableINR: 34_761.9,
	cgstINR: 0,
	sgstINR: 0,
	igstINR: 1_738.1,
	roundOffINR: 0,
	totalINR: 36_500,
	createdAt: '2026-11-23T10:00:00.000Z',
});

describe('tax invoice print (accounts brief D1, AE5)', () => {
	it('prints the copy asked for, IGST and the HSN summary; no band without an IRN, no internal notes', () => {
		const data = taxInvoiceData(invoice, { name: 'K.R. Marketing', lines: [] }, 'duplicate', null);
		expect(data.values).toMatchObject({
			copyLabel: 'Duplicate for transporter',
			placeOfSupply: 'Maharashtra (27)',
		});
		// The CA caveat is for us, on the admin screens; the buyer's copy never carries it.
		expect(data.values['note']).toBeUndefined();
		expect(data.values['irn']).toBeUndefined();
		expect(data.taxHeading).toBe('IGST');
		expect(data.hsnSummary).toEqual([{ hsn: '5007', taxable: '₹34,761.90', rate: '5%', tax: '₹1,738.10' }]);
	});

	it('carries the IRN and QR for the band when the invoice has one', () => {
		const data = taxInvoiceData(invoice, { name: 'K.R. Marketing', lines: [] }, 'original', {
			irn: 'a'.repeat(64),
			ackNo: '112410123456789',
			ackDate: '2026-11-23T10:05:00.000Z',
			signedQrSvg: '<svg/>',
			ewayBill: '341012345678',
		});
		expect(data.values).toMatchObject({
			copyLabel: 'Original for recipient',
			irn: 'a'.repeat(64),
			ewayBill: '341012345678',
		});
		expect(data.qrSvg).toBe('<svg/>');
	});

	it('prints all three copies one after another, each from a new page, without a page counter across them', () => {
		const seller = { name: 'K.R. Marketing', lines: [] };
		const format = { name: 'Standard', paper: 'a4' as const, blocks: ourBlocks('taxInvoice') };
		const brand = { logoSrc: null, themeColor: null, fontFaces: '' };
		const print = (copy: 'original' | 'duplicate' | 'triplicate') => taxInvoiceData(invoice, seller, copy, null);
		const copies = [print('original'), print('duplicate'), print('triplicate')] as const;
		const html = documentHtmlCopies(format, copies, brand);
		expect(html.match(/break-before:page/g)).toHaveLength(2);
		for (const label of ['Original for recipient', 'Duplicate for transporter', 'Triplicate for supplier'])
			expect(html).toContain(label);
		expect(html).not.toContain('counter(pages)');
		expect(documentHtml(format, copies[0]!, brand)).toContain('counter(pages)');
	});

	it('prints CGST and SGST at home, metres as metres, delivery, an export and a State it doesn’t know', () => {
		const home = TaxInvoice.parse({
			...invoice,
			placeOfSupply: '19',
			interState: false,
			buyer: { ...invoice.buyer, gstin: null, stateCode: '19' },
			lines: [
				{ ...invoice.lines[0], unit: 'MTR', quantity: 2.5, cgstINR: 869.05, sgstINR: 869.05, igstINR: 0 },
				{ ...invoice.lines[0], lineId: 'b', cgstINR: 869.05, sgstINR: 869.05, igstINR: 0 },
			],
			cgstINR: 1_738.1,
			sgstINR: 1_738.1,
			igstINR: 0,
			shippingINR: 105,
		});
		const data = taxInvoiceData(home, { name: 'K.R. Marketing', lines: [] }, 'triplicate', null);
		expect(data.taxHeading).toBe('CGST + SGST');
		expect(data.rows?.[0]?.cells['qty']).toBe('2.5 m');
		expect(data.hsnSummary).toHaveLength(1);
		expect(data.totals?.totals?.map((t) => t.label)).toEqual([
			'Taxable value',
			'CGST',
			'SGST',
			'Delivery (incl. GST)',
			'Total',
		]);
		const abroad = taxInvoiceData(
			TaxInvoice.parse({ ...invoice, placeOfSupply: '96', buyer: { ...invoice.buyer, stateCode: '00' } }),
			{ name: 'K.R. Marketing', lines: [] },
			'original',
			null,
		);
		expect(abroad.values['placeOfSupply']).toBe('Outside India (96)');
		expect(abroad.parties?.billTo?.lines).toContain('00 (00)');
	});
});
