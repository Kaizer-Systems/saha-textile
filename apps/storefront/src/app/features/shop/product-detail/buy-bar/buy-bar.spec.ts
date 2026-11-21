import { CurrencyPipe } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { BuyBar } from './buy-bar';

const host = (overrides: Record<string, unknown> = {}) => ({
	product: signal({ name: 'Royal Blue Suit', product_thumbnail: { original_url: 'thumb.webp' } }),
	summary: signal(null),
	displayPrice: signal(1200),
	comparePrice: signal(1500),
	discount: signal(20),
	purchasable: signal(true),
	soldOut: signal(false),
	rule: signal(null),
	length: signal(0),
	productQty: 2,
	lengthOf: (tenths: number) => `${tenths / 10} m`,
	updateQuantity: vi.fn(),
	addToCart: vi.fn(),
	buyNow: vi.fn(),
	notify: vi.fn(),
	chooseValue: vi.fn(),
	addonView: signal(null),
	openAddon: vi.fn(),
	...overrides,
});

const draw = (stub: ReturnType<typeof host>) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [BuyBar, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [CurrencyPipe],
	});
	const fixture = TestBed.createComponent(BuyBar);
	fixture.componentRef.setInput('host', stub);
	fixture.detectChanges();
	return { el: fixture.nativeElement as HTMLElement, bar: fixture.componentInstance };
};

describe('BuyBar', () => {
	it('shows the page’s product, price and quantity, and acts through the page', () => {
		const stub = host();
		const { el } = draw(stub);
		expect(el.querySelector('.st-bar-name')?.textContent).toContain('Royal Blue Suit');
		expect(el.querySelector('.st-bar-off')?.textContent).toContain('20%');
		expect((el.querySelector('.qty-input') as HTMLInputElement).value).toBe('2');
		el.querySelector<HTMLButtonElement>('#bar-add')?.click();
		el.querySelector<HTMLButtonElement>('#bar-buy')?.click();
		el.querySelector<HTMLButtonElement>('#bar-qty-plus')?.click();
		expect(stub.addToCart).toHaveBeenCalled();
		expect(stub.buyNow).toHaveBeenCalled();
		expect(stub.updateQuantity).toHaveBeenCalledWith(1);
	});

	it('offers Notify me when sold out, and the length for fabric by the metre', () => {
		const stub = host({ soldOut: signal(true), rule: signal({}), length: signal(25) });
		const { el } = draw(stub);
		expect(el.querySelector('#bar-add')).toBeNull();
		el.querySelector<HTMLButtonElement>('#bar-notify')?.click();
		expect(stub.notify).toHaveBeenCalled();
		expect((el.querySelector('.qty-input') as HTMLInputElement).value).toBe('2.5 m');
	});

	it('draws the chosen option’s photo, else the product’s', () => {
		expect(draw(host()).bar.photo()).toBe('thumb.webp');
		const chosen = host({ summary: signal({ variation: { variation_image: { original_url: 'variant.webp' } } }) });
		expect(draw(chosen).bar.photo()).toBe('variant.webp');
	});

	describe('option chips', () => {
		const lav = { id: 11, value: 'Lavender', attribute_id: 1, hex_color: '#b57edc' };
		const rose = { id: 12, value: 'Rose', attribute_id: 1, hex_color: '#e0607e' };
		const s34 = { id: 21, value: '34', attribute_id: 2 };
		const s36 = { id: 22, value: '36', attribute_id: 2 };
		const variation = (values: object[], quantity: number, stock_status = 'in_stock') => ({
			attribute_values: values,
			quantity,
			stock_status,
		});
		const product = {
			name: 'Lavender Saree',
			attributes: [
				{
					id: 1,
					name: 'Colour',
					style: 'color',
					attribute_values: [lav, rose, { id: 13, value: 'Unused', attribute_id: 1 }],
				},
				{ id: 2, name: 'Blouse Size', style: 'rectangle', attribute_values: [s34, s36] },
			],
			variations: [variation([lav, s34], 3), variation([lav, s36], 0, 'out_of_stock'), variation([rose, s34], 2)],
		};
		const chosen = host({ product: signal(product), summary: signal({ variation: variation([lav, s34], 3) }) });

		it('shows a chip per option with the chosen value, and each list’s stock with the other options as chosen', () => {
			const { bar } = draw(chosen);
			const [colour, size] = bar.axes();
			expect([colour?.pick?.value, colour?.colour, size?.pick?.value, size?.colour]).toEqual([
				'Lavender',
				true,
				'34',
				false,
			]);
			expect(colour?.values.map((row) => [row.value.value, row.quantity, row.soldOut, row.chosen])).toEqual([
				['Lavender', 3, false, true],
				['Rose', 2, false, false],
			]);
			expect(size?.values.map((row) => [row.value.value, row.soldOut])).toEqual([
				['34', false],
				['36', true],
			]);
		});

		it('chooses through the page, closing the list; a sold-out or chosen value does nothing', () => {
			const { bar } = draw(chosen);
			const popover = { close: vi.fn() };
			const [colour, size] = bar.axes();
			bar.choose(colour!.values[1]!, popover as never);
			expect(chosen.chooseValue).toHaveBeenCalledWith(rose);
			bar.choose(size!.values[1]!, popover as never);
			bar.choose(colour!.values[0]!, popover as never);
			expect(chosen.chooseValue).toHaveBeenCalledTimes(1);
			expect(popover.close).toHaveBeenCalledTimes(3);
		});

		it('draws no chips for a product without options', () => {
			expect(draw(host()).bar.axes()).toEqual([]);
		});
	});

	describe('the add-on', () => {
		const addon = (measured: boolean) =>
			host({ addonView: signal({ chips: [{ group: 'Blouse', term: 'Boat Neck' }], needs: true, measured }) });

		it('shows the chosen design with a pencil and the measurements’ state, and Edit add-on instead of Buy now', () => {
			const stub = addon(false);
			const { el } = draw(stub);
			expect(el.querySelector('.st-bar-chip')?.textContent).toContain('Blouse: Boat Neck');
			expect(el.querySelector('.st-stock.is-low')?.textContent).toContain('measurements_needed');
			expect(el.querySelector('#bar-buy')).toBeNull();
			el.querySelector<HTMLButtonElement>('.st-bar-chip')?.click();
			el.querySelector<HTMLButtonElement>('#bar-edit-addon')?.click();
			expect(stub.openAddon.mock.calls).toEqual([['designs'], ['all']]);
			expect(draw(addon(true)).el.querySelector('.st-stock:not(.is-low)')?.textContent).toContain(
				'measurements_added_long',
			);
		});
	});

	it('shows the price with the add-on once one adds to it', () => {
		const { el } = draw(host({ summary: signal({ unitPrice: 15050 }), discount: signal(0) }));
		expect(el.querySelector('.st-bar-price')?.textContent?.replace(/\D/g, '')).toContain('15050');
	});
});
