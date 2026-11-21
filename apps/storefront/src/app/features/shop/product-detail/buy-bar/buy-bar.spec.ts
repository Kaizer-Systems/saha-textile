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
});
