import { Reflector } from '@nestjs/core';
import { TaxInvoice } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { CounterController } from '../src/counter/counter.controller';
import { CounterModule } from '../src/counter/counter.module';
import { CounterDeskService, placeOf } from '../src/counter/counter-desk.service';

/** The counter's desk (accounts brief P1): where a person sells, what a scan found, and the items priced with tax. */

const store = (id: string, patch: Record<string, unknown> = {}) => ({
	id,
	name: `Store ${id}`,
	active: true,
	city: 'Kolkata',
	stateCode: '19',
	...patch,
});
const box = (id: string, locationId: string, patch: Record<string, unknown> = {}) => ({
	id,
	locationId,
	ledgerId: `led_${id}`,
	kind: 'day_sheet',
	active: true,
	...patch,
});

const PRICED = {
	lineId: 'a',
	productId: 'p_a',
	variationId: null,
	title: 'Tant',
	sku: 'TNT',
	quantity: 1,
	soldBy: 'piece',
	unitPriceINR: 1250,
	lineTotalINR: 1250,
	mrpINR: null,
	setHeading: null,
	children: [],
	options: [],
	measurements: [],
	addons: [],
};

const party = { name: 'K.R. Marketing', gstin: '19DBYPS6736R1ZZ', address: 'Gariahat', stateCode: '19' };
const INVOICE = TaxInvoice.parse({
	id: 'ti_9',
	number: 'TI/26-27/000153',
	date: '2026-11-23',
	gstRegistrationId: 'reg_wb',
	gstin: party.gstin,
	locationId: 'loc_gar',
	orderId: 'ord_c',
	orderNumber: 'ST-2611-000009',
	seller: party,
	buyer: { name: 'Shreya Ghosh', gstin: null, address: 'Kolkata', stateCode: '19' },
	placeOfSupply: '19',
	interState: false,
	lines: [
		{
			lineId: 'a',
			sku: 'TNT',
			title: 'Tant',
			hsn: '5208',
			quantity: 1,
			unitPriceINR: 1_250,
			ratePercent: 5,
			taxableINR: 1_190.48,
			cgstINR: 29.76,
			sgstINR: 29.76,
			totalINR: 1_250,
		},
	],
	taxableINR: 1_190.48,
	cgstINR: 29.76,
	sgstINR: 29.76,
	igstINR: 0,
	roundOffINR: 0,
	totalINR: 1_250,
	createdAt: '2026-11-23T06:10:00.000Z',
});
const ORDERS: Record<string, unknown> = {
	ord_c: { id: 'ord_c', channel: 'counter', shipsFromLocationId: 'loc_gar' },
	ord_far: { id: 'ord_far', channel: 'counter', shipsFromLocationId: null },
	ord_new: { id: 'ord_new', channel: 'counter', shipsFromLocationId: 'loc_gar' },
	ord_shop: { id: 'ord_shop', channel: 'shop', shipsFromLocationId: 'loc_gar' },
};

function setup(scope: { all: boolean; ids: string[]; current: string | null }) {
	const price = vi.fn(async () => ({
		lines: [PRICED],
		subtotalINR: 1250.004,
	}));
	const renderActiveCopies = vi.fn(async () => new Uint8Array([37]));
	const counterPreview = vi.fn(async () => ({
		totals: { taxableINR: 1190.48, cgstINR: 29.76, sgstINR: 29.76 },
		problems: [{ sku: 'TNT', problem: 'hsn_missing' }],
	}));
	const facts = new Map<string, unknown>([
		[
			'TNT-WHT',
			{
				productId: 'p_tnt',
				variantId: 'v_tnt_wht',
				sku: 'TNT-WHT',
				title: { en: 'Tant cotton saree' },
				optionsLabel: 'white',
				productType: 'variable',
				soldBy: 'piece',
			},
		],
		[
			'HLC',
			{
				productId: 'p_hlc',
				variantId: 'v_hlc',
				sku: 'HLC',
				title: { bn: 'হ্যান্ডলুম' },
				optionsLabel: '',
				productType: 'simple',
				soldBy: 'metre',
			},
		],
		[
			'NONAME',
			{
				productId: 'p_x',
				variantId: 'v_x',
				sku: 'NONAME',
				title: {},
				optionsLabel: '',
				productType: 'simple',
				soldBy: 'piece',
			},
		],
		[
			'SET-1',
			{ productId: 'p_set', variantId: 'v_set', sku: 'SET-1', title: { en: 'Set' }, productType: 'bundle' },
		],
	]);
	const service = new CounterDeskService(
		{ price } as never,
		{
			counterPreview,
			listForOrder: async (id: string) =>
				id === 'ord_new' ? [{ ...INVOICE, status: 'cancelled' }] : [{ ...INVOICE, status: 'issued' }],
		} as never,
		{ scope: async () => scope } as never,
		{
			list: async () => [
				store('loc_gar'),
				store('loc_bar', { city: '', stateCode: '19' }),
				store('loc_old', { active: false }),
				store('loc_wh'),
				store('loc_far'),
			],
		} as never,
		{
			boxes: async () => [
				box('petty', 'loc_gar', { kind: 'fixed_float' }),
				box('till', 'loc_gar'),
				box('till2', 'loc_gar'),
				box('till_bar', 'loc_bar'),
				box('gone', 'loc_wh', { active: false }),
				box('till_old', 'loc_old'),
				box('till_far', 'loc_far'),
			],
			openSheet: async (id: string) => (id === 'till2' ? { id: 'sh1' } : null),
		} as never,
		{
			bySku: async (codes: string[]) => new Map(codes.flatMap((c) => (facts.has(c) ? [[c, facts.get(c)]] : []))),
		} as never,
		{ findById: async (id: string) => ORDERS[id] ?? null } as never,
		{ seller: async () => ({ name: 'K.R. Marketing', lines: [] }), renderActiveCopies } as never,
	);
	return { service, price, counterPreview, renderActiveCopies };
}

describe('where a person sells over a counter', () => {
	it('lists the active stores in reach with a day-sheet box, says whether a sheet is open, and keeps the chip’s store', async () => {
		const staff = setup({ all: false, ids: ['loc_gar', 'loc_bar', 'loc_wh'], current: 'loc_gar' });
		expect(await staff.service.here(undefined)).toEqual({
			current: 'loc_gar',
			stores: [
				{ locationId: 'loc_gar', name: 'Store loc_gar', place: 'Kolkata, West Bengal', sheetOpen: true },
				{ locationId: 'loc_bar', name: 'Store loc_bar', place: 'West Bengal', sheetOpen: false },
			],
		});
		const owner = setup({ all: true, ids: [], current: 'loc_wh' });
		const seen = await owner.service.here(undefined);
		expect(seen.current).toBeNull();
		expect(seen.stores.map((s) => s.locationId)).toEqual(['loc_gar', 'loc_bar', 'loc_far']);
	});

	it('words a store’s place from its city and State, either may be missing', () => {
		expect(placeOf({ city: 'Kolkata', stateCode: '19' })).toBe('Kolkata, West Bengal');
		expect(placeOf({ city: 'Kolkata', stateCode: '00' })).toBe('Kolkata');
	});
});

describe('a scanned code', () => {
	it('is a SKU exactly: a variant, a simple product, never a set or an unknown code', async () => {
		const { service } = setup({ all: true, ids: [], current: null });
		expect(await service.scan('TNT-WHT')).toEqual({
			productId: 'p_tnt',
			variationId: 'v_tnt_wht',
			sku: 'TNT-WHT',
			title: 'Tant cotton saree · white',
			soldBy: 'piece',
		});
		expect(await service.scan('HLC')).toMatchObject({ variationId: null, title: 'হ্যান্ডলুম', soldBy: 'metre' });
		expect((await service.scan('NONAME')).title).toBe('NONAME');
		await expect(service.scan('SET-1')).rejects.toThrow('counter_code_unknown');
		await expect(service.scan('NOPE')).rejects.toThrow('counter_code_unknown');
	});
});

describe('the counter’s items priced with their tax', () => {
	it('prices as the sale will, with the invoice’s tax and the lines it can’t take, only at a store in reach', async () => {
		const { service, price, counterPreview } = setup({ all: false, ids: ['loc_gar'], current: null });
		const lines = [{ productId: 'p_a', variationId: null, quantity: 1, scanned: true }];
		expect(await service.quote({ locationId: 'loc_gar', lines }, undefined)).toEqual({
			lines: [PRICED],
			taxableINR: 1190.48,
			cgstINR: 29.76,
			sgstINR: 29.76,
			totalINR: 1250,
			problems: [{ sku: 'TNT', problem: 'hsn_missing' }],
		});
		expect(price).toHaveBeenCalledWith(
			{ buyer: null, currency: 'INR', lines: [{ ...lines[0], addons: [] }] },
			expect.any(Date),
		);
		expect(counterPreview).toHaveBeenCalledOnce();
		expect(await service.quote({ locationId: 'loc_gar', lines: [] }, undefined)).toMatchObject({ totalINR: 0 });
		await expect(service.quote({ locationId: 'loc_bar', lines }, undefined)).rejects.toThrow(
			'location_out_of_scope',
		);
		const owner = setup({ all: true, ids: [], current: null });
		await expect(owner.service.quote({ locationId: 'loc_bar', lines: [] }, undefined)).resolves.toBeTruthy();
	});
});

describe('a counter sale’s print', () => {
	it('prints the original on the format’s paper or the roll, only a counter sale at a store in reach', async () => {
		const { service, renderActiveCopies } = setup({ all: false, ids: ['loc_gar'], current: null });
		expect(await service.print('ord_c', 'roll80', undefined)).toEqual({
			bytes: new Uint8Array([37]),
			fileName: 'TI-26-27-000153.pdf',
		});
		const [kind, copies, paper] = renderActiveCopies.mock.lastCall as unknown as [
			string,
			{ values: Record<string, string> }[],
			string,
		];
		expect([kind, copies[0]?.values['copyLabel'], paper]).toEqual([
			'taxInvoice',
			'Original for recipient',
			'roll80',
		]);
		await expect(service.print('ord_shop', null, undefined)).rejects.toThrow('counter_sale_not_found');
		await expect(service.print('ord_none', null, undefined)).rejects.toThrow('counter_sale_not_found');
		await expect(service.print('ord_new', null, undefined)).rejects.toThrow('counter_sale_not_found');
		await expect(service.print('ord_far', null, undefined)).rejects.toThrow('location_out_of_scope');
		const owner = setup({ all: true, ids: [], current: null });
		await expect(owner.service.print('ord_far', null, undefined)).resolves.toBeTruthy();
	});
});

describe('counter desk routes', () => {
	it('are behind cash.count and wired into the API', async () => {
		const desk = {
			here: vi.fn(async () => 'here'),
			scan: vi.fn(async () => 'scan'),
			quote: vi.fn(async () => 'quote'),
		};
		const controller = new CounterController({} as never, desk as never);
		const principal = { userId: 'adm_priya' } as never;
		expect(await controller.here(principal)).toBe('here');
		expect(await controller.scan({ code: 'TNT' })).toBe('scan');
		expect(desk.scan).toHaveBeenCalledWith('TNT');
		expect(await controller.quote({ locationId: 'loc_gar', lines: [] }, principal)).toBe('quote');
		const headers: Record<string, string> = {};
		let sent: unknown = null;
		const reply = {
			header(name: string, value: string) {
				headers[name] = value;
				return this;
			},
			send: (body: unknown) => void (sent = body),
		};
		const print = vi.fn(async () => ({ bytes: new Uint8Array([37]), fileName: 'TI-26-27-000153.pdf' }));
		const printing = new CounterController({} as never, { print } as never);
		await printing.print('ord_c', 'roll80', reply as never, principal);
		await printing.print('ord_c', 'a3', reply as never, principal);
		expect(print.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['roll80', null]);
		expect(headers['Content-Disposition']).toBe('inline; filename="TI-26-27-000153.pdf"');
		expect(sent).toBeInstanceOf(Buffer);
		for (const route of ['here', 'scan', 'quote', 'print'] as const)
			expect(new Reflector().get(PERMISSIONS_KEY, CounterController.prototype[route])).toEqual(['cash.count']);
		expect(Reflect.getMetadata('providers', CounterModule)).toContain(CounterDeskService);
	});
});
