import { TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { REQUEST } from '@analogjs/router/tokens';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACTIVE_LOCALE, SHOP_LOCALES_STATE } from './active-locale';
import {
	isLocale,
	localeOfPath,
	localeRedirectFor,
	openGraphLocale,
	refreshSupportedLocales,
	resetSupportedLocales,
	retiredLocaleRedirect,
	retiredLocales,
	setRetiredLocales,
	setSupportedLocales,
	supportedLocales,
	supportedLocalesReady,
} from './locale';

const answer = (body: unknown, ok = true) =>
	vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok, json: async () => body } as Response);

afterEach(() => vi.restoreAllMocks());

describe('a language the shop no longer shows (Settings › Languages)', () => {
	it('sends its pages to the same page in English for good, kept an hour', async () => {
		resetSupportedLocales();
		answer({ default: 'en', active: ['en'], redirect: ['bn'] });
		await refreshSupportedLocales('https://api.test', 2_000_000);
		expect(retiredLocales()).toEqual(['bn']);
		const kept = { status: 301, cacheSeconds: 3600 };
		expect(localeRedirectFor('/bn/product/red-saree?colour=red', undefined)).toEqual({
			location: '/en/product/red-saree?colour=red',
			...kept,
		});
		expect(localeRedirectFor('/bn', undefined)).toEqual({ location: '/en/', ...kept });
		expect(localeRedirectFor('/bn/', undefined)).toEqual({ location: '/en/', ...kept });
		expect(retiredLocaleRedirect('/bn/assets/logo.png')).toBeNull();
		expect(retiredLocaleRedirect('/en/cart')).toBeNull();
	});

	it('never retires English or a language the shop shows, and forgets the list on reset', () => {
		setSupportedLocales(['en', 'hi']);
		setRetiredLocales({ redirect: ['en', 'hi', 'bn', 'not a code'] });
		expect(retiredLocales()).toEqual(['bn']);
		setRetiredLocales(['ta']);
		expect(retiredLocales()).toEqual(['ta']);
		setRetiredLocales(null);
		expect(retiredLocales()).toEqual([]);
		setRetiredLocales(['bn']);
		resetSupportedLocales();
		expect(retiredLocales()).toEqual([]);
	});
});

describe('the shop’s language list (from the API)', () => {
	it('is English alone until the API answers, and trusts any language prefix meanwhile', () => {
		resetSupportedLocales();
		expect([supportedLocales(), supportedLocalesReady()]).toEqual([['en'], false]);
		// An outage at start-up must never send /bn/… on a permanent redirect to /en/bn/….
		expect(isLocale('bn')).toBe(true);
		expect(localeRedirectFor('/bn/cart', undefined)).toBeNull();
		expect(isLocale('faqs')).toBe(false);
	});

	it('loads the list once a minute, English first, and then knows exactly which prefixes are languages', async () => {
		resetSupportedLocales();
		const fetched = answer({ default: 'en', active: ['en', 'bn', 'hi'] });
		await refreshSupportedLocales('https://api.test', 1_000_000);
		expect(fetched).toHaveBeenCalledWith('https://api.test/storefront/languages');
		expect([supportedLocales(), supportedLocalesReady()]).toEqual([['en', 'bn', 'hi'], true]);
		expect(localeOfPath('/hi/cart')).toBe('hi');
		expect(isLocale('ta')).toBe(false);
		expect(localeRedirectFor('/ta/cart', undefined)).toEqual({ location: '/en/ta/cart', status: 301 });
		await refreshSupportedLocales('https://api.test', Date.now() + 30_000);
		expect(fetched).toHaveBeenCalledTimes(1);
	});

	it('keeps the last list when the API fails or answers nonsense, and asks again soon', async () => {
		setSupportedLocales(['en', 'bn']);
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
		await refreshSupportedLocales('https://api.test', Date.now() + 61_000);
		expect(supportedLocales()).toEqual(['en', 'bn']);
		answer({ active: 'en' });
		await refreshSupportedLocales('https://api.test', Date.now() + 61_000);
		answer({}, false);
		await refreshSupportedLocales('https://api.test', Date.now() + 61_000);
		expect(supportedLocales()).toEqual(['en', 'bn']);
	});

	it('ignores a list that is not one', () => {
		setSupportedLocales(['en', 'bn']);
		setSupportedLocales('en');
		setSupportedLocales([]);
		expect(supportedLocales()).toEqual(['en', 'bn']);
	});

	it('names each language’s Open Graph locale the Indian way', () => {
		expect(['en', 'bn', 'hi', 'en-GB'].map(openGraphLocale)).toEqual(['en_IN', 'bn_IN', 'hi_IN', 'en_IN']);
	});
});

describe('ACTIVE_LOCALE adopts the list', () => {
	it('on the server from the request, and hands it to the browser', () => {
		TestBed.configureTestingModule({
			providers: [{ provide: REQUEST, useValue: { url: '/hi/cart', shopLocales: ['en', 'bn', 'hi'] } }],
		});
		expect(TestBed.inject(ACTIVE_LOCALE)).toBe('hi');
		expect(TestBed.inject(TransferState).get(SHOP_LOCALES_STATE, [])).toEqual(['en', 'bn', 'hi']);
	});

	it('in the browser from the server render', () => {
		resetSupportedLocales();
		TestBed.configureTestingModule({ providers: [] });
		TestBed.inject(TransferState).set(SHOP_LOCALES_STATE, ['en', 'ta']);
		TestBed.inject(ACTIVE_LOCALE);
		expect(supportedLocales()).toEqual(['en', 'ta']);
	});
});
