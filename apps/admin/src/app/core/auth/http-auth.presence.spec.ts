import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthGateway } from './auth-gateway';
import { CsrfTokens } from './csrf-tokens';
import { HttpAdminAuthGateway } from './http-auth.gateway';

describe('the lock and presence calls', () => {
	it('lock the session and mark activity quietly, answering nothing', async () => {
		const http = { post: vi.fn(() => of({ ok: true })) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: HttpClient, useValue: http },
				{ provide: CsrfTokens, useValue: { remember: vi.fn() } },
			],
		});
		const gateway = TestBed.inject(HttpAdminAuthGateway);
		await expect(firstValueFrom(gateway.lockSession())).resolves.toBeUndefined();
		await expect(firstValueFrom(gateway.markActivity())).resolves.toBeUndefined();
		// Two calls to two addresses; http-auth.gateway.spec.ts owns which addresses they are.
		const urls = new Set(http.post.mock.calls.map((call) => String((call as unknown[])[0])));
		expect(urls.size).toBe(2);
	});

	it('say nothing about a key-leak sign-out and know no presence proof by default', async () => {
		const plain = Object.create(AdminAuthGateway.prototype) as AdminAuthGateway;
		await expect(firstValueFrom(plain.sessionNotice())).resolves.toBeNull();
		expect(plain.isPresenceProofEndpoint('/any-address')).toBe(false);
	});
});
