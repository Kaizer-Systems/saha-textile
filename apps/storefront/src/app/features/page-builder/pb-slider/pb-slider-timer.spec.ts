import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PbSlider } from './pb-slider';

import type { ResolvedPieceView } from '../page-builder.types';

const piece = (after: 'loop' | 'stop', count = 3): ResolvedPieceView =>
	({
		name: 'main',
		slider: { seconds: 2, controls: 'bottom_center', after },
		pictures: Array.from({ length: count }, (_, i) => ({ key: `hero:main:${i}` })),
	}) as unknown as ResolvedPieceView;

const render = (value: ResolvedPieceView, { platform = 'browser', track = true } = {}) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	TestBed.overrideComponent(PbSlider, { set: { imports: [], template: track ? '<div #track></div>' : '' } });
	const fixture = TestBed.createComponent(PbSlider);
	fixture.componentRef.setInput('piece', value);
	fixture.detectChanges();
	TestBed.tick();
	const element = fixture.nativeElement.querySelector('div') as HTMLElement | null;
	// jsdom draws no layout, so elements have no scrollTo of their own.
	if (element) element.scrollTo = vi.fn() as never;
	return { fixture, slider: fixture.componentInstance, element };
};

const sized = (element: HTMLElement | null, width: number) => {
	if (!element) throw new Error('no track');
	Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
	const scrollTo = vi.fn();
	element.scrollTo = scrollTo as never;
	return scrollTo;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('the builder slider: autoplay and the track', () => {
	it('moves on by itself every few seconds, and stops when the page goes', () => {
		const { fixture, slider } = render(piece('loop'));
		vi.advanceTimersByTime(2000);
		expect(slider.index()).toBe(1);
		vi.advanceTimersByTime(4000);
		expect(slider.index()).toBe(0);
		fixture.destroy();
		vi.advanceTimersByTime(4000);
		expect(slider.index()).toBe(0);
	});

	it('starts paused for people who ask for less motion', () => {
		window.matchMedia = vi.fn(() => ({ matches: true })) as never;
		const { slider } = render(piece('loop'));
		expect(slider.paused()).toBe(true);
		vi.advanceTimersByTime(6000);
		expect(slider.index()).toBe(0);
	});

	it('plays when motion is fine', () => {
		window.matchMedia = vi.fn(() => ({ matches: false })) as never;
		const { slider } = render(piece('loop'));
		expect(slider.paused()).toBe(false);
	});

	it('waits while a finger holds it or the tab is hidden', () => {
		const { slider } = render(piece('loop'));
		slider.hold(true);
		vi.advanceTimersByTime(2000);
		expect(slider.index()).toBe(0);
		slider.hold(false);
		const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
		vi.advanceTimersByTime(2000);
		expect(slider.index()).toBe(0);
		hidden.mockReturnValue(false);
		vi.advanceTimersByTime(2000);
		expect(slider.index()).toBe(1);
	});

	it('pauses on the last picture when it stops there', () => {
		const { slider } = render(piece('stop', 2));
		vi.advanceTimersByTime(2000);
		expect(slider.index()).toBe(1);
		vi.advanceTimersByTime(2000);
		expect(slider.paused()).toBe(true);
		expect(slider.index()).toBe(1);
	});

	it('runs no timer on the server', () => {
		const { fixture, slider } = render(piece('loop'), { platform: 'server' });
		vi.advanceTimersByTime(6000);
		expect(slider.index()).toBe(0);
		fixture.destroy();
	});

	it('scrolls the track to the picture, and follows a swipe', () => {
		const { slider, element } = render(piece('loop'));
		const scrollTo = sized(element, 400);
		slider.go(2);
		expect(scrollTo).toHaveBeenCalledWith({ left: 800, behavior: 'smooth' });
		(element as HTMLElement).scrollLeft = 390;
		slider.onScroll();
		expect(slider.index()).toBe(1);
	});

	it('ignores a scroll before the track has a width, or with no track drawn', () => {
		const drawn = render(piece('loop'));
		sized(drawn.element, 0);
		drawn.slider.onScroll();
		expect(drawn.slider.index()).toBe(0);
		const bare = render(piece('loop'), { track: false });
		bare.slider.onScroll();
		expect(bare.slider.index()).toBe(0);
	});
});
