import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrderDraftStore } from '@core/orders/order-draft.store';
import { BundleService } from '@data-access/services/bundle.service';

import { OrderSetPopup } from './order-set-popup';

const item = (key: string, price: number, over: Record<string, unknown> = {}) => ({
	key,
	productId: key,
	title: key,
	quantity: 1,
	priceInSetINR: price,
	todayINR: price,
	saleINR: null,
	soldBy: 'piece',
	inStock: true,
	variantId: null,
	variants: [],
	...over,
});
const page = {
	levels: [
		{
			code: 'a',
			label: 'Saree',
			take: 1,
			choice: true,
			priceMode: 'difference',
			items: [item('s1', 16_400), item('s2', 18_000)],
		},
		{
			code: 'b',
			label: 'Petticoat',
			take: 1,
			choice: false,
			priceMode: 'difference',
			items: [item('p', 450, { variants: [{ id: 'v_m', label: 'M', inStock: true }] })],
		},
	],
	extras: [item('box', 250)],
	pricing: {
		base: { kind: 'pieces' },
		inputs: [],
		methodRules: [],
		methodCombine: 'all',
		params: {},
		rules: [],
		combine: 'all',
		capAtSeparately: false,
		roundTo: 'one',
	},
};

describe('Configure a set on Create order (bundle builder brief E09)', () => {
	it('starts from the first pieces, waits for a size, and closes with the choices', async () => {
		const close = vi.fn();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
				{ provide: BundleService, useValue: { builder: () => of({ page }) } },
			],
		});
		TestBed.overrideComponent(OrderSetPopup, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(OrderSetPopup).componentInstance;
		await popup.start('set1', 'Wedding set');
		expect(popup.picked('a')).toEqual(['s1']);
		expect(popup.quote().totalINR).toBe(16_850);
		expect(popup.ready()).toBe(false);
		popup.setVariant('p', 'v_m');
		popup.pick('a', ['s2']);
		popup.toggleExtra('box');
		expect(popup.quote().totalINR).toBe(18_700);
		expect(popup.ready()).toBe(true);
		popup.done();
		expect(close).toHaveBeenCalledWith({
			picks: { a: ['s2'], b: ['p'] },
			variants: { p: 'v_m' },
			extras: ['box'],
			free: {},
		});
	});

	it('keeps two different sets as two lines and sends the choice to the server', () => {
		sessionStorage.clear();
		const draft = TestBed.inject(OrderDraftStore);
		const choice = (pick: string) => ({ picks: { a: [pick] }, variants: {}, extras: [], free: {} });
		draft.add({ productId: 'set1', variationId: null, quantity: 1, soldBy: 'piece', bundle: choice('s1') });
		draft.add({ productId: 'set1', variationId: null, quantity: 1, soldBy: 'piece', bundle: choice('s2') });
		draft.add({ productId: 'set1', variationId: null, quantity: 1, soldBy: 'piece', bundle: choice('s2') });
		expect(draft.lines().map((line) => line.quantity)).toEqual([1, 2]);
		expect(draft.cartWrite().lines[1]).toMatchObject({ productId: 'set1', bundle: choice('s2') });
	});
});
