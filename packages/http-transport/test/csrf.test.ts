import { afterEach, describe, expect, it } from 'vitest';

import {
	CSRF_COOKIE_NAMES,
	CSRF_HEADER_NAME,
	hasBrowserCookieJar,
	isUnsafeMethod,
	readCsrfToken,
	readCsrfTokenFrom,
} from '../src/csrf.js';

describe('isUnsafeMethod', () => {
	it.each(['GET', 'get', 'HEAD', 'OPTIONS', 'options'])('treats %s as safe', (method) => {
		expect(isUnsafeMethod(method)).toBe(false);
	});

	it.each(['POST', 'put', 'PATCH', 'DELETE'])('treats %s as unsafe', (method) => {
		expect(isUnsafeMethod(method)).toBe(true);
	});
});

describe('readCsrfTokenFrom', () => {
	it('reads the compact st_csrf spelling', () => {
		expect(readCsrfTokenFrom('st_csrf=abc123')).toBe('abc123');
	});

	it('reads the __Host- prefixed spelling used in HTTPS deployments without a pinned domain', () => {
		expect(readCsrfTokenFrom('other=1; __Host-st_csrf=abc123')).toBe('abc123');
	});

	it('finds the cookie among unrelated entries', () => {
		expect(readCsrfTokenFrom('language=en; st_csrf=tok; ngrx_cart=[]')).toBe('tok');
	});

	// The separator is only conventionally '; '. A jar written without the space would make
	// the token invisible, and every mutation would 403 with no obvious cause.
	it('tolerates a jar written without a space after the semicolon', () => {
		expect(readCsrfTokenFrom('language=en;st_csrf=tok')).toBe('tok');
	});

	it('percent-decodes the value', () => {
		expect(readCsrfTokenFrom('st_csrf=a%2Bb%3Dc')).toBe('a+b=c');
	});

	// A malformed value must not throw out of an interceptor and take down the request.
	it('returns null rather than throwing on an undecodable value', () => {
		expect(readCsrfTokenFrom('st_csrf=%E0%A4%A')).toBeNull();
	});

	it.each([
		['empty jar', ''],
		['null jar', null],
		['undefined jar', undefined],
		['no csrf cookie', 'language=en; ngrx_cart=[]'],
		['empty value', 'st_csrf='],
		['entry with no equals sign', 'st_csrf'],
	])('returns null for %s', (_label, jar) => {
		expect(readCsrfTokenFrom(jar)).toBeNull();
	});

	// Prefix matching would accept this; exact name matching must not.
	it('does not match a different cookie whose name merely starts with st_csrf', () => {
		expect(readCsrfTokenFrom('st_csrf_backup=wrong')).toBeNull();
	});

	it('exposes both accepted cookie names and the header the API reads', () => {
		expect([...CSRF_COOKIE_NAMES]).toEqual(['st_csrf', '__Host-st_csrf']);
		expect(CSRF_HEADER_NAME).toBe('x-csrf-token');
	});
});

describe('readCsrfToken (ambient jar)', () => {
	afterEach(() => {
		delete (globalThis as { document?: unknown }).document;
	});

	// SSR has no cookie jar; an unsafe request does not originate there.
	it('returns null when there is no document (server rendering)', () => {
		expect(readCsrfToken()).toBeNull();
	});

	it('returns null when document exists but exposes no cookie string', () => {
		(globalThis as { document?: unknown }).document = {};
		expect(readCsrfToken()).toBeNull();
	});

	it('reads the ambient browser jar when present', () => {
		(globalThis as { document?: unknown }).document = { cookie: 'st_csrf=ambient' };
		expect(readCsrfToken()).toBe('ambient');
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
		expect(readCsrfToken()).toBeNull();
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
