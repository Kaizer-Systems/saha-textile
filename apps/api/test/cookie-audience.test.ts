import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { CookieAudienceGuard } from '../src/common/cookie-audience.guard';
import { cookieNames, requestCookieAudience } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
	CSRF_SECRET: 'c'.repeat(32),
});

describe('per-audience session cookies', () => {
	it('keeps storefront names and gives admin its own', () => {
		const shop = cookieNames(config, 'storefront');
		const admin = cookieNames(config, 'admin');
		expect([shop.access, shop.refresh, shop.csrf].map((name) => name.replace('__Host-', ''))).toEqual([
			'st_access',
			'st_refresh',
			'st_csrf',
		]);
		expect([admin.access, admin.refresh, admin.csrf].map((name) => name.replace('__Host-', ''))).toEqual([
			'st_admin_access',
			'st_admin_refresh',
			'st_admin_csrf',
		]);
		expect(new Set([shop.access, shop.refresh, shop.csrf, admin.access, admin.refresh, admin.csrf]).size).toBe(6);
	});

	it('defaults to storefront when no audience was recorded', () => {
		expect(requestCookieAudience({})).toBe('storefront');
		expect(requestCookieAudience({ cookieAudience: 'admin' })).toBe('admin');
	});

	it('records the route audience on the request', () => {
		const reflector = new Reflector();
		const request: { cookieAudience?: string } = {};
		const context = (audience: string | undefined) => ({
			getHandler: () => () => undefined,
			getClass: () => class {},
			switchToHttp: () => ({ getRequest: () => request }),
			audience,
		});
		vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce('admin').mockReturnValueOnce(undefined);
		const guard = new CookieAudienceGuard(reflector);
		expect(guard.canActivate(context('admin') as never)).toBe(true);
		expect(request.cookieAudience).toBe('admin');
		guard.canActivate(context(undefined) as never);
		expect(request.cookieAudience).toBe('storefront');
	});
});
