import { NotFoundException } from '@nestjs/common';
import type { Order, TaxInvoice } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { InvoicesService } from '../src/invoicing/invoices.service';

/** Every fallback of issuing and reading tax invoices (accounts brief D1, Q5), one case each. */

const REG = { id: 'reg_wb', gstin: '19DBYPS6736R1ZZ', stateCode: '19' };
const BARASAT = {
	id: 'loc_bar',
	name: 'Barasat warehouse',
	active: true,
	warehouse: true,
	shipsOnline: true,
	gstRegistrationId: 'reg_wb',
	address: '11/1A K.B. Bose Road',
	city: 'Barasat',
	pin: '700124',
	createdAt: '2026-11-23T00:00:00.000Z',
};

type Line = Partial<Order['lines'][number]> & Record<string, unknown>;
const saree = (patch: Line = {}): Line => ({
	lineId: 'a',
	productId: 'p1',
	title: { en: 'Katan Banarasi Saree' },
	sku: 'ST-KAT-0901',
	quantity: 1,
	lineTotalINR: 10_500,
	unitCostINR: 6_000,
	tax: { hsn: '5007' },
	...patch,
});
const orderOf = (patch: Record<string, unknown> = {}): Order =>
	({
		id: 'ord_1',
		orderNumber: 'ST-2611-000001',
		status: 'packed',
		paymentStatus: 'unpaid',
		shipsFromLocationId: 'loc_bar',
		buyer: { kind: 'person', name: 'Ananya Das', gstin: null },
		addresses: {
			delivery: {
				fullName: 'Ananya Das',
				line1: 'Salt Lake',
				city: 'Kolkata',
				postalCode: '700091',
				gstStateCode: '19',
			},
		},
		shipping: { chargeINR: 105 },
		lines: [saree()],
		...patch,
	}) as unknown as Order;

interface Options {
	issued?: TaxInvoice[];
	locations?: unknown[];
	registration?: unknown;
	byGstin?: unknown;
	shop?: unknown;
	product?: unknown;
	listed?: unknown[];
	voucher?: unknown;
	chart?: unknown;
}

function setup(options: Options = {}) {
	const stored: TaxInvoice[] = [...(options.issued ?? [])];
	const posted: { lines: { systemKey: string }[] }[] = [];
	const service = new InvoicesService(
		{
			findByShipment: async (id: string) => stored.find((i) => i.shipmentId === id) ?? null,
			listForOrder: async () => [...stored],
			insert: async (invoice: TaxInvoice) => void stored.push(invoice),
			get: async (id: string) => stored.find((i) => i.id === id) ?? null,
			list: async () => ({ items: options.listed ?? [], total: 0 }),
			linkShipment: async (id: string, shipmentId: string) => {
				const invoice = stored.find((i) => i.id === id);
				if (invoice) invoice.shipmentId = shipmentId;
			},
		} as never,
		{
			getFeatures: async () => ({ on: { tax_invoices: true } }),
			getRegistration: async () => ('registration' in options ? options.registration : REG),
			findRegistrationByGstin: async () => options.byGstin ?? null,
		} as never,
		{ list: async () => options.locations ?? [BARASAT] } as never,
		{
			get: async () => ('shop' in options ? options.shop : { tradeName: 'K.R. Marketing', gstin: REG.gstin }),
		} as never,
		{
			findById: async () => {
				if (options.product === 'throws') throw new Error('gone');
				return options.product ?? { hsnCode: null };
			},
		} as never,
		{ issue: async () => `TI/26-27/00000${stored.length + 1}` } as never,
		{
			post: async (request: { lines: { systemKey: string }[] }) => (posted.push(request), { id: 'jv_1' }),
			voucher: async () => {
				if (options.voucher === 'throws') throw new Error('gone');
				return options.voucher;
			},
			chart: async () => options.chart ?? { ledgers: [] },
		} as never,
		{ withTransaction: async <T>(work: (context: never) => Promise<T>) => work({} as never) } as never,
	);
	const ship = (order: Order, shipmentId = 'shp_1', lineIds = ['a']) =>
		service.issueAtDispatch(
			{ order, shipmentId, lineIds, actorId: null, at: '2026-11-23T10:00:00.000Z' },
			{} as never,
		);
	return { service, stored, posted, ship };
}

describe('issuing a tax invoice: every fallback (D1)', () => {
	it('takes the default location, the shop GSTIN’s registration, the legal name, and the delivery name', async () => {
		const { ship } = setup({
			locations: [{ ...BARASAT, gstRegistrationId: null }],
			byGstin: REG,
			shop: { tradeName: '', legalName: 'Legal Name', gstin: REG.gstin },
		});
		const invoice = await ship(orderOf({ shipsFromLocationId: undefined, buyer: undefined }));
		expect(invoice).toMatchObject({
			locationId: 'loc_bar',
			gstRegistrationId: 'reg_wb',
			seller: { name: 'Legal Name' },
			buyer: { name: 'Ananya Das', gstin: null },
			interState: false,
		});
		expect(invoice?.cgstINR).toBeGreaterThan(0);
	});

	it('names the seller by GSTIN and the buyer "Customer" when nothing else is known, and taxes in the seller’s State', async () => {
		const { ship } = setup({ shop: { tradeName: '', legalName: '', gstin: null } });
		const invoice = await ship(orderOf({ buyer: undefined, addresses: undefined, shipping: undefined }));
		expect(invoice).toMatchObject({
			seller: { name: REG.gstin },
			buyer: { name: 'Customer', address: '' },
			placeOfSupply: '19',
			shippingINR: 0,
		});
	});

	it('refuses with no location to ship from, or no GST registration for it', async () => {
		await expect(setup().ship(orderOf({ shipsFromLocationId: 'loc_x' }))).rejects.toThrow(
			'invoice_problem:no_location',
		);
		await expect(setup({ registration: null, shop: null }).ship(orderOf())).rejects.toThrow(
			'invoice_problem:no_gst_registration',
		);
		await expect(
			setup({ locations: [{ ...BARASAT, gstRegistrationId: null }], shop: { gstin: null } }).ship(orderOf()),
		).rejects.toThrow('invoice_problem:no_gst_registration');
	});

	it('sends an order abroad as an export (place of supply 96), with the delivery State otherwise', async () => {
		const abroad = orderOf({
			addresses: {
				delivery: { fullName: 'A', line1: 'Main St', city: 'Austin', postalCode: '73301', country: 'US' },
			},
		});
		expect(await setup().ship(abroad)).toMatchObject({ placeOfSupply: '96', interState: true });
		const unknownState = orderOf({
			addresses: { delivery: { fullName: 'A', line1: 'X', city: 'Y', country: 'IN' } },
		});
		expect(await setup().ship(unknownState)).toMatchObject({ placeOfSupply: '19', interState: false });
	});

	it('reads the HSN from the product when the line has none, and names the piece when it can’t', async () => {
		const fromProduct = setup({ product: { hsnCode: '5007' } });
		expect((await fromProduct.ship(orderOf({ lines: [saree({ tax: undefined })] })))?.lines[0]?.hsn).toBe('5007');
		await expect(
			setup({ product: 'throws' }).ship(orderOf({ lines: [saree({ tax: undefined })] })),
		).rejects.toThrow('invoice_problem:hsn_missing:ST-KAT-0901');
	});

	it('titles a line in another language or by its SKU, and counts an uncosted piece at nothing', async () => {
		const { ship, posted } = setup();
		const invoice = await ship(
			orderOf({
				lines: [
					saree({ title: { bn: 'কাতান শাড়ি' }, unitCostINR: undefined }),
					saree({ lineId: 'b', title: {}, sku: 'ST-B' }),
				],
			}),
			'shp_1',
			['a', 'b'],
		);
		expect(invoice?.lines.map((l) => l.title)).toEqual(['কাতান শাড়ি', 'ST-B']);
		expect(posted[0]?.lines.filter((l) => l.systemKey === 'cost_of_goods_sold')).toHaveLength(1);
	});

	it('refuses a parcel of only a set’s own line: nothing to invoice', async () => {
		await expect(setup().ship(orderOf({ lines: [saree({ role: 'bundle' })] }))).rejects.toThrow(
			/^invoice_problem:no_lines$/,
		);
	});

	it('charges delivery on the first invoice only, and never invoices a line twice', async () => {
		const { ship, stored } = setup();
		const order = orderOf({ lines: [saree(), saree({ lineId: 'b', sku: 'ST-B' })] });
		expect((await ship(order, 'shp_1', ['a']))?.shippingINR).toBe(105);
		expect((await ship(order, 'shp_1', ['a']))?.id).toBe(stored[0]?.id);
		expect((await ship(order, 'shp_2', ['b']))?.shippingINR).toBe(0);
		expect(await ship(order, 'shp_3', ['a'])).toBeNull();
	});

	it('ties a waiting invoice to the parcel and invoices only the lines added since', async () => {
		const { service, ship, stored } = setup();
		const waiting = await service.issueBeforeDispatch(orderOf(), null, '2026-11-23T09:00:00.000Z');
		const grown = orderOf({ lines: [saree(), saree({ lineId: 'b', sku: 'ST-B' })] });
		const second = await ship(grown, 'shp_1', ['a', 'b']);
		expect(stored).toHaveLength(2);
		expect(stored[0]?.shipmentId).toBe('shp_1');
		expect(second).toMatchObject({ shipmentId: null, lines: [{ lineId: 'b' }] });
		expect(waiting?.id).toBe(stored[0]?.id);
		expect(await service.issueBeforeDispatch(grown, null)).toMatchObject({ id: second?.id });
	});

	it('issues nothing before dispatch when every line is already invoiced', async () => {
		const { service, ship } = setup();
		await ship(orderOf());
		expect(await service.issueBeforeDispatch(orderOf(), null)).toBeNull();
		expect((await service.currentFor('ord_1'))?.shipmentId).toBe('shp_1');
		expect(await setup().service.currentFor('ord_1')).toBeNull();
	});
});

describe('reading a tax invoice and its books view: every fallback (Q5)', () => {
	const base = async (options: Options = {}, patch: Partial<TaxInvoice> = {}) => {
		const made = setup(options);
		const invoice = await made.ship(orderOf());
		Object.assign(made.stored[0] ?? {}, patch);
		return { ...made, id: invoice?.id ?? '' };
	};

	it('passes an order’s list through, and refuses an unknown invoice', async () => {
		const { service } = setup();
		expect(await service.listForOrder('ord_1')).toEqual([]);
		await expect(service.get('ti_x')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('shows no lines for an invoice not posted, or whose voucher can’t be read', async () => {
		const unposted = await base({}, { voucherId: null });
		expect(await unposted.service.accounting(unposted.id)).toMatchObject({
			voucherId: null,
			voucherNumber: null,
			lines: [],
			totalPaise: 0,
			checks: expect.arrayContaining([{ key: 'period_open', ok: false, params: { month: '2026-11' } }]),
		});
		const unreadable = await base({ voucher: 'throws' });
		expect((await unreadable.service.accounting(unreadable.id)).lines).toEqual([]);
	});

	it('names ledgers and locations it knows, and shows the ids of ones it doesn’t', async () => {
		const made = await base({
			voucher: {
				id: 'jv_1',
				number: 'JV/26-27/000003',
				totalPaise: 100,
				lines: [
					{ ledgerId: 'l_known', locationId: 'loc_bar', debitPaise: 100, creditPaise: 0 },
					{ ledgerId: 'l_gone', locationId: 'loc_gone', debitPaise: 0, creditPaise: 100 },
				],
			},
			chart: { ledgers: [{ id: 'l_known', name: 'Sundry debtors', systemKey: 'debtors_control' }] },
		});
		const view = await made.service.accounting(made.id);
		expect(view.lines.map((l) => [l.ledgerName, l.locationName])).toEqual([
			['Sundry debtors', 'Barasat warehouse'],
			['l_gone', 'loc_gone'],
		]);
		expect(view.checks.find((c) => c.key === 'stock_at_cost')).toMatchObject({ ok: false });
	});

	it('says where the goods went, CGST and SGST at home, a shipped invoice and confirmed rates', async () => {
		const made = await base({}, { ratesPendingCa: false });
		const checks = (await made.service.accounting(made.id)).checks;
		expect(checks.find((c) => c.key === 'place_of_supply')?.params).toEqual({
			from: 'West Bengal',
			to: 'West Bengal',
			tax: 'CGST + SGST',
		});
		expect(checks.find((c) => c.key === 'rates')?.ok).toBe(true);
		expect(checks.find((c) => c.key === 'cancel')?.params).toEqual({ shipped: 'yes' });
		const waiting = await base({}, { shipmentId: null });
		expect((await waiting.service.accounting(waiting.id)).checks.at(-1)?.params).toEqual({ shipped: 'no' });
		const abroad = await base(
			{},
			{ placeOfSupply: '96', seller: { ...REG, name: 'S', address: '', stateCode: '00' } },
		);
		expect(
			(await abroad.service.accounting(abroad.id)).checks.find((c) => c.key === 'place_of_supply')?.params,
		).toMatchObject({
			from: '00',
			to: 'Outside India',
		});
	});

	it('finds the number before it in the same series, a gap, or none for a number without a counter', async () => {
		const previous = { number: 'TI/26-27/000004', gstin: REG.gstin };
		const found = await base({ listed: [previous] }, { number: 'TI/26-27/000005' });
		expect((await found.service.accounting(found.id)).checks[1]).toEqual({
			key: 'number_in_series',
			ok: true,
			params: { previous: 'TI/26-27/000004' },
		});
		const gap = await base({ listed: [{ ...previous, gstin: '16AAAAA0000A1Z5' }] }, { number: 'TI/26-27/000005' });
		expect((await gap.service.accounting(gap.id)).checks[1]).toMatchObject({ ok: false, params: {} });
		const plain = await base({}, { number: 'TI/NO-COUNTER' });
		expect((await plain.service.accounting(plain.id)).checks[1]).toMatchObject({ ok: true, params: {} });
	});
});
