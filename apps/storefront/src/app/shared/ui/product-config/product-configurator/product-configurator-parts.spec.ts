import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { IProduct } from '@data-access/interfaces/product.interface';

import { ProductConfigurator } from './product-configurator';
import { freeWith } from '../set-test-data';

const product = (overrides: Record<string, unknown> = {}) =>
	({ id: 'p1', price: 1000, sale_price: 800, stock_status: 'in_stock', ...overrides }) as unknown as IProduct;

const render = (item: IProduct, initialConfig?: unknown) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
	TestBed.overrideComponent(ProductConfigurator, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductConfigurator);
	fixture.componentRef.setInput('product', item);
	if (initialConfig) fixture.componentRef.setInput('initialConfig', initialConfig);
	fixture.detectChanges();
	return fixture.componentInstance;
};

/** The page's own parts (add-on, set, option buttons), which the template draws, stood in for. */
const withParts = (component: ProductConfigurator) => {
	const addon = { snapshot: vi.fn(() => ({ selections: { blouse: 'one' } })), apply: vi.fn() };
	const set = { snapshot: vi.fn(() => ({ set: { picks: {} } })), apply: vi.fn() };
	const axis = { choose: vi.fn() };
	for (const [name, part] of [
		['addonPart', addon],
		['setPart', set],
		['axis', axis],
	] as const)
		Object.defineProperty(component, name, { value: () => part });
	return { addon, set, axis };
};

describe('ProductConfigurator: its parts and free items', () => {
	it('hands the sheets nothing before the parts are drawn', () => {
		const component = render(product());
		expect(component.addonSnapshot()).toBeNull();
		expect(component.setSnapshot()).toBeNull();
		expect(() => component.applySet({}, {}, false)).not.toThrow();
		expect(() => component.applyAddon({}, {}, false)).not.toThrow();
		expect(() => component.chooseValue({ id: 1 } as never)).not.toThrow();
	});

	it('reads and writes the add-on and set parts for the buy bar’s sheets', () => {
		const component = render(product());
		const { addon, set, axis } = withParts(component);
		expect(component.addonSnapshot()).toEqual({ selections: { blouse: 'one' } });
		expect(component.setSnapshot()).toEqual({ set: { picks: {} } });
		component.applySet({ size: 's' }, { bust: 34 }, true);
		expect(set.apply).toHaveBeenCalledWith({ size: 's' }, { bust: 34 }, true, {});
		component.applySet({}, {}, false, { extras: ['pc'] });
		expect(set.apply).toHaveBeenLastCalledWith({}, {}, false, { extras: ['pc'] });
		component.applyAddon({ blouse: 'one' }, {}, false);
		expect(addon.apply).toHaveBeenCalledWith({ blouse: 'one' }, {}, false);
		component.chooseValue({ id: 3 } as never);
		expect(axis.choose).toHaveBeenCalledWith({ id: 3 });
	});

	it('starts a cart edit from the line’s saved set and free picks', () => {
		const picks = [{ productId: 'pc', variantId: null }];
		const component = render(product(), { raw: { set_choice: { picks: { a: ['x'] } }, free_items: picks } });
		expect(component.setSeed()).toEqual({ picks: { a: ['x'] } });
		expect(component.freeSeed()).toEqual(picks);
		expect(render(product()).freeSeed()).toBeNull();
	});

	it('waits for a required free choice before Add to cart, and sends the picks', () => {
		const component = render(product({ free_with: freeWith({ given: false }) }));
		expect(component.purchasable()).toBe(false);
		component.freeState.set({ picks: [{ productId: 'pc', variantId: 'm' }], valid: true });
		expect(component.purchasable()).toBe(true);
		expect(component.buildParams(1, null).line_config?.raw?.free_items).toEqual([
			{ productId: 'pc', variantId: 'm' },
		]);
		component.freeState.set({ valid: true } as never);
		expect(component.buildParams(1, null).line_config?.raw?.free_items).toEqual([]);
	});
});
