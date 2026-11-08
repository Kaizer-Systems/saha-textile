import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { CompareStore } from '@core/state/compare/compare.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';

import { Compare } from './compare/compare';
import { ProductAction } from './product-detail/widgets/product-action/product-action';
import { TrendingProducts } from './product-detail/widgets/trending-products/trending-products';
import { Wishlist } from './wishlist/wishlist';

const related = signal<unknown>(undefined);
vi.mock('@data-access/queries/product.queries', () => ({ injectRelatedProductsData: () => ({ data: related }) }));

const translate = { provide: TranslocoService, useValue: { selectTranslate: () => of('Title') } };

afterEach(() => related.set(undefined));

describe('Compare page', () => {
	it('loads the list in the browser, then shows it', async () => {
		const store = { loadPage: vi.fn(async () => {}) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				translate,
				{ provide: CompareStore, useValue: store },
				{ provide: PLATFORM_ID, useValue: 'browser' },
			],
		});
		TestBed.overrideComponent(Compare, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Compare).componentInstance;
		expect(store.loadPage).toHaveBeenCalledOnce();
		await Promise.resolve();
		expect(page.ready()).toBe(true);
	});

	it('waits on the server', () => {
		const store = { loadPage: vi.fn(async () => {}) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				translate,
				{ provide: CompareStore, useValue: store },
				{ provide: PLATFORM_ID, useValue: 'server' },
			],
		});
		TestBed.overrideComponent(Compare, { set: { imports: [], template: '' } });
		expect(TestBed.createComponent(Compare).componentInstance.ready()).toBe(false);
		expect(store.loadPage).not.toHaveBeenCalled();
	});
});

describe('Wishlist page', () => {
	it('loads the list in the browser only', async () => {
		const store = { loadPage: vi.fn(async () => {}) };
		for (const platform of ['browser', 'server']) {
			TestBed.resetTestingModule();
			TestBed.configureTestingModule({
				providers: [
					translate,
					{ provide: WishlistStore, useValue: store },
					{ provide: PLATFORM_ID, useValue: platform },
				],
			});
			TestBed.overrideComponent(Wishlist, { set: { imports: [], template: '' } });
			const page = TestBed.createComponent(Wishlist).componentInstance;
			await Promise.resolve();
			expect(page.ready()).toBe(platform === 'browser');
		}
		expect(store.loadPage).toHaveBeenCalledOnce();
	});
});

describe('ProductAction', () => {
	it('reads the policy and the sign-in state', () => {
		const siteConfig = signal<unknown>(null);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: AuthStore, useValue: { isAuthenticated: signal(true) } },
				{ provide: SiteConfigStore, useValue: { siteConfig } },
			],
		});
		TestBed.overrideComponent(ProductAction, { set: { imports: [], template: '' } });
		const widget = TestBed.createComponent(ProductAction).componentInstance;
		TestBed.tick();
		expect(widget.isLogin).toBe(true);
		siteConfig.set({ product: { shipping_and_return: 'Policy' } });
		TestBed.tick();
		expect(widget.policy).toBe('Policy');
	});
});

describe('TrendingProducts', () => {
	it('keeps the trending cards only', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(TrendingProducts, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(TrendingProducts);
		fixture.detectChanges();
		TestBed.tick();
		expect(fixture.componentInstance.relatedProducts).toEqual([]);
		related.set([{ id: 1, is_trending: true }, { id: 2 }]);
		TestBed.tick();
		expect(fixture.componentInstance.relatedProducts).toEqual([{ id: 1, is_trending: true }]);
	});
});
