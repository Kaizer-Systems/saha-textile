import type { Order, TaxInvoice } from '@saha-textile/contracts';
import { TaxInvoice as TaxInvoiceSchema } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { taxInvoiceData } from '../src/documents/tax-invoice-print';
import { InvoicesService } from '../src/invoicing/invoices.service';

/**
 * G2: a GSTIN under composition issues bills of supply (no tax charged, the composition declaration) and sells only
 * inside its State; a sale elsewhere is refused before anything is numbered or posted.
 */

const COMPOSITION = {
	id: 'reg_c',
	gstin: '19AAACC1234A1Z5',
	stateCode: '19',
	legalName: 'K.R. Marketing',
	terms: [{ from: '2026-04-01', kind: 'composition', scheme: 'monthly', compositionRatePercent: 1 }],
};
const BARASAT = {
	id: 'loc_bar',
	name: 'Barasat warehouse',
	active: true,
	warehouse: true,
	shipsOnline: true,
	gstRegistrationId: 'reg_c',
	createdAt: '2026-11-23T00:00:00.000Z',
};
const orderOf = (delivery: Record<string, unknown>): Order =>
	({
		id: 'ord_1',
		orderNumber: 'ST-2611-000001',
		status: 'packed',
		shipsFromLocationId: 'loc_bar',
		buyer: { kind: 'person', name: 'Ananya Das', gstin: null },
		addresses: {
			delivery: {
				fullName: 'Ananya Das',
				line1: 'Salt Lake',
				city: 'Kolkata',
				postalCode: '700091',
				...delivery,
			},
		},
		shipping: { chargeINR: 0 },
		lines: [
			{
				lineId: 'a',
				productId: 'p1',
				title: { en: 'Katan Banarasi Saree' },
				sku: 'ST-KAT-0901',
				quantity: 1,
				lineTotalINR: 10_500,
				unitCostINR: 6_000,
				tax: { hsn: '5007', ratePercent: null, taxableINR: null, taxINR: null },
			},
		],
	}) as unknown as Order;

function setup() {
	const stored: TaxInvoice[] = [];
	const posted: unknown[] = [];
	const service = new InvoicesService(
		{
			findByShipment: async () => null,
			listForOrder: async () => [...stored],
			insert: async (invoice: TaxInvoice) => void stored.push(invoice),
		} as never,
		{
			getFeatures: async () => ({ on: { tax_invoices: true } }),
			getRegistration: async () => COMPOSITION,
			findRegistrationByGstin: async () => null,
		} as never,
		{ list: async () => [BARASAT] } as never,
		{ get: async () => ({ tradeName: 'K.R. Marketing', gstin: COMPOSITION.gstin }) } as never,
		{ findById: async () => ({ hsnCode: '5007' }) } as never,
		{ issue: async () => 'TI/26-27/000001' } as never,
		{
			post: async (request: unknown) => (posted.push(request), { id: 'jv_1' }),
			chart: async () => ({ ledgers: [] }),
		} as never,
		{ withTransaction: async <T>(work: (context: never) => Promise<T>) => work({} as never) } as never,
		{ advanceHeldINR: async () => 0 } as never,
	);
	const ship = (order: Order) =>
		service.issueAtDispatch(
			{ order, shipmentId: 'shp_1', lineIds: ['a'], actorId: null, at: '2026-11-23T10:00:00.000Z' },
			{} as never,
		);
	return { service, stored, posted, ship };
}

describe('invoicing under composition', () => {
	it('issues a bill of supply with no tax inside the State', async () => {
		const { ship } = setup();
		const bill = await ship(orderOf({ gstStateCode: '19' }));
		expect(bill).toMatchObject({ billOfSupply: true, interState: false, cgstINR: 0, sgstINR: 0, igstINR: 0 });
		expect(bill?.totalINR).toBe(10_500);
	});

	it('refuses a sale to another State or abroad, before numbering or posting anything', async () => {
		const refused = { response: { message: 'invoice_problem:composition_inter_state' } };
		for (const delivery of [{ gstStateCode: '27' }, { country: 'US', gstStateCode: null }]) {
			const { ship, stored, posted } = setup();
			await expect(ship(orderOf(delivery))).rejects.toMatchObject(refused);
			expect([stored, posted]).toEqual([[], []]);
		}
	});
});

describe('printing a bill of supply', () => {
	const party = { name: 'K.R. Marketing', gstin: COMPOSITION.gstin, address: 'Barasat', stateCode: '19' };
	const bill = TaxInvoiceSchema.parse({
		id: 'ti_1',
		number: 'TI/26-27/000001',
		date: '2026-11-23',
		gstRegistrationId: 'reg_c',
		gstin: COMPOSITION.gstin,
		locationId: 'loc_bar',
		orderId: 'ord_1',
		orderNumber: 'ST-2611-000001',
		seller: party,
		buyer: { name: 'Ananya Das', gstin: null, address: 'Salt Lake', stateCode: '19' },
		placeOfSupply: '19',
		interState: false,
		billOfSupply: true,
		lines: [
			{
				lineId: 'a',
				sku: 'S1',
				title: 'Saree',
				hsn: '5007',
				quantity: 1,
				unitPriceINR: 10_500,
				ratePercent: 0,
				taxableINR: 10_500,
				totalINR: 10_500,
			},
		],
		taxableINR: 10_500,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 10_500,
		createdAt: '2026-11-23T10:00:00.000Z',
	});

	it('is titled a bill of supply, shows no tax rows and carries the composition declaration', () => {
		const data = taxInvoiceData(bill, { name: 'K.R. Marketing', lines: [] }, 'original', null);
		expect(data.title).toBe('Bill of supply');
		expect(data.totals?.totals?.map((t) => t.label)).toEqual(['Taxable value', 'Total']);
		expect(data.signatures?.declaration).toMatch(
			/^Composition taxable person, not eligible to collect tax on supplies\./,
		);
	});

	it('stays a tax invoice with its tax rows otherwise', () => {
		const data = taxInvoiceData(
			{ ...bill, billOfSupply: false },
			{ name: 'K.R. Marketing', lines: [] },
			'original',
			null,
		);
		expect(data.title).toBe('Tax invoice');
		expect(data.totals?.totals?.map((t) => t.label)).toEqual(['Taxable value', 'CGST', 'SGST', 'Total']);
		expect(data.signatures?.declaration).toMatch(/^We declare/);
	});
});
