import { describe, expect, it } from 'vitest';

import { isRelativeApiPath, joinApiUrl } from '../src/api-url.js';

describe('joinApiUrl', () => {
	it.each([
		['http://localhost:4000', '/auth/csrf', 'http://localhost:4000/auth/csrf'],
		['http://localhost:4000/', '/auth/csrf', 'http://localhost:4000/auth/csrf'],
		['http://localhost:4000', 'auth/csrf', 'http://localhost:4000/auth/csrf'],
		['http://localhost:4000///', '/auth/csrf', 'http://localhost:4000/auth/csrf'],
		['http://localhost:4000', '//auth/csrf'.slice(1), 'http://localhost:4000/auth/csrf'],
		['https://api.example.test/v1', '/auth/storefront/me', 'https://api.example.test/v1/auth/storefront/me'],
	])('joins %s + %s', (base, path, expected) => {
		expect(joinApiUrl(base, path)).toBe(expected);
	});

	it('returns the bare base for an empty path', () => {
		expect(joinApiUrl('http://localhost:4000/', '/')).toBe('http://localhost:4000');
	});

	// Every request from these apps carries `withCredentials: true`. A path that silently
	// became another origin would attempt to send session cookies there.
	it.each([
		'http://evil.test/steal',
		'https://evil.test/steal',
		'//evil.test/steal',
		// A third slash does not make it safe: the browser still reads this as authority-less
		// protocol-relative, so it must be refused rather than normalized into a route.
		'///auth/csrf',
		'\\\\evil.test/steal',
		'/\\evil.test/steal',
		'javascript:alert(1)',
		'data:text/html,x',
	])('refuses %s as a route path', (path) => {
		expect(() => joinApiUrl('http://localhost:4000', path)).toThrow(/must be relative/);
		expect(isRelativeApiPath(path)).toBe(false);
	});

	it.each(['/auth/csrf', 'auth/csrf', '/catalog/products?status=live', '/orders/abc%2Fdef'])(
		'accepts %s as relative',
		(path) => {
			expect(isRelativeApiPath(path)).toBe(true);
		},
	);
});
