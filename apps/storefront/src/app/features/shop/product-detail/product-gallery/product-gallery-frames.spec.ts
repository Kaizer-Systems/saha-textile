import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it } from 'vitest';

import { ProductGallery } from './product-gallery';

const render = (inputs: Record<string, unknown>) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: NgbModal, useValue: {} }] });
	TestBed.overrideComponent(ProductGallery, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductGallery);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	return fixture.componentInstance;
};

describe('ProductGallery frames', () => {
	const product = { product_galleries: [{ id: 1 }, { id: 2 }] };

	it('shows the product photos when the variant has none of its own', () => {
		expect(render({ product }).frames()).toEqual(product.product_galleries);
		expect(render({ product, variation: { variation_galleries: [] } }).frames()).toHaveLength(2);
		expect(render({ product, variation: {} }).frames()).toHaveLength(2);
		expect(render({}).frames()).toEqual([]);
	});

	it('shows the variant photos when it has them', () => {
		const variation = { variation_galleries: [{ id: 9 }] };
		expect(render({ product, variation }).frames()).toEqual([{ id: 9 }]);
	});
});
