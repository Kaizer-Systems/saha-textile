import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { SiteConfigStore } from '@core/state/site-config.store';

import { ProductAction } from './product-action';

const render = (product: unknown) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: { isAuthenticated: () => false } },
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
		],
	});
	TestBed.overrideComponent(ProductAction, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductAction);
	fixture.componentRef.setInput('product', product);
	return fixture.componentInstance;
};
const badges = (secondary: string | null) => ({ primary: null, secondary });

describe('ProductAction · the "Please hurry" bar (HX-4)', () => {
	it('shows only while the low-stock badge is on, whatever the count', () => {
		expect(render({ quantity: 3, card_badges: badges('low_stock') }).lowStock()).toBe(true);
		// Few left, but the product's threshold keeps the badge off: no bar.
		expect(render({ quantity: 3, card_badges: badges(null) }).lowStock()).toBe(false);
		expect(render({ quantity: 3, card_badges: badges('back_in_stock') }).lowStock()).toBe(false);
		expect(render({ quantity: 3 }).lowStock()).toBe(false);
		expect(render({ quantity: 0, card_badges: badges('low_stock') }).lowStock()).toBe(false);
	});

	it('fills the bar for what is left, never past full', () => {
		const action = render({ quantity: 3, card_badges: badges('low_stock') });
		expect(action.fillOf(3, false)).toBe('30%');
		expect(action.fillOf(14, false)).toBe('100%');
		expect(action.fillOf(45, true)).toBe('45%');
		expect(action.fillOf(140, true)).toBe('100%');
	});
});
