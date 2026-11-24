import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthGateway } from '@core/auth/auth-gateway';

import { AuthStore } from './auth.store';

const ME = {
	user: { id: 'user_admin', email: 'operator@example.com', role: 'admin', status: 'active' },
	permissions: ['catalog.product.view'],
	session: { audience: 'admin', expiresAt: '2026-08-02T10:15:00.000Z', refreshExpiresAt: null },
};

describe('a refused unlock whose session check fails too', () => {
	it('signs out with the credentials message, and forgets the mail it had read', async () => {
		const queries = new QueryClient();
		const removed = vi.spyOn(queries, 'removeQueries');
		let reachable = true;
		const gateway = {
			currentUser: vi.fn(() => (reachable ? of(ME) : throwError(() => new Error('offline')))),
			ensureCsrfToken: vi.fn(() => of(undefined)),
			refreshSession: vi.fn(() => of(undefined)),
			resumeWithPin: vi.fn(() => throwError(() => new Error('rejected'))),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: AdminAuthGateway, useValue: gateway },
				{ provide: Router, useValue: { navigate: vi.fn() } },
				{ provide: QueryClient, useValue: queries },
			],
		});
		const store = TestBed.inject(AuthStore);
		await store.bootstrap();
		expect(store.isAuthenticated()).toBe(true);

		reachable = false;
		expect(await store.resumeWithPin('135790')).toBe(false);
		expect(store.isAuthenticated()).toBe(false);
		expect(store.error()).toBe('invalid_credentials');
		expect(removed).toHaveBeenCalled();
	});
});
