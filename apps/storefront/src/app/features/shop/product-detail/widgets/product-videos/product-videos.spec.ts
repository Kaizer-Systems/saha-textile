import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { ProductVideos } from './product-videos';

const render = () => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(ProductVideos, { set: { imports: [], template: '', styleUrls: [] } });
	const fixture = TestBed.createComponent(ProductVideos);
	fixture.componentRef.setInput('videos', []);
	const block = fixture.componentInstance;
	const carousel = { stopAutoplay: vi.fn(), startAutoplay: vi.fn() };
	const poster = { stop: vi.fn() };
	Object.defineProperty(block, 'carousel', { value: () => carousel });
	Object.defineProperty(block, 'posters', { value: () => [poster] });
	return { block, carousel, poster };
};

describe('ProductVideos carousel', () => {
	it('moves by itself only while nothing plays and the pointer is away', () => {
		const { block, carousel } = render();
		expect(block.options).toMatchObject({ items: 1, autoplay: true, autoplayHoverPause: false });
		block.hover(true);
		expect(carousel.stopAutoplay).toHaveBeenCalledTimes(1);
		block.hover(false);
		expect(carousel.startAutoplay).toHaveBeenCalledTimes(1);
		block.playing();
		block.hover(true);
		block.hover(false);
		// Leaving the carousel while a video plays does not start it moving again.
		expect(carousel.startAutoplay).toHaveBeenCalledTimes(1);
	});

	it('closes the playing video when the shopper changes slide, then moves again', () => {
		const { block, carousel, poster } = render();
		block.slideChanged();
		expect(poster.stop).not.toHaveBeenCalled();
		block.playing();
		block.slideChanged();
		expect(poster.stop).toHaveBeenCalledOnce();
		expect(carousel.startAutoplay).toHaveBeenCalledOnce();
	});
});
