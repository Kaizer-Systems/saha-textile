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
	const inserted: { id: string; shipmentId: string | null; status: string; lines: { lineId: string }[] }[] = [];
	const posted: { lines: { debitPaise?: number; creditPaise?: number }[] }[] = [];
	const service = new InvoicesService(
		{
			findByShipment: async (shipmentId: string) => inserted.find((i) => i.shipmentId === shipmentId) ?? null,
			listForOrder: async () => [...inserted],
			insert: async (i: never) => void inserted.push(i),
			get: async (id: string) => inserted.find((i) => i.id === id) ?? null,
			list: async () => ({ items: [], total: 0 }),
			linkShipment: async (id: string, shipmentId: string) => {
				const invoice = inserted.find((i) => i.id === id);
				if (!invoice || invoice.shipmentId) throw new Error('invoice_already_linked');
				invoice.shipmentId = shipmentId;
			},
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
			voucher: async () => ({
				id: 'jv_1',
				number: 'JV/26-27/000003',
				totalPaise: 5_650_000,
				lines: [
					{ ledgerId: 'l_adv', locationId: 'loc_bar', debitPaise: 3_650_000, creditPaise: 0 },
					{ ledgerId: 'l_cogs', locationId: 'loc_bar', debitPaise: 2_000_000, creditPaise: 0 },
				],
			}),
			chart: async () => ({
				ledgers: [
					{ id: 'l_adv', name: 'Customer advances', systemKey: 'customer_advances' },
					{ id: 'l_cogs', name: 'Cost of goods sold', systemKey: 'cost_of_goods_sold' },
				],
			}),
		} as never,
		{ withTransaction: async <T>(work: (context: never) => Promise<T>) => work({} as never) } as never,
		{ advanceHeldINR: async () => 10_000_000 } as never,
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

	it('issues the invoice when a packed order’s e-way bill is generated, and Shipped ties it to the parcel (EI5B)', async () => {
		const { service, inserted } = setup(true);
		expect(await service.issueBeforeDispatch({ ...order('5007'), status: 'processing' }, 'adm_owner')).toBeNull();
		const early = await service.issueBeforeDispatch(order('5007'), 'adm_owner', '2026-11-23T09:00:00.000Z');
		expect(early).toMatchObject({ shipmentId: null, date: '2026-11-23' });
		// Pressing Generate again doesn't issue a second invoice.
		expect((await service.issueBeforeDispatch(order('5007'), 'adm_owner'))?.id).toBe(early?.id);
		const shipped = await service.issueAtDispatch(dispatch(order('5007')), {} as never);
		expect(shipped?.id).toBe(early?.id);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]?.shipmentId).toBe('shp_1');
		expect((await service.currentFor('ord_1'))?.id).toBe(early?.id);
	});

	it('shows the posted lines by name and the checks it passed (Q5)', async () => {
		const { service } = setup(true);
		const invoice = await service.issueAtDispatch(dispatch(order('5007')), {} as never);
		const view = await service.accounting(invoice?.id ?? '');
		expect(view.lines[0]).toMatchObject({ ledgerName: 'Customer advances', locationName: 'loc_bar' });
		expect(Object.fromEntries(view.checks.map((c) => [c.key, c.ok]))).toEqual({
			period_open: true,
			number_in_series: true,
			place_of_supply: true,
			stock_at_cost: true,
			rates: false,
			cancel: false,
		});
		expect(view.checks.find((c) => c.key === 'place_of_supply')?.params).toEqual({
			from: 'West Bengal',
			to: 'Maharashtra',
			tax: 'IGST',
		});
	});
});

describe('a counter sale is invoiced at once (accounts brief P2)', () => {
	it('issues every line now, in the sale’s transaction, and refuses while the switch is off', async () => {
		const { service, inserted } = setup(true);
		const sale = order('5007');
		// A set's own line is never invoiced; its pieces are.
		const withSet = {
			...sale,
			lines: [...sale.lines, { ...sale.lines[0]!, lineId: 'set_1', role: 'bundle' as const }],
		};
		const invoice = await service.issueAtCounter(
			withSet as never,
			'adm_priya',
			'2026-11-23T06:10:00.000Z',
			{} as never,
		);
		expect(invoice.shipmentId).toBeNull();
		expect(invoice.lines.map((l) => l.lineId)).not.toContain('set_1');
		expect(inserted).toHaveLength(1);
		await expect(
			setup(false).service.issueAtCounter(order('5007'), null, '2026-11-23T06:10:00.000Z', {} as never),
		).rejects.toThrow('tax_invoices_off');
	});
});

describe('what a counter invoice will say, before it is made (accounts brief P1)', () => {
	it('takes the tax out of each line in the store’s State, leaves a set’s own line out, and names lines it can’t take', async () => {
		const { service } = setup(true);
		const lines = order('5007').lines;
		const preview = await service.counterPreview([
			...lines,
			{ ...lines[0]!, lineId: 'set_1', role: 'bundle' as const },
		] as never);
		// ₹36,500 at 5%: taxable 34,761.90, CGST and SGST 869.05 each.
		expect(preview).toEqual({
			totals: { taxableINR: 34_761.9, cgstINR: 869.05, sgstINR: 869.05 },
			problems: [],
		});
		expect((await service.counterPreview(order(null).lines as never)).problems).toEqual([
			{ sku: 'ST-KAT-0901', problem: 'hsn_missing' },
		]);
	});
});
