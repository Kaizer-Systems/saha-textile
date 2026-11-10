import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbRatingConfig } from '@ng-bootstrap/ng-bootstrap';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopEvents } from '@core/events/shop-events';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { SettingStore } from '@core/state/setting.store';
import { SiteConfigStore } from '@core/state/site-config.store';

import { App } from './app';

const WORDS: Record<string, string> = {
	tab_come_back: '⚡ Come Back !!',
	tab_offers_for_you: '🎉 Offers for you...',
	event_sale_ends_in: 'ends in',
	event_unit_day: 'd',
	event_unit_hour: 'h',
};
const stripItems = signal<unknown[]>([]);

const render = (url = '/') => {
	const siteConfig = signal<unknown>(null);
	const events = new Subject<unknown>();
	const meta = { updateTag: vi.fn() };
	const seo = { setDefaultImage: vi.fn(), resetDocument: vi.fn() };
	const title = { setTitle: vi.fn(), getTitle: vi.fn(() => 'Sarees | Saha Textile') };
	const stores = { loadSettings: vi.fn(), loadSiteConfig: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: { url, events } },
			{ provide: Title, useValue: title },
			{ provide: Meta, useValue: meta },
			{ provide: LocaleSeo, useValue: seo },
			{ provide: SettingStore, useValue: { loadSettings: stores.loadSettings } },
			{ provide: SiteConfigStore, useValue: { siteConfig, loadSiteConfig: stores.loadSiteConfig } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => WORDS[key] ?? key } },
			{
				provide: ShopEvents,
				useValue: {
					stripItems,
					left: (iso: string | null) => (iso ? { days: 1, hours: 9, minutes: 0, seconds: 0 } : null),
				},
			},
		],
	});
	TestBed.overrideComponent(App, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(App);
	return { fixture, app: fixture.componentInstance, siteConfig, events, meta, seo, title, stores };
};
const html = () => document.documentElement;
const hide = (hidden: boolean) => {
	Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
	document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
	const icon = document.createElement('link');
	icon.id = 'appIcon';
	document.head.append(icon);
});

afterEach(() => {
	document.querySelector('#appIcon')?.remove();
	html().classList.remove('dark');
	html().removeAttribute('dir');
	document.body.classList.remove('rtl');
	Object.defineProperty(document, 'hidden', { configurable: true, value: false });
	stripItems.set([]);
	vi.useRealTimers();
});

describe('App', () => {
	it('loads the global data and sets the star ratings to read-only', () => {
		const { stores } = render();
		expect(stores.loadSettings).toHaveBeenCalledOnce();
		expect(stores.loadSiteConfig).toHaveBeenCalledOnce();
		expect(TestBed.inject(NgbRatingConfig)).toMatchObject({ max: 5, readonly: true });
	});

	it('shows the shell everywhere except maintenance', () => {
		const shown = (url: string) => (render(url).app as unknown as { showLayout: boolean }).showLayout;
		expect(shown('/collections')).toBe(true);
		expect(shown('/maintenance')).toBe(false);
	});

	it('applies dark mode and right-to-left from the theme, but not its demo share picture', () => {
		const { siteConfig, meta, seo } = render();
		siteConfig.set({
			general: { mode: 'dark', language_direction: 'rtl' },
			seo: {
				og_title: 'OG title',
				og_description: 'OG description',
				og_image: { original_url: '/og.jpg' },
				meta_title: 'Title',
				meta_description: 'Description',
				meta_tags: 'sarees',
			},
		});
		TestBed.tick();
		expect(html().classList.contains('dark')).toBe(true);
		expect(html().getAttribute('dir')).toBe('rtl');
		expect(document.body.classList.contains('rtl')).toBe(true);
		// The theme file's text is one language for every page, so titles and descriptions come
		// from each page instead (LocaleSeo).
		// The default share picture comes from the Brand Kit now (Layout), never the theme file.
		expect(seo.setDefaultImage).not.toHaveBeenCalled();
		expect(meta.updateTag).not.toHaveBeenCalled();
	});

	it('goes back to light and left-to-right, with an empty theme touching nothing else', () => {
		const { siteConfig, meta, seo } = render();
		html().classList.add('dark');
		html().setAttribute('dir', 'rtl');
		document.body.classList.add('rtl');
		siteConfig.set({ general: { mode: 'light' }, seo: {} });
		TestBed.tick();
		expect(html().classList.contains('dark')).toBe(false);
		expect(html().hasAttribute('dir')).toBe(false);
		expect(meta.updateTag).not.toHaveBeenCalled();
		expect(seo.setDefaultImage).not.toHaveBeenCalled();
		expect((document.querySelector('#appIcon') as HTMLLinkElement).getAttribute('href')).toBeNull();
	});

	it('resets the page head at each navigation start only', () => {
		const { events, seo } = render();
		events.next(new NavigationEnd(1, '/', '/'));
		expect(seo.resetDocument).not.toHaveBeenCalled();
		events.next(new NavigationStart(2, '/a'));
		expect(seo.resetDocument).toHaveBeenCalledWith('Saha Textile');
	});

	it('rotates the come-back messages while hidden, then restores the title', () => {
		vi.useFakeTimers();
		const { fixture, app, title } = render();
		hide(true);
		expect(app.isTabInFocus).toBe(false);
		expect(title.setTitle).toHaveBeenLastCalledWith('⚡ Come Back !!');
		vi.advanceTimersByTime(1000);
		expect(title.setTitle).toHaveBeenLastCalledWith('🎉 Offers for you...');
		vi.advanceTimersByTime(1000);
		expect(title.setTitle).toHaveBeenLastCalledWith('⚡ Come Back !!');
		hide(false);
		expect(title.setTitle).toHaveBeenLastCalledWith('Sarees | Saha Textile');
		const calls = title.setTitle.mock.calls.length;
		vi.advanceTimersByTime(3000);
		expect(title.setTitle.mock.calls.length).toBe(calls);
		hide(true);
		fixture.destroy();
		const afterDestroy = title.setTitle.mock.calls.length;
		vi.advanceTimersByTime(3000);
		expect(title.setTitle.mock.calls.length).toBe(afterDestroy);
	});

	it('swaps the second line for a published event while one has a top bar line', () => {
		vi.useFakeTimers();
		stripItems.set([{ id: 'e', type: 'sale', phase: 'running', title: 'Puja Sale', countdownTo: 'x' }]);
		const { title } = render();
		hide(true);
		vi.advanceTimersByTime(1000);
		expect(title.setTitle).toHaveBeenLastCalledWith('🎉 Puja Sale ends in 1d 9h');
	});

	it('names a launched event without a countdown', () => {
		vi.useFakeTimers();
		stripItems.set([{ id: 'e', type: 'launch', phase: 'launched', title: 'Puja Collection', countdownTo: null }]);
		const { title } = render();
		hide(true);
		vi.advanceTimersByTime(1000);
		expect(title.setTitle).toHaveBeenLastCalledWith('🎉 Puja Collection event_now_live');
	});
});
