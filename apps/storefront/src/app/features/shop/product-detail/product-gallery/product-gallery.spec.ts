import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { GalleryFullscreen } from './gallery-fullscreen';
import { ProductGallery } from './product-gallery';

const render = (product?: unknown) => {
	const instance: Record<string, unknown> = {};
	const open = vi.fn(() => ({ componentInstance: instance }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: NgbModal, useValue: { open } }] });
	TestBed.overrideComponent(ProductGallery, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductGallery);
	if (product) fixture.componentRef.setInput('product', product);
	return { gallery: fixture.componentInstance, open, instance };
};

describe('ProductGallery', () => {
	it('has no images without a product', () => {
		expect(render().gallery.images()).toEqual([]);
	});

	it('opens the full-screen gallery on the chosen image', () => {
		const { gallery, open, instance } = render({
			name: 'Red saree',
			product_galleries: [{ id: 1, original_url: 'https://cdn/a.jpg' }],
		});
		gallery.openFullscreen(0);
		expect(open).toHaveBeenCalledWith(GalleryFullscreen, { fullscreen: true });
		expect(instance['start']).toBe(0);
		expect(instance['alt']).toBe('Red saree');
		expect(instance['images']).toHaveLength(1);
	});

	it('uses no alt text without a product', () => {
		const { gallery, instance } = render();
		gallery.openFullscreen(1);
		expect(instance['alt']).toBe('');
	});
});
