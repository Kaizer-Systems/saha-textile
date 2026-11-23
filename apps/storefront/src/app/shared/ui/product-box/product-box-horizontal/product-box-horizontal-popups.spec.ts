import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareStore } from '@core/state/compare/compare.store';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';
import { QUICK_VIEW_OPTIONS, QuickView } from '@shared/ui/modal/quick-view/quick-view';

import { ProductBoxHorizontal } from './product-box-horizontal';

/** Stands in for the options popup, drawn once a card's options are asked for. */
@Component({ selector: 'app-config-popup', template: '' })
class ConfigPopup {
	readonly openModal = vi.fn();
}

const render = (product?: unknown) => {
	const view = { card: signal<unknown>(null), slug: signal<string | undefined>(undefined) };
	const open = vi.fn(() => ({ componentInstance: view }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: { cartItems$: of([]) } },
			{ provide: WishlistStore, useValue: {} },
			{ provide: CompareStore, useValue: {} },
			{ provide: NgbModal, useValue: { open } },
		],
	});
	TestBed.overrideComponent(ProductBoxHorizontal, {
		set: { imports: [ConfigPopup], template: '@if (asked().config) { <app-config-popup #configModal /> }' },
	});
	const fixture = TestBed.createComponent(ProductBoxHorizontal);
	if (product) fixture.componentRef.setInput('product', product);
	fixture.detectChanges();
	return { fixture, box: fixture.componentInstance, open, view };
};

describe('ProductBoxHorizontal: pop-ups', () => {
	it('opens the quick view with the card’s product, and nothing for a card without a page', async () => {
		const empty = render();
		await empty.box.openDetail();
		expect(empty.open).not.toHaveBeenCalled();

		const product = { id: 1, slug: 'red-saree' };
		const { box, open, view } = render(product);
		await box.openDetail();
		expect(open).toHaveBeenCalledWith(QuickView, QUICK_VIEW_OPTIONS);
		expect(view.card()).toBe(product);
		expect(view.slug()).toBe('red-saree');
	});

	it('draws the options popup on first ask and opens it once drawn, then straight away', () => {
		const { fixture, box } = render({ id: 1, slug: 'red-saree' });
		box.openConfig();
		expect(box.asked().config).toBe(true);
		fixture.detectChanges();
		const popup = box.configModal() as unknown as ConfigPopup;
		expect(popup.openModal).toHaveBeenCalledOnce();
		box.openConfig();
		expect(popup.openModal).toHaveBeenCalledTimes(2);
	});
});
