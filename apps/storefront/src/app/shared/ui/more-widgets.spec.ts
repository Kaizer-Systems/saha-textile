import { CurrencyPipe } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompareFacade } from '@core/state/compare/compare.store';
import { SettingStore } from '@core/state/setting.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductBanner } from '@features/shop/product-detail/widgets/product-banner/product-banner';
import { Categorie } from '@features/themes/widgets/categorie/categorie';
import { WalletOffer } from '@features/themes/widgets/wallet-offer/wallet-offer';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { findStateByName, resolveAddressLocation } from '@shared/util/address-location';

import { Alert } from './alert/alert';
import { CartLineConfig } from './cart-line-config/cart-line-config';
import { FeatherIcons } from './feather-icons/feather-icons';
import { VariationAxis } from './product-config/parts/variation-axis/variation-axis';
import { StickyCompare } from './sticky-compare/sticky-compare';

const feather = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('feather-icons', () => ({ ...feather, default: feather }));

const bare = <T>(type: new () => T, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type);
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('Alert', () => {
	it('shows the latest alert, and turns toasts back on when it leaves', () => {
		const service = { alertSubject: new Subject(), notification: false };
		const fixture = bare(Alert, [{ provide: NotificationService, useValue: service }]);
		service.alertSubject.next({ type: 'error', message: 'No' });
		expect(fixture.componentInstance.alert).toEqual({ type: 'error', message: 'No' });
		fixture.destroy();
		expect(service.notification).toBe(true);
	});
});

describe('StickyCompare', () => {
	it('loads the compare list', async () => {
		const facade = { compareTotal$: of(3), getCompare: vi.fn() };
		const widget = bare(StickyCompare, [{ provide: CompareFacade, useValue: facade }]).componentInstance;
		expect(facade.getCompare).toHaveBeenCalledOnce();
		expect(await firstValueFrom(widget.compareTotal$)).toBe(3);
	});
});

describe('CartLineConfig', () => {
	it('joins the bundle component names, or has none', () => {
		const fixture = bare(CartLineConfig);
		expect(fixture.componentInstance.componentNames()).toBe('');
		fixture.componentRef.setInput('config', { bundle_components: [{ name: 'Saree' }, { name: 'Blouse' }] });
		expect(fixture.componentInstance.componentNames()).toBe('Saree, Blouse');
	});
});

describe('FeatherIcons', () => {
	it('draws the icons after the view settles', () => {
		vi.useFakeTimers();
		const fixture = bare(FeatherIcons);
		fixture.detectChanges();
		vi.runAllTimers();
		expect(feather.replace).toHaveBeenCalled();
	});
});

describe('VariationAxis', () => {
	it('remembers the choice and tells the parent', () => {
		const axis = bare(VariationAxis).componentInstance;
		const seen: unknown[] = [];
		axis.selectVariation.subscribe((value) => seen.push(value));
		axis.onSelect({ id: 1 } as never);
		expect(axis.selectedVariation).toEqual({ id: 1 });
		expect(seen).toEqual([{ id: 1 }]);
	});
});

describe('Categorie', () => {
	it('passes the chosen category up', () => {
		const widget = bare(Categorie).componentInstance;
		const seen: (number | string)[] = [];
		widget.selectedCategory.subscribe((id) => seen.push(id));
		widget.selectCategory(4);
		expect(seen).toEqual([4]);
	});
});

describe('WalletOffer', () => {
	it('copies a code', () => {
		const writeText = vi.fn(async () => undefined);
		const widget = bare(WalletOffer).componentInstance;
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		widget.copyFunction('SAVE');
		expect(writeText).toHaveBeenCalledWith('SAVE');
	});
});

describe('ProductBanner', () => {
	it('builds the banner from the image', () => {
		const banner = bare(ProductBanner).componentInstance;
		banner.ngOnChanges({ image: { currentValue: 'a.jpg' } } as never);
		expect(JSON.stringify(banner.banner)).toContain('a.jpg');
	});
});

describe('CurrencySymbolPipe', () => {
	const pipe = (currency: unknown) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				CurrencyPipe,
				CurrencySymbolPipe,
				{ provide: SettingStore, useValue: { selectedCurrency: signal(currency) } },
			],
		});
		return TestBed.inject(CurrencySymbolPipe);
	};

	it('shows zero for no value', () => {
		expect(pipe(null).transform(undefined)).toBe('$ 0.00');
	});

	it('honours the position and the exchange rate', () => {
		const euro = { symbol: '€', symbol_position: 'after_price', exchange_rate: 2 };
		expect(pipe(euro).transform(10)).toBe('20.00 €');
	});
});

describe('address location edges', () => {
	it('finds no state without a name or a country', () => {
		expect(findStateByName([], 1, '')).toBeNull();
		expect(findStateByName([], null, 'Bengal')).toBeNull();
	});

	it('has no dial code for a country that lacks one', () => {
		const result = resolveAddressLocation({
			countries: [{ id: 1, name: 'Nowhere' }] as never,
			states: [],
			countryName: 'Nowhere',
			stateName: null,
		});
		expect(result).toMatchObject({ countryId: 1, callingCode: null, isoCode: null });
	});
});
