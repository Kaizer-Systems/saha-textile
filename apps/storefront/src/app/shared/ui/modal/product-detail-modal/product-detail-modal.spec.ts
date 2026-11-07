import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';
import { ProductService } from '@data-access/services/product.service';

import { ProductDetailModal } from './product-detail-modal';

const render = (
	product: Record<string, unknown> | undefined = { id: 7, slug: 'red', quantity: 3, stock_status: 'in_stock' },
	platform = 'browser',
	result: Promise<unknown> = Promise.resolve('closed'),
) => {
	const items = new BehaviorSubject<unknown[]>([]);
	const cart = { cartItems$: items, addToCart: vi.fn() };
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	const getGallery = vi.fn(() => of<unknown>([{ id: 1 }]));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: CartFacade, useValue: cart },
			{ provide: ProductService, useValue: { getGallery } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(ProductDetailModal, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductDetailModal);
	if (product) fixture.componentRef.setInput('product', product);
	return { fixture, modal: fixture.componentInstance, items, cart, open, dismissAll, getGallery, product };
};

describe('ProductDetailModal', () => {
	it('finds its line in the cart', () => {
		const { fixture, modal, items } = render();
		fixture.detectChanges();
		items.next([{ id: 'line', product: { id: 7 } }]);
		expect(modal.cartItem).toMatchObject({ id: 'line' });
	});

	it('prefers fetched frames, then the product gallery, then nothing', () => {
		const { modal } = render({ id: 1, product_galleries: [{ id: 2 }] });
		expect(modal.displayGalleries()).toEqual([{ id: 2 }]);
		modal.frames.set([{ id: 3 }] as never);
		expect(modal.displayGalleries()).toEqual([{ id: 3 }]);
		expect(render(undefined).modal.displayGalleries()).toEqual([]);
	});

	it('loads the gallery and opens', async () => {
		const { modal, open, getGallery } = render();
		await modal.openModal();
		expect(getGallery).toHaveBeenCalledWith('red');
		expect(modal.frames()).toEqual([{ id: 1 }]);
		expect(modal.modalOpen).toBe(true);
		expect(open).toHaveBeenCalledOnce();
	});

	it('treats an empty gallery answer as none, and skips a product without a slug', async () => {
		const empty = render();
		empty.getGallery.mockReturnValue(of(null));
		await empty.modal.openModal();
		expect(empty.modal.frames()).toEqual([]);
		const bare = render({ id: 1 });
		await bare.modal.openModal();
		expect(bare.getGallery).not.toHaveBeenCalled();
	});

	it('opens no dialog on the server', async () => {
		const { modal, open } = render(undefined, 'server');
		await modal.openModal();
		expect(modal.isBrowser).toBe(false);
		expect(open).not.toHaveBeenCalled();
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render(undefined, 'browser', Promise.reject(reason));
		await modal.openModal();
		await Promise.resolve();
		await Promise.resolve();
		expect(modal.closeResult).toBe(text);
	});

	it('marks the product out of stock past its quantity, and never goes below one', () => {
		const { modal, product } = render();
		modal.updateQuantity(-1);
		expect(modal.productQty).toBe(1);
		modal.updateQuantity(3);
		expect(product?.['stock_status']).toBe('out_of_stock');
		modal.updateQuantity(-1);
		expect(product?.['stock_status']).toBe('in_stock');
	});

	it('checks the chosen variation instead when there is one', () => {
		const { modal } = render();
		const variation = { id: 5, quantity: 1, stock_status: 'in_stock' } as never;
		modal.selectVariation(variation);
		modal.updateQuantity(1);
		expect(modal.selectedVariation?.stock_status).toBe('out_of_stock');
		modal.updateQuantity(-1);
		expect(modal.selectedVariation?.stock_status).toBe('in_stock');
	});

	it('adds a plain product as a new line and closes', () => {
		const { modal, cart, dismissAll } = render();
		modal.addToCart({ id: 7 } as never);
		expect(cart.addToCart).toHaveBeenCalledWith({
			id: null,
			product_id: 7,
			product: { id: 7 },
			variation: null,
			variation_id: null,
			quantity: 1,
		});
		expect(dismissAll).toHaveBeenCalledOnce();
	});

	it('reuses the line only for the same variation', () => {
		const { modal, cart } = render();
		modal.cartItem = { id: 'line', variation: { id: 5 } } as never;
		modal.addToCart({ id: 7 } as never);
		expect(cart.addToCart.mock.lastCall?.[0]).toMatchObject({ id: null });
		modal.selectVariation({ id: 5 } as never);
		modal.addToCart({ id: 7 } as never);
		expect(cart.addToCart.mock.lastCall?.[0]).toMatchObject({ id: 'line', variation_id: 5 });
		modal.selectVariation({ id: 6 } as never);
		modal.addToCart({ id: 7 } as never);
		expect(cart.addToCart.mock.lastCall?.[0]).toMatchObject({ id: null });
		modal.cartItem = { id: 'line' } as never;
		modal.addToCart({ id: 7 } as never);
		expect(cart.addToCart.mock.lastCall?.[0]).toMatchObject({ id: null });
		modal.selectVariation({} as never);
		modal.addToCart({ id: 7 } as never);
		expect(cart.addToCart.mock.lastCall?.[0]).toMatchObject({ variation_id: null });
	});

	it('adds nothing without a product', () => {
		const { modal, cart } = render();
		modal.addToCart(undefined as never);
		expect(cart.addToCart).not.toHaveBeenCalled();
	});
});
