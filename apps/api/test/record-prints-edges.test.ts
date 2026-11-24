import { describe, expect, it } from 'vitest';

import { businessReceiptData, journalData, orderReceiptData, placeOfSupply } from '../src/documents/record-prints';

const seller = { name: 'Saha Textile', lines: [] };

describe('receipt vouchers for orders, edges', () => {
	const payment = {
		id: 'pay_1',
		method: 'cheque',
		amountINR: 500,
		reference: null,
		gateway: null,
		receivedOn: null,
		receiptNumber: null,
		recordedAt: '2026-11-21T20:00:00.000Z',
	};

	it('a receipt with no number, the day in India, an unknown method and no reference', () => {
		const data = orderReceiptData(
			{ orderNumber: 'ST-1', buyer: { name: 'Asha Roy' } } as never,
			payment as never,
			seller,
		);
		expect(data).toMatchObject({ number: '', date: '22 Nov 2026' });
		expect(data.values).toMatchObject({ method: 'cheque', reference: '', placeOfSupply: '' });
		expect(data.parties['payer']?.lines).toEqual(['Asha Roy']);
	});

	it('takes the gateway’s reference, the delivery address when there is no billing one, and no buyer at all', () => {
		const delivery = { fullName: 'Asha Roy', line1: '1 Lake Road', city: 'Kolkata', country: 'IN' };
		const data = orderReceiptData(
			{ orderNumber: 'ST-1', addresses: { delivery } } as never,
			{ ...payment, gateway: { reference: 'pay_X' } } as never,
			seller,
		);
		expect(data.values['reference']).toBe('pay_X');
		expect(data.parties['payer']?.lines).toEqual(['Asha Roy', '1 Lake Road', 'Kolkata']);
		const nobody = orderReceiptData({ orderNumber: 'ST-1' } as never, payment as never, seller);
		expect(nobody.parties['payer']?.lines).toEqual([]);
	});

	it('names a State code the GST list does not know by the address’s State, or nothing', () => {
		const address = { fullName: 'A', line1: 'B', country: 'IN', gstStateCode: '99' };
		expect(placeOfSupply({ ...address, state: 'West Bengal' } as never)).toBe('West Bengal (99)');
		expect(placeOfSupply(address as never)).toBe(' (99)');
		expect(placeOfSupply({ ...address, gstStateCode: undefined } as never)).toBe('');
	});
});

describe('receipts on account and journal vouchers, edges', () => {
	const business = {
		legalName: 'Boutique Nila',
		gstin: '99AAACB1234F1Z5',
		registeredAddress: { line: '4 Park Street', city: 'Kolkata', pin: '700016' },
	};
	const entry = {
		side: 'receivable',
		kind: 'receipt',
		amountINR: -100,
		documentNumber: null,
		note: null,
		at: '2026-11-21T06:00:00.000Z',
	};

	it('a business receipt without a note or number, its State unknown to the GST list', () => {
		const data = businessReceiptData(business as never, entry as never, seller);
		expect(data.number).toBe('');
		expect(data.values).toMatchObject({ method: '', reference: '', placeOfSupply: ' (99)' });
		const cheque = businessReceiptData(business as never, { ...entry, note: 'Cheque' } as never, seller);
		expect(cheque.values).toMatchObject({ method: 'Cheque', reference: '' });
	});

	it('a business without a GSTIN has no place of supply and no GSTIN line', () => {
		const data = businessReceiptData({ ...business, gstin: null } as never, entry as never, seller);
		expect(data.values['placeOfSupply']).toBe('');
		expect(data.parties['payer']?.lines).toEqual(['Boutique Nila', '4 Park Street, Kolkata, 700016']);
	});

	it('a journal of a reversal, and an empty journal', () => {
		const reversal = journalData(business as never, [{ ...entry, kind: 'reversal', note: null }] as never, seller);
		expect(reversal.values['narration']).toBe('Set-off reversed');
		expect(reversal.rows?.[0]?.cells['account']).toBe('Receivable from Boutique Nila');
		const empty = journalData(business as never, [], seller);
		expect(empty).toMatchObject({ number: '', date: '' });
		expect(empty.values).toMatchObject({ voucherNo: '', date: '', narration: 'Set-off' });
	});
});
