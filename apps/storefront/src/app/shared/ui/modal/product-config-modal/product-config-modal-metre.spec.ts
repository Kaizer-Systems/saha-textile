import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';
import { ProductService } from '@data-access/services/product.service';

import { ProductConfigModal } from './product-config-modal';

const RULE = { shortestCutTenths: 10, stepTenths: 5, quickLengths: [], widthInches: 44 };

const render = (product: Record<string, unknown>, page: Record<string, unknown> = {}) => {
	const open = vi.fn();
	const getProductPage = vi.fn(() => of({ ...product, ...page }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll: vi.fn() } },
			{ provide: CartFacade, useValue: { addToCart: vi.fn(), editLine: vi.fn() } },
			{ provide: ProductService, useValue: { getProductPage } },
			{ provide: PLATFORM_ID, useValue: 'browser' },
		],
	});
	TestBed.overrideComponent(ProductConfigModal, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductConfigModal);
	fixture.componentRef.setInput('product', { id: 7, slug: 'muslin', sale_price: 300, ...product });
	return { modal: fixture.componentInstance, open, getProductPage };
};

const metre = (over: Record<string, unknown> = {}) => ({ sold_by: 'metre', metre_rule: RULE, quantity: 30, ...over });

describe('ProductConfigModal: fabric sold by the metre', () => {
	it('reads the rule only for metre products that carry one', () => {
		expect(render({}).modal.rule()).toBeNull();
		expect(render(metre({ metre_rule: null })).modal.rule()).toBeNull();
		expect(render(metre()).modal.rule()).toEqual(RULE);
	});

	it('loads the full product page first when a card has no rule yet, then starts at the shortest cut', () => {
		const { modal, open, getProductPage } = render(metre({ metre_rule: undefined }), { metre_rule: RULE });
		modal.openModal();
		expect(getProductPage).toHaveBeenCalledWith('muslin');
		expect(open).toHaveBeenCalledOnce();
		expect(modal.rule()).toEqual(RULE);
		expect(modal.productQty()).toBe(10);
	});

	it('flags a length under the shortest cut or over what is free to sell', () => {
		const { modal } = render(metre());
		modal.productQty.set(5);
		expect(modal.lengthIssue()).toBe('below_cut');
		modal.productQty.set(40);
		expect(modal.lengthIssue()).toBe('over_stock');
		modal.onSummary({ purchasable: true, variation: { quantity: 50 } } as never);
		expect(modal.lengthIssue()).toBeNull();
		expect(modal.purchasable()).toBe(true);
	});

	it('sets no ceiling for made-to-order fabric or one without a stock figure', () => {
		const made = render(metre({ made_to_order: true })).modal;
		made.productQty.set(900);
		expect(made.lengthIssue()).toBeNull();
		const unknown = render(metre({ quantity: undefined })).modal;
		unknown.productQty.set(900);
		expect(unknown.lengthIssue()).toBeNull();
	});

	it('steps the length by half a metre between the shortest cut and the stock', () => {
		const { modal } = render(metre());
		modal.productQty.set(10);
		modal.updateQuantity(1);
		expect(modal.productQty()).toBe(15);
		modal.updateQuantity(-1);
		modal.updateQuantity(-1);
		expect(modal.productQty()).toBe(10);
	});

	it('takes a quick length or a typed one, and puts the box back as a length', () => {
		const { modal } = render(metre());
		modal.pickLength(25);
		expect(modal.productQty()).toBe(25);
		expect(modal.lengthOf(25, 'm')).toBe('2.5 m');
		const box = { value: '3.2' } as HTMLInputElement;
		modal.typeLength(box, 'm');
		expect(modal.productQty()).toBe(32);
		expect(box.value).toBe('3.2 m');
		box.value = 'lots';
		modal.typeLength(box, 'm');
		expect(modal.productQty()).toBe(32);
		expect(box.value).toBe('3.2 m');
	});
});
