import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { CompareFacade } from '@core/state/compare/compare.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { CompareService } from '@data-access/services/compare.service';
import { WishlistService } from '@data-access/services/wishlist.service';

import { Compare } from './compare/compare';
import { ProductAction } from './product-detail/widgets/product-action/product-action';
import { TrendingProducts } from './product-detail/widgets/trending-products/trending-products';
import { Wishlist } from './wishlist/wishlist';

const related = signal<unknown>(undefined);
vi.mock('@data-access/queries/product.queries', () => ({ injectRelatedProductsData: () => ({ data: related }) }));

const translate = { provide: TranslocoService, useValue: { selectTranslate: () => of('Title') } };

afterEach(() => related.set(undefined));

describe('Compare page', () => {
	it('loads the list and removes from it', () => {
		const facade = { compareItems$: of([]), getCompare: vi.fn(), deleteCompare: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				translate,
				{ provide: CompareFacade, useValue: facade },
				{ provide: CompareService, useValue: {} },
			],
		});
		TestBed.overrideComponent(Compare, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Compare).componentInstance;
		expect(facade.getCompare).toHaveBeenCalledOnce();
		page.removeCompare(1);
		expect(facade.deleteCompare).toHaveBeenCalledWith(1);
	});
});

describe('Wishlist page', () => {
	it('loads the list', () => {
		const facade = { wishlistItems$: of({ data: [], total: 0 }), getWishlist: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				translate,
				{ provide: WishlistFacade, useValue: facade },
				{ provide: WishlistService, useValue: {} },
			],
		});
		TestBed.overrideComponent(Wishlist, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Wishlist).componentInstance;
		expect(facade.getWishlist).toHaveBeenCalledOnce();
		expect(page.skeletonItems).toHaveLength(12);
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
