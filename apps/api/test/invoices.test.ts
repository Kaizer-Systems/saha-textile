import type { Order } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { InvoicesService } from '../src/invoicing/invoices.service';

const order = (hsn: string | null): Order =>
	({
		id: 'ord_1',
		orderNumber: 'ST-2611-000001',
		currency: 'INR',
		status: 'packed',
		paymentStatus: 'paid',
		shipsFromLocationId: 'loc_bar',
		buyer: { kind: 'business', name: 'Rang Mahal', gstin: '27AAKFR1234M1Z2' },
		addresses: {
			billing: {
				fullName: 'Rang Mahal',
				line1: 'Linking Road',
				city: 'Mumbai',
				postalCode: '400050',
				country: 'IN',
				gstStateCode: '27',
			},
			delivery: {
				fullName: 'Rang Mahal',
				line1: 'Linking Road',
				city: 'Mumbai',
				postalCode: '400050',
				country: 'IN',
				gstStateCode: '27',
			},
		},
		shipping: { chargeINR: 0 },
		lines: [
			{
				lineId: 'a',
				productId: 'p1',
				variationId: 'v1',
				title: { en: 'Katan Banarasi Saree' },
				sku: 'ST-KAT-0901',
				quantity: 1,
				unitPriceINR: 36_500,
				unitPricePaid: 36_500,
				lineTotalINR: 36_500,
				lineTotalPaid: 36_500,
				unitCostINR: 20_000,
				...(hsn ? { tax: { hsn } } : {}),
			},
		],
		subtotalINR: 36_500,
		subtotalPaid: 36_500,
		totalINR: 36_500,
		totalPaid: 36_500,
	}) as unknown as Order;

const setup = (on: boolean) => {
	const inserted: unknown[] = [];
	const posted: { lines: { debitPaise?: number; creditPaise?: number }[] }[] = [];
	const service = new InvoicesService(
		{
			findByShipment: async () => null,
			listForOrder: async () => [],
			insert: async (i: unknown) => void inserted.push(i),
		} as never,
		{
			getFeatures: async () => ({ on: { tax_invoices: on } }),
			getRegistration: async () => ({ id: 'reg_wb', gstin: '19DBYPS6736R1ZZ', stateCode: '19' }),
			findRegistrationByGstin: async () => null,
		} as never,
		{
			list: async () => [
				{
					id: 'loc_bar',
					active: true,
					warehouse: true,
					shipsOnline: true,
					gstRegistrationId: 'reg_wb',
					address: '11/1A K.B. Bose Road',
					city: 'Barasat',
					pin: '700124',
					createdAt: '2026-11-23T00:00:00.000Z',
				},
			],
		} as never,
		{
			get: async () => ({ tradeName: 'K.R. Marketing', legalName: 'Proprietor', gstin: '19DBYPS6736R1ZZ' }),
		} as never,
		{ findById: async () => ({ hsnCode: null }) } as never,
		{ issue: async (_t: string, _c: unknown, _at: Date, scope?: string) => `TI/26-27/000001@${scope}` } as never,
		{
			post: async (request: { lines: { debitPaise?: number; creditPaise?: number }[] }) => (
				posted.push(request),
				{ id: 'jv_1' }
			),
		} as never,
	);
	return { service, inserted, posted };
};
const dispatch = (o: Order) => ({
	order: o,
	shipmentId: 'shp_1',
	lineIds: ['a'],
	actorId: 'adm_owner',
	at: '2026-11-23T10:00:00.000Z',
});

describe('tax invoices at dispatch (accounts brief D1, D3)', () => {
	it('issues nothing while Tax invoices at dispatch is off', async () => {
		const { service, inserted } = setup(false);
		expect(await service.issueAtDispatch(dispatch(order('5007')), {} as never)).toBeNull();
		expect(inserted).toHaveLength(0);
	});

	it('issues a numbered invoice per GSTIN with IGST to another State, posted and balanced', async () => {
		const { service, inserted, posted } = setup(true);
		const invoice = await service.issueAtDispatch(dispatch(order('5007')), {} as never);
		expect(invoice).toMatchObject({
			number: 'TI/26-27/000001@reg_wb',
			gstin: '19DBYPS6736R1ZZ',
			placeOfSupply: '27',
			interState: true,
			cgstINR: 0,
			igstINR: 1_738.1,
			totalINR: 36_500,
			ratesPendingCa: true,
			voucherId: 'jv_1',
		});
		expect(inserted).toHaveLength(1);
		const lines = posted[0]?.lines ?? [];
		const debit = lines.reduce((s, l) => s + (l.debitPaise ?? 0), 0);
		const credit = lines.reduce((s, l) => s + (l.creditPaise ?? 0), 0);
		expect(debit).toBe(credit);
	});

	it('refuses to ship a line with no HSN, naming its SKU', async () => {
		const { service } = setup(true);
		await expect(service.issueAtDispatch(dispatch(order(null)), {} as never)).rejects.toThrow(
			'invoice_problem:hsn_missing:ST-KAT-0901',
		);
	});
});
