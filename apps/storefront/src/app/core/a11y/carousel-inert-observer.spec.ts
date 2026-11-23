import { EnvironmentInjector, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { provideCarouselInert } from './carousel-inert';

const start = (platform: string) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [{ provide: PLATFORM_ID, useValue: platform }, provideCarouselInert()],
	});
	TestBed.inject(EnvironmentInjector);
};
const mutations = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('provideCarouselInert', () => {
	it('keeps inert in step with aria-hidden, once per frame however many slides change', async () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
		start('browser');
		document.body.innerHTML = '<div class="owl-item" aria-hidden="true"><a href="/a">A</a></div>';
		await mutations();
		document.body.append(Object.assign(document.createElement('div'), { className: 'owl-item' }));
		await mutations();
		expect(frames).toHaveLength(1);
		frames[0]?.(0);
		const [hidden, shown] = Array.from(document.querySelectorAll('.owl-item'));
		expect(hidden?.hasAttribute('inert')).toBe(true);
		expect(shown?.hasAttribute('inert')).toBe(false);

		hidden?.setAttribute('aria-hidden', 'false');
		await mutations();
		expect(frames).toHaveLength(2);
	});

	it('watches nothing on the server', async () => {
		const frames = vi.fn();
		vi.stubGlobal('requestAnimationFrame', frames);
		start('server');
		document.body.innerHTML = '<div class="owl-item" aria-hidden="true"></div>';
		await mutations();
		expect(frames).not.toHaveBeenCalled();
	});
});
