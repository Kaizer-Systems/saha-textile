import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { HeadPreload, pictureBandMedia } from './head-preload';

const setup = (platform: string) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	const document = TestBed.inject(DOCUMENT);
	document.head.innerHTML =
		'<meta charset="utf-8"><link rel="stylesheet" href="/a.css"><script src="/m.js"></script>';
	return { preload: TestBed.inject(HeadPreload), head: document.head };
};

describe('early picture preload (FX-13)', () => {
	it('writes one preload per band on the server, before the stylesheets, once per picture', () => {
		const { preload, head } = setup('server');
		const hero = {
			href: '/h-1920.webp',
			srcset: '/h-960.webp 960w, /h-1920.webp 1920w',
			sizes: '100vw',
			media: '(min-width: 1200px)',
		};
		preload.picture(hero);
		preload.picture(hero);
		const links = head.querySelectorAll('link[rel="preload"]');
		expect(links).toHaveLength(1);
		const link = links[0] as HTMLLinkElement;
		expect(link.getAttribute('imagesrcset')).toBe(hero.srcset);
		expect(link.getAttribute('media')).toBe('(min-width: 1200px)');
		expect(link.getAttribute('fetchpriority')).toBe('high');
		expect(head.firstElementChild?.nextElementSibling).toBe(link);
	});

	it('does nothing in the browser, where the links are already in the HTML', () => {
		const { preload, head } = setup('browser');
		preload.picture({ href: '/h.webp', srcset: null, sizes: '100vw', media: null });
		expect(head.querySelectorAll('link[rel="preload"]')).toHaveLength(0);
	});

	it('splits the bands like the <picture> sources, never overlapping', () => {
		expect(pictureBandMedia({ phone: true, tablet: true })).toEqual({
			phone: '(max-width: 767px) and (orientation: portrait)',
			tablet: '(max-width: 767px) and (orientation: landscape), (min-width: 768px) and (max-width: 1199px)',
			desktop: '(min-width: 1200px)',
		});
		expect(pictureBandMedia({ phone: true, tablet: false })).toEqual({
			phone: '(max-width: 767px) and (orientation: portrait)',
			tablet: null,
			desktop: '(max-width: 767px) and (orientation: landscape), (min-width: 768px)',
		});
		expect(pictureBandMedia({ phone: false, tablet: false })).toEqual({ phone: null, tablet: null, desktop: null });
	});
});
