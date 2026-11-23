import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareStore } from '@core/state/compare/compare.store';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';
import { NotificationService } from '@data-access/services/notification.service';

import { BuyBox } from './buy-box';

const product = { id: 7, slug: 'muslin', price: 2000, sale_price: 1500, discount: 25, stock_status: 'in_stock' };

const render = (overrides: Record<string, unknown> = {}) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: { cartItems$: new BehaviorSubject([]), addToCart: vi.fn() } },
			{ provide: WishlistStore, useValue: { saved: signal(new Set()), has: () => false, toggle: vi.fn() } },
			{ provide: CompareStore, useValue: { chosen: signal(new Set()), toggle: vi.fn() } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn() } },
			{ provide: Router, useValue: { navigate: vi.fn() } },
			{ provide: HttpClient, useValue: {} },
			{ provide: AuthStore, useValue: { isAuthenticated: signal(true) } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(BuyBox, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(BuyBox);
	fixture.componentRef.setInput('product', { ...product, ...overrides });
	fixture.detectChanges();
	return fixture.componentInstance;
};

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('BuyBox: fabric, add-ons and sets, the remaining cases', () => {
	it('has no length rule for a metre product the API sent without one, and no ceiling without a stock figure', () => {
		const box = render({ sold_by: 'metre' });
		expect(box.rule()).toBeNull();
		expect(box.available()).toBeNull();
	});

	it('lights a quick length only when it is the length chosen, and focuses the length box', () => {
		const box = render({ sold_by: 'metre' });
		box.length.set(25);
		expect(box.isQuick({ tenths: 25 })).toBe(true);
		expect(box.isQuick({ tenths: 30 })).toBe(false);
		document.body.innerHTML = '<input id="length-7">';
		box.focusLength();
		expect(document.activeElement?.id).toBe('length-7');
	});

	it('shows each add-on group’s default, then its first term, then nothing, before the part reports', () => {
		const groups = [
			{
				code: 'blouse',
				label: 'Blouse',
				default_term_code: 'boat',
				terms: [
					{ code: 'none', label: 'None' },
					{ code: 'boat', label: 'Boat' },
				],
			},
			{ code: 'fall', label: 'Fall', terms: [{ code: 'yes', label: 'Yes' }] },
			{ code: 'empty', label: 'Empty', terms: [] },
		];
		expect(render({ addon_groups: groups }).addonView()).toEqual({
			chips: [
				{ group: 'Blouse', term: 'Boat' },
				{ group: 'Fall', term: 'Yes' },
				{ group: 'Empty', term: '' },
			],
			needs: false,
			measured: false,
		});
	});

	it('opens no add-on sheet before the configurator is there', async () => {
		const box = render({ addon_groups: [{ code: 'b', label: 'B', terms: [] }] });
		const open = vi.spyOn(TestBed.inject(NgbModal), 'open');
		await box.openAddon('all');
		expect(open).not.toHaveBeenCalled();
	});

	it('hands the set’s picks and extras to the right column, none before the part reports', () => {
		const before = render({ bundle: { levels: [], bundle_price: 0 } });
		expect(before.setPicks()).toBeNull();
		expect(before.setExtras()).toBeNull();
		const box = render({ bundle: { levels: [], bundle_price: 0 } });
		const bundleState = signal<unknown>({ picks: { saree: ['a'] }, extras: ['pc'] });
		Object.defineProperty(box, 'configurator', { value: () => ({ bundleState }) });
		expect(box.setPicks()).toEqual({ saree: ['a'] });
		expect(box.setExtras()).toEqual(['pc']);
	});

	it('reads none while the set part has not reported yet', () => {
		const box = render({ bundle: { levels: [], bundle_price: 0 } });
		Object.defineProperty(box, 'configurator', { value: () => ({ bundleState: () => null }) });
		expect(box.setPicks()).toBeNull();
		expect(box.setExtras()).toBeNull();
	});
});
