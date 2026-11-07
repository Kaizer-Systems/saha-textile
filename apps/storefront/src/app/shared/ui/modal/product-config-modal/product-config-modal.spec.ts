import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';
import { ProductService } from '@data-access/services/product.service';

import { ProductConfigModal } from './product-config-modal';

const render = (platform = 'browser') => {
	const open = vi.fn();
	const dismissAll = vi.fn();
	const cart = { addToCart: vi.fn(), editLine: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: CartFacade, useValue: cart },
			{ provide: ProductService, useValue: { getProductPage: () => of({ id: 7, name: 'Whole', attributes: [] }) } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(ProductConfigModal, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductConfigModal);
	fixture.componentRef.setInput('product', Object.freeze({ id: 7, sale_price: 100 }));
	return { fixture, modal: fixture.componentInstance, open, dismissAll, cart };
};
const summary = { purchasable: true, soldOut: true, unitPrice: 250 } as never;
const configurator = { buildParams: vi.fn(() => ({ product_id: 7 })) } as never;

describe('ProductConfigModal', () => {
	it('opens nothing on the server', () => {
		const { modal, open } = render('server');
		modal.openModal();
		expect(open).not.toHaveBeenCalled();
	});

	it('opens fresh for a card add', () => {
		const { modal, open } = render();
		modal.productQty.set(9);
		modal.onSummary(summary);
		modal.openModal();
		expect(open).toHaveBeenCalledOnce();
		expect(modal.isEdit()).toBe(false);
		expect(modal.productQty()).toBe(1);
		expect(modal.summary()).toBeNull();
	});

	it('opens seeded from a cart line', () => {
		const { modal } = render();
		modal.openModal({ id: 'line', quantity: 3, product: { slug: 'silk' } } as never);
		expect(modal.isEdit()).toBe(true);
		expect(modal.productQty()).toBe(3);
		expect(modal.configProduct()).toMatchObject({ name: 'Whole', attributes: [] });
	});

	it('gives the configurator a copy it may change', () => {
		const { modal } = render();
		const copy = modal.configProduct();
		expect(Object.isFrozen(copy)).toBe(false);
		expect(copy).toEqual({ id: 7, sale_price: 100 });
	});

	it('hands a missing product through untouched', () => {
		const { fixture, modal } = render();
		fixture.componentRef.setInput('product', null);
		expect(modal.configProduct()).toBeNull();
	});

	it('falls back until the configurator reports', () => {
		const { modal } = render();
		expect(modal.purchasable()).toBe(false);
		expect(modal.soldOut()).toBe(false);
		expect(modal.unitPrice()).toBe(100);
		modal.onSummary(summary);
		expect(modal.purchasable()).toBe(true);
		expect(modal.soldOut()).toBe(true);
		expect(modal.unitPrice()).toBe(250);
	});

	it('never lets the quantity fall below one', () => {
		const { modal } = render();
		modal.updateQuantity(-1);
		expect(modal.productQty()).toBe(1);
		modal.updateQuantity(2);
		expect(modal.productQty()).toBe(3);
	});

	it('does nothing until the configuration can be bought', () => {
		const { modal, cart, dismissAll } = render();
		modal.confirm(configurator);
		expect(cart.addToCart).not.toHaveBeenCalled();
		expect(dismissAll).not.toHaveBeenCalled();
	});

	it('adds a new line', () => {
		const { modal, cart, dismissAll } = render();
		modal.onSummary(summary);
		modal.confirm(configurator);
		expect(cart.addToCart).toHaveBeenCalledWith({ product_id: 7 });
		expect(dismissAll).toHaveBeenCalledOnce();
	});

	it('replaces the edited line in place', () => {
		const { modal, cart } = render();
		modal.openModal({ id: 'line', quantity: 2, product: { slug: 'silk' } } as never);
		modal.onSummary(summary);
		const build = { buildParams: vi.fn(() => ({ id: 'line' })) };
		modal.confirm(build as never);
		expect(build.buildParams).toHaveBeenCalledWith(2, 'line');
		expect(cart.editLine).toHaveBeenCalledWith({ id: 'line' });
		expect(cart.addToCart).not.toHaveBeenCalled();
	});
});
