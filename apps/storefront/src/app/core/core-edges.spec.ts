import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { productPathForCode } from '@core/catalog/short-address';
import { followHandoff } from '@core/checkout/checkout.gateway';
import { ConsentStore } from '@core/consent/consent.store';
import { cartChildCounts, cartChildRows, cartSetSaving } from '@core/state/cart/cart-children';
import { lineFloor, stepLine, typedLineLength } from '@core/state/cart/metre-line';
import { SettingStore } from '@core/state/setting.store';
import { ICart } from '@data-access/interfaces/cart.interface';
import { SettingService } from '@data-access/services/setting.service';

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('cart lines without children or prices', () => {
	const line = (over: Record<string, unknown>) => ({ product: { sale_price: 900 }, ...over }) as unknown as ICart;

	it('has no rows and counts nothing for a line with no children', () => {
		expect(cartChildRows(line({}))).toEqual([]);
		expect(cartChildCounts(line({}))).toEqual({ pieces: 0, extras: 0, free: 0, folded: 0 });
	});

	it('saves nothing on a set priced from its sale price with no printed price', () => {
		expect(cartSetSaving(line({}))).toBe(0);
		expect(cartSetSaving(line({ product: { sale_price: 900, price: 1200 } }))).toBe(300);
	});
});

describe('metre lines without a cut or a stock figure', () => {
	it('starts at a tenth when the product has no shortest cut, and sets no ceiling without stock', () => {
		expect(lineFloor({ sold_by: 'metre', shortest_cut_tenths: undefined } as never)).toBe(1);
		const line = { sold_by: 'metre', shortest_cut_tenths: 10, quantity: 20 } as never;
		expect(stepLine(line, 1)).toEqual({ kind: 'change', delta: 5 });
		expect(typedLineLength(line, '900')).toBe(9000);
	});
});

describe('the short address lookup', () => {
	it('answers null for a body without a slug', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{"name":"x"}')),
		);
		expect(await productPathForCode('https://api.test', 'X')).toBeNull();
	});
});

describe('the gateway hand-off', () => {
	it('leaves a PayPal order to the PayPal buttons on the page', () => {
		const doc = { location: { assign: vi.fn() }, createElement: vi.fn() } as unknown as Document;
		followHandoff({ kind: 'paypal-sdk', paypalOrderId: 'PP-1' }, doc);
		expect(doc.location.assign).not.toHaveBeenCalled();
		expect(doc.createElement).not.toHaveBeenCalled();
	});
});

describe('SettingStore currencies', () => {
	it('falls back to the first currency when the shop no longer sells the choice and has no rupees', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: SettingService, useValue: { getSettingOption: () => of({ values: {} }) } },
				{ provide: PLATFORM_ID, useValue: 'browser' },
				{ provide: ConsentStore, useValue: { allows: () => true } },
			],
		});
		const store = TestBed.inject(SettingStore);
		store.setCurrency({ code: 'EUR', symbol: '€', exchange_rate: 0.011 } as never);
		const usd = { code: 'USD', symbol: 'US$', exchange_rate: 0.012 };
		store.useCurrencies([usd] as never);
		expect(store.selectedCurrency()).toEqual(usd);
	});
});
