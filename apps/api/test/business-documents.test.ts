import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { BusinessDocuments } from '../src/orders-setup/business-documents';

const business = {
	id: 'biz_1',
	legalName: 'Boutique Ltd',
	tradeName: 'Boutique',
	gstin: null,
	stateCode: '19',
	stateName: 'West Bengal',
	registeredAddress: { line: '1 Road', city: 'Kolkata', pin: '700001' },
	contacts: [],
};
const entry = (over: Record<string, unknown>) => ({
	id: 'led_1',
	businessId: 'biz_1',
	side: 'receivable',
	kind: 'receipt',
	amountINR: -500,
	documentType: 'receipt',
	documentId: 'doc_1',
	documentNumber: 'RC/26-27/000001',
	note: 'upi · UTR1',
	at: '2026-11-20T06:00:00.000Z',
	by: 'adm',
	...over,
});

function documents(rows: Record<string, unknown>[], found = true) {
	const rendered: string[] = [];
	const service = new BusinessDocuments(
		{ findById: async () => (found ? business : null) } as never,
		{ list: async (_id: string, side: string) => ({ rows: rows.filter((row) => row['side'] === side) }) } as never,
		{
			seller: async (fallback: unknown) => fallback,
			renderActive: async (doc: string) => {
				rendered.push(doc);
				return new Uint8Array([1]);
			},
		} as never,
	);
	return { service, rendered };
}

describe('a business account’s documents as PDF', () => {
	it('prints a receipt on the receipt format, named by its number', async () => {
		const { service, rendered } = documents([entry({})]);
		expect((await service.pdf('biz_1', 'doc_1')).fileName).toBe('receipt-RC-26-27-000001.pdf');
		expect(rendered).toEqual(['receipt']);
	});

	it('prints a journal voucher from both sides, named by its id when it has no number', async () => {
		const { service, rendered } = documents([
			entry({ documentType: 'journal', kind: 'setOff', documentNumber: null, documentId: 'jv_1' }),
			entry({
				id: 'led_2',
				side: 'payable',
				documentType: 'journal',
				kind: 'setOff',
				documentNumber: null,
				documentId: 'jv_1',
				amountINR: 500,
			}),
		]);
		expect((await service.pdf('biz_1', 'jv_1')).fileName).toBe('journal-jv-1.pdf');
		expect(rendered).toEqual(['journal']);
	});

	it('refuses an unknown business, an unknown document, and an entry that prints with its order', async () => {
		await expect(documents([], false).service.pdf('biz_x', 'doc_1')).rejects.toBeInstanceOf(NotFoundException);
		await expect(documents([]).service.pdf('biz_1', 'doc_1')).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			documents([entry({ documentType: 'order' })]).service.pdf('biz_1', 'doc_1'),
		).rejects.toBeInstanceOf(ConflictException);
	});
});
