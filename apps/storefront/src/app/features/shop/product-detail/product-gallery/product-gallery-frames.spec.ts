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

	it("leads with the variant's own picture, the others following in order (owner, 17 Nov)", () => {
		const three = { product_galleries: [{ id: 1 }, { id: 2 }, { id: 3 }] };
		const frames = (id: number) => render({ product: three, variation: { variation_image: { id } } }).frames();
		expect(frames(2).map((frame) => frame.id)).toEqual([2, 3, 1]);
		expect(frames(1).map((frame) => frame.id)).toEqual([1, 2, 3]);
		// A picture the gallery does not hold changes nothing.
		expect(frames(7).map((frame) => frame.id)).toEqual([1, 2, 3]);
	});

	it('shows the variant photos when it has them', () => {
		const variation = { variation_galleries: [{ id: 9 }] };
		expect(render({ product, variation }).frames()).toEqual([{ id: 9 }]);
	});
});

describe('ProductGallery thumbnail row', () => {
	const photos = (n: number) => ({ product_galleries: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) });
	const video = { videoId: 'v1', kind: 'video', title: 'Drape' };

	it('counts photos and videos, so one photo alone gets no row (owner, 21 Nov)', () => {
		expect(render({ product: photos(1) }).tileCount()).toBe(1);
		expect(render({ product: { ...photos(1), videos: [video] } }).tileCount()).toBe(2);
		expect(render({ product: photos(3) }).tileCount()).toBe(3);
		expect(render({}).tileCount()).toBe(0);
	});

	it('keeps five tiles in view and hints the browser at the tile width', () => {
		const gallery = render({ product: photos(6) });
		expect(gallery.thumbsInView).toBe(5);
		expect(gallery.tileCount()).toBeGreaterThan(gallery.thumbsInView);
		expect(gallery.thumbSizes).toBe('96px');
		expect(gallery.productThumbSlider.items).toBe(5);
	});
});
