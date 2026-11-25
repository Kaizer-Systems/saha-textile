import type { Order, TaxInvoice } from '@saha-textile/contracts';
import { TaxInvoice as TaxInvoiceSchema } from '@saha-textile/contracts';
import { ourBlocks } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { documentHtml } from '../src/documents/document-html';
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

function setup(options: { locations?: unknown[]; registration?: unknown } = {}) {
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
			getRegistration: async () => ('registration' in options ? options.registration : COMPOSITION),
			findRegistrationByGstin: async () => null,
		} as never,
		{ list: async () => options.locations ?? [BARASAT] } as never,
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

describe('a counter quote', () => {
	const LINES = orderOf({}).lines;
	const taxOf = async (
		options: Parameters<typeof setup>[0],
		locationId: string | null,
		day = '2026-11-23',
	): Promise<number> => {
		const { totals } = await setup(options).service.counterPreview(LINES, locationId, day);
		return totals.cgstINR + totals.sgstINR;
	};

	it('shows no tax for a store whose GSTIN is under composition on the day', async () => {
		expect(await taxOf({}, 'loc_bar')).toBe(0);
		// Before its terms began the GSTIN was not under composition.
		expect(await taxOf({}, 'loc_bar', '2026-03-31')).toBeGreaterThan(0);
	});

	it('charges tax without a store, a store with no GSTIN, an unknown store or an unknown registration', async () => {
		expect(await taxOf({}, null)).toBeGreaterThan(0);
		expect(await taxOf({ locations: [{ ...BARASAT, gstRegistrationId: null }] }, 'loc_bar')).toBeGreaterThan(0);
		expect(await taxOf({}, 'loc_gone')).toBeGreaterThan(0);
		expect(await taxOf({ registration: null }, 'loc_bar')).toBeGreaterThan(0);
		const { totals } = await setup().service.counterPreview(LINES);
		expect(totals.cgstINR).toBeGreaterThan(0);
	});
});

const party = { name: 'K.R. Marketing', gstin: COMPOSITION.gstin, address: 'Barasat', stateCode: '19' };
/** A bill of supply as issued (before parsing). */
const BILL = {
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
};

describe('printing a bill of supply', () => {
	const bill = TaxInvoiceSchema.parse(BILL);

	it('is titled a bill of supply, shows no tax rows and carries the composition declaration', () => {
		const data = taxInvoiceData(bill, { name: 'K.R. Marketing', lines: [] }, 'original', null);
		expect(data.title).toBe('Bill of supply');
		expect(data.hideColumns).toEqual(['gstRate', 'tax']);
		expect(data.taxHeading).toBeUndefined();
		expect(data.hsnSummary).toEqual([]);
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
		expect(data.hideColumns).toBeUndefined();
		expect(data.taxHeading).toBe('CGST + SGST');
		expect(data.hsnSummary).toHaveLength(1);
		expect(data.totals?.totals?.map((t) => t.label)).toEqual(['Taxable value', 'CGST', 'SGST', 'Total']);
		expect(data.signatures?.declaration).toMatch(/^We declare/);
	});
});

describe('the printed table of a bill of supply', () => {
	it('leaves out the GST rate and tax columns the format shows, and keeps them on a tax invoice', () => {
		const seller = { name: 'K.R. Marketing', lines: [] };
		const format = { name: 'Standard', paper: 'a4' as const, blocks: ourBlocks('taxInvoice') };
		const brand = { logoSrc: null, themeColor: null, fontFaces: '' };
		const head = (invoice: TaxInvoice) =>
			/<table class="dz-table"><thead><tr>(.*?)<\/tr>/.exec(
				documentHtml(format, taxInvoiceData(invoice, seller, 'original', null), brand),
			)?.[1] ?? '';
		const bill = TaxInvoiceSchema.parse(BILL);
		const invoice = { ...bill, billOfSupply: false };
		const columns = (html: string) => html.match(/<th/g)?.length ?? 0;
		expect(columns(head(invoice)) - columns(head(bill))).toBe(2);
		expect(head(invoice)).toContain('CGST + SGST');
		expect(head(bill)).not.toContain('CGST + SGST');
	});
});
