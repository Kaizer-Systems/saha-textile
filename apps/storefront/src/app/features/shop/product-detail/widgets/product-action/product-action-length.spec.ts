import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { SiteConfigStore } from '@core/state/site-config.store';

import { ProductAction } from './product-action';
import { ProductInformation } from '../product-information/product-information';

const render = (product: unknown) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: { isAuthenticated: () => true } },
			{
				provide: SiteConfigStore,
				useValue: { siteConfig: signal({ product: { shipping_and_return: 'Easy returns' } }) },
			},
		],
	});
	TestBed.overrideComponent(ProductAction, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductAction);
	fixture.componentRef.setInput('product', product);
	fixture.detectChanges();
	return fixture.componentInstance;
};

describe('ProductAction and ProductInformation: fabric lengths', () => {
	it('writes what is left of fabric as a length, and shows no bar without a stock figure', () => {
		const action = render({ card_badges: { primary: null, secondary: 'low_stock' } });
		expect(action.lowStock()).toBe(false);
		expect(action.lengthOf(45, 'm')).toBe('4.5 m');
		expect(action.isLogin).toBe(true);
		expect(action.policy).toBe('Easy returns');
	});

	it('writes tenths of a metre in the page’s unit', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: TranslocoService, useValue: { translate: () => 'মি', getActiveLang: () => 'bn' } }],
		});
		TestBed.overrideComponent(ProductInformation, { set: { imports: [], template: '' } });
		const info = TestBed.createComponent(ProductInformation).componentInstance;
		expect(info.tenths(45)).toBe('4.5 মি');
	});
});
