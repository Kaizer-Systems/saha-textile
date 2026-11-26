import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it } from 'vitest';

import { HeadPreload, pictureBandMedia } from './head-preload';
import { installPictureFallback } from './picture-fallback';

const MEDIA = 'https://cdn.test/media/med_7Hk2/red-card-400w-1f3a9c2e.webp';

describe('the missing-picture placeholder: the edges', () => {
	let stop: (() => void) | null = null;
	afterEach(() => {
		stop?.();
		stop = null;
		document.body.innerHTML = '';
		document.documentElement.classList.remove('dark');
	});

	const set = (img: HTMLImageElement, props: Record<string, unknown>) => {
		for (const [name, value] of Object.entries(props))
			Object.defineProperty(img, name, { configurable: true, value });
		return img;
	};

	it('follows the page’s dark mode by default, and clears every source of a picture element', () => {
		document.documentElement.classList.add('dark');
		document.body.innerHTML = `<picture><source srcset="${MEDIA} 1x"><img src="${MEDIA}"></picture>`;
		stop = installPictureFallback(document);
		const img = document.querySelector('img') as HTMLImageElement;
		img.dispatchEvent(new Event('error'));
		expect(img.getAttribute('src')).toMatch(/placeholder-dark-/);
		expect(document.querySelector('source')?.hasAttribute('srcset')).toBe(false);
	});

	it('leaves failures of anything but a picture alone', () => {
		document.body.innerHTML = `<link rel="stylesheet" href="${MEDIA}">`;
		stop = installPictureFallback(document, () => false);
		const link = document.querySelector('link') as HTMLLinkElement;
		link.dispatchEvent(new Event('error'));
		expect(link.getAttribute('href')).toBe(MEDIA);
	});

	it('takes the size from the attributes when the browser reports none, else from the drawn box', () => {
		const img = set(document.createElement('img'), { width: 0, height: 0 });
		img.setAttribute('width', '400');
		img.setAttribute('height', '400');
		img.src = MEDIA;
		document.body.append(img);
		stop = installPictureFallback(document, () => false);
		img.dispatchEvent(new Event('error'));
		expect(img.getAttribute('src')).toMatch(/placeholder-light-1x1/);

		const drawn = set(document.createElement('img'), { width: 0, height: 0 });
		drawn.getBoundingClientRect = () => ({ width: 300, height: 400 }) as DOMRect;
		drawn.src = MEDIA;
		document.body.append(drawn);
		drawn.dispatchEvent(new Event('error'));
		expect(drawn.getAttribute('src')).toMatch(/placeholder-light-3x4/);
	});

	it('swaps only pictures that had already failed before it started', () => {
		const failed = set(document.createElement('img'), { complete: true, naturalWidth: 0 });
		failed.src = MEDIA;
		const loading = set(document.createElement('img'), { complete: false, naturalWidth: 0 });
		loading.src = MEDIA;
		const loaded = set(document.createElement('img'), { complete: true, naturalWidth: 300 });
		loaded.src = MEDIA;
		const empty = set(document.createElement('img'), { complete: true, naturalWidth: 0 });
		document.body.append(failed, loading, loaded, empty);
		stop = installPictureFallback(document, () => false);
		expect(failed.dataset['fallback']).toBe('1');
		expect(loading.dataset['fallback']).toBeUndefined();
		expect(loaded.dataset['fallback']).toBeUndefined();
		expect(empty.dataset['fallback']).toBeUndefined();
	});
});

describe('early picture preload: the edges', () => {
	it('writes a plain preload for every band at the end of a head without stylesheets', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
		const head = TestBed.inject(DOCUMENT).head;
		head.innerHTML = '<meta charset="utf-8">';
		const preload = TestBed.inject(HeadPreload);
		preload.picture({ href: '/h.webp', srcset: null, sizes: '100vw', media: null });
		preload.picture({ href: '/h.webp', srcset: null, sizes: '100vw', media: null });
		const links = head.querySelectorAll('link[rel="preload"]');
		expect(links).toHaveLength(1);
		expect(links[0]?.hasAttribute('imagesrcset')).toBe(false);
		expect(links[0]?.hasAttribute('media')).toBe(false);
		expect(head.lastElementChild).toBe(links[0]);
	});

	it('gives a picture without a phone file the tablet band from the top down', () => {
		expect(pictureBandMedia({ phone: false, tablet: true })).toEqual({
			phone: null,
			tablet: '(max-width: 1199px)',
			desktop: '(min-width: 1200px)',
		});
	});
});
