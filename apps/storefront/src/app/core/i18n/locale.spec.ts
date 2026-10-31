import { describe, expect, it } from 'vitest';

import { isPrivatePath, localeOfPath, localeRedirectFor, withLocale } from './locale';

describe('locale URL law (DEC-I18N-ROUTES)', () => {
	describe('localeRedirectFor', () => {
		// `/` is the only answer that depends on the visitor, so it is the only 302.
		it('sends / to the remembered locale', () => {
			expect(localeRedirectFor('/', 'fr')).toEqual({ location: '/fr/', status: 302 });
		});

		it('sends / to English when nothing, or nothing valid, is remembered', () => {
			expect(localeRedirectFor('/', undefined)).toEqual({ location: '/en/', status: 302 });
			expect(localeRedirectFor('/', 'de')).toEqual({ location: '/en/', status: 302 });
		});

		it('keeps the query string on every redirect', () => {
			expect(localeRedirectFor('/?utm_source=ig', undefined)?.location).toBe('/en/?utm_source=ig');
			expect(localeRedirectFor('/collections/sarees?page=2', undefined)?.location).toBe(
				'/en/collections/sarees?page=2',
			);
		});

		// Today's unprefixed links and surviving legacy paths: permanent, and never to the cookie's
		// language — a 301 is cached, so it must not depend on who asked first.
		it('moves an unprefixed page to its English address permanently, whatever is remembered', () => {
			expect(localeRedirectFor('/cart', 'fr')).toEqual({ location: '/en/cart', status: 301 });
			expect(localeRedirectFor('/product/red-katan/', undefined)).toEqual({
				location: '/en/product/red-katan/',
				status: 301,
			});
		});

		it('gives the home page one address per language', () => {
			expect(localeRedirectFor('/fr', undefined)).toEqual({ location: '/fr/', status: 301 });
			expect(localeRedirectFor('/fr/', undefined)).toBeNull();
		});

		it('serves a prefixed page as it is', () => {
			expect(localeRedirectFor('/fr/cart', 'en')).toBeNull();
			expect(localeRedirectFor('/en/collections/sarees?page=2', undefined)).toBeNull();
		});

		// An unsupported language is not a language the site has; it is an unknown page.
		it('treats an unsupported language prefix as an unprefixed path', () => {
			expect(localeRedirectFor('/de/cart', undefined)).toEqual({ location: '/en/de/cart', status: 301 });
		});

		it('leaves assets, the API and dev-server internals alone', () => {
			for (const path of [
				'/assets/images/logo.png',
				'/assets/i18n/fr.json',
				'/api/products?page=1',
				'/config.json',
				'/favicon.ico',
				'/_analog/fn/abc',
				'/@vite/client',
				'/@fs/Users/x/main.ts',
				'/__analog/routes',
				'/node_modules/.vite/deps/x.js',
				'/src/main.ts',
				'/.well-known/assetlinks.json',
			]) {
				expect(localeRedirectFor(path, undefined)).toBeNull();
			}
		});
	});

	describe('withLocale', () => {
		it('puts an app URL under a language, home with its slash', () => {
			expect(withLocale('fr', '/')).toBe('/fr/');
			expect(withLocale('fr', '/cart')).toBe('/fr/cart');
			expect(withLocale('en', '/collections/sarees?page=2#top')).toBe('/en/collections/sarees?page=2#top');
		});
	});

	describe('localeOfPath', () => {
		it('reads only a supported first segment', () => {
			expect(localeOfPath('/fr/cart')).toBe('fr');
			expect(localeOfPath('/en')).toBe('en');
			expect(localeOfPath('/de/cart')).toBeNull();
			expect(localeOfPath('/french-silk')).toBeNull();
			expect(localeOfPath('/?lang=fr')).toBeNull();
		});
	});

	describe('isPrivatePath', () => {
		it('covers the customer-only areas and nothing that merely starts with their names', () => {
			expect(isPrivatePath('/account/dashboard')).toBe(true);
			expect(isPrivatePath('/auth/login')).toBe(true);
			expect(isPrivatePath('/cart')).toBe(true);
			expect(isPrivatePath('/checkout?step=2')).toBe(true);
			expect(isPrivatePath('/cartier-silk')).toBe(false);
			expect(isPrivatePath('/collections/sarees')).toBe(false);
			expect(isPrivatePath('/')).toBe(false);
		});
	});
});
