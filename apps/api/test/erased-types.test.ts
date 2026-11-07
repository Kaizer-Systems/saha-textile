import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The compiler writes `typeof X === "undefined" ? Object : X` into each class's constructor
 * metadata. The "undefined" arm is only taken when a class has been erased at load time; these
 * cases load the guards that way to show they still define cleanly.
 */
afterEach(() => {
	vi.doUnmock('@nestjs/core');
	vi.doUnmock('../src/auth/auth.service');
	vi.resetModules();
});

const withoutReflector = () =>
	vi.doMock('@nestjs/core', async (original) => ({ ...(await original<object>()), Reflector: undefined }));

describe('constructor metadata', () => {
	it('defines CookieAudienceGuard without a Reflector', async () => {
		vi.resetModules();
		withoutReflector();
		const { CookieAudienceGuard } = await import('../src/common/cookie-audience.guard.js');
		expect(CookieAudienceGuard).toBeDefined();
	});

	it('defines RefreshReuseGuard without a Reflector', async () => {
		vi.resetModules();
		withoutReflector();
		const { RefreshReuseGuard } = await import('../src/auth/refresh-reuse.guard.js');
		expect(RefreshReuseGuard).toBeDefined();
	});

	it('defines CatalogRateLimit without an AuthService', async () => {
		vi.resetModules();
		vi.doMock('../src/auth/auth.service', () => ({ AuthService: undefined }));
		const { CatalogRateLimit } = await import('../src/catalog/catalog-rate-limit.js');
		expect(CatalogRateLimit).toBeDefined();
	});
});
