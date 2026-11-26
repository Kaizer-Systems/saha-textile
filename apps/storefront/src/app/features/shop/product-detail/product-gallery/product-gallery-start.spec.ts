import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductGallery } from './product-gallery';

const render = (template: string) => {
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: NgbModal, useValue: { open: vi.fn() } }] });
	TestBed.overrideComponent(ProductGallery, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(ProductGallery);
	fixture.detectChanges();
	TestBed.tick();
	return { gallery: fixture.componentInstance, fixture, frames };
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ProductGallery: when the carousels count as started', () => {
	it('starts once every slide carries its measured pixel width', () => {
		const { gallery } = render(
			'<div class="owl-item" style="width: 412.5px"></div><div class="owl-item" style="width: 412px"></div>',
		);
		expect(gallery.started()).toBe(true);
	});

	it('waits frame by frame while a slide has no width yet, then gives up after three seconds', () => {
		const now = vi.spyOn(performance, 'now').mockReturnValue(0);
		const { gallery, fixture, frames } = render('<div class="owl-item"></div>');
		// Angular asks for frames of its own; the gallery's check is the one named so.
		const check = () =>
			frames.splice(
				frames.findIndex((frame) => frame.name === 'check'),
				1,
			)[0]?.(0);
		expect(gallery.started()).toBe(false);
		const slide = (fixture.nativeElement as HTMLElement).querySelector('.owl-item') as HTMLElement;
		slide.style.width = '50%';
		check();
		expect(gallery.started()).toBe(false);
		now.mockReturnValue(3001);
		check();
		expect(gallery.started()).toBe(true);
	});
});
