import { afterEach, describe, expect, it } from 'vitest';

import { CSRF_HEADER_NAME, CsrfTokenHolder, hasBrowserCookieJar, isUnsafeMethod } from '../src/csrf.js';

describe('isUnsafeMethod', () => {
	it.each(['GET', 'get', 'HEAD', 'OPTIONS', 'options'])('treats %s as safe', (method) => {
		expect(isUnsafeMethod(method)).toBe(false);
	});

	it.each(['POST', 'put', 'PATCH', 'DELETE'])('treats %s as unsafe', (method) => {
		expect(isUnsafeMethod(method)).toBe(true);
	});
});

describe('CSRF_HEADER_NAME', () => {
	it('is the header the API reads', () => {
		expect(CSRF_HEADER_NAME).toBe('x-csrf-token');
	});
});

describe('CsrfTokenHolder', () => {
	it('starts empty and returns what it was given', () => {
		const holder = new CsrfTokenHolder();
		expect(holder.current()).toBeNull();

		holder.remember('tok');
		expect(holder.current()).toBe('tok');
	});

	it('shares one fetch between concurrent callers', async () => {
		const holder = new CsrfTokenHolder();
		let fetches = 0;
		let finish = (): void => undefined;
		const fetchToken = () => {
			fetches += 1;
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		};

		const both = Promise.all([holder.acquire(fetchToken), holder.acquire(fetchToken)]);
		finish();
		await both;

		expect(fetches).toBe(1);
	});

	it('fetches again once the previous fetch has settled, even after a failure', async () => {
		const holder = new CsrfTokenHolder();
		await expect(holder.acquire(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');

		let fetched = false;
		await holder.acquire(() => {
			fetched = true;
			return Promise.resolve();
		});
		expect(fetched).toBe(true);
	});
});

describe('hasBrowserCookieJar', () => {
	afterEach(() => {
		delete (globalThis as { document?: unknown }).document;
	});

	// The distinction that matters: an EMPTY jar in a browser is recoverable — the app can ask
	// the API for a token — while no jar at all means server rendering, where recovery is
	// meaningless rather than merely missing a value.
	it('is true for an empty browser jar', () => {
		(globalThis as { document?: unknown }).document = { cookie: '' };

		expect(hasBrowserCookieJar()).toBe(true);
	});

	it('is true for a populated jar', () => {
		(globalThis as { document?: unknown }).document = { cookie: 'language=en' };
		expect(hasBrowserCookieJar()).toBe(true);
	});

	it('is false under server rendering, where there is no document', () => {
		expect(hasBrowserCookieJar()).toBe(false);
	});

	it('is false when document exposes no cookie string', () => {
		(globalThis as { document?: unknown }).document = {};
		expect(hasBrowserCookieJar()).toBe(false);
	});
});
