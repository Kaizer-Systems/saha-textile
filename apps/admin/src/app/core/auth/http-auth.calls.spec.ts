import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CsrfTokens } from './csrf-tokens';
import { HttpAdminAuthGateway } from './http-auth.gateway';

/** What each call sends. The classification spec beside this file owns the URLs. */
describe('HttpAdminAuthGateway calls', () => {
	const http = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
	let gateway: HttpAdminAuthGateway;

	beforeEach(() => {
		for (const call of Object.values(http)) call.mockReset().mockReturnValue(of({}));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: HttpClient, useValue: http },
				{ provide: CsrfTokens, useValue: { remember: vi.fn() } },
			],
		});
		gateway = TestBed.inject(HttpAdminAuthGateway);
	});

	it('treats a failed session read as signed out', async () => {
		http.get.mockReturnValue(throwError(() => new Error('401')));
		await expect(firstValueFrom(gateway.currentUser())).resolves.toBeNull();
	});

	it.each<[string, () => unknown, unknown]>([
		['resume with a PIN', () => gateway.resumeWithPin('1234'), { pin: '1234' }],
		['resume with a password', () => gateway.resumeWithPassword('p'), { password: 'p' }],
		['remove the PIN', () => gateway.removePin('p'), { currentPassword: 'p' }],
		['log in', () => gateway.loginWithPassword({ identifier: 'a' } as never), { identifier: 'a' }],
		['log in with a PIN', () => gateway.loginWithPin({ identifier: 'a' } as never), { identifier: 'a' }],
		['reset', () => gateway.resetPassword({ token: 't' } as never), { token: 't' }],
		['set the PIN', () => gateway.setPin({ pin: '1' } as never), { pin: '1' }],
		['change the password', () => gateway.changePassword({ newPassword: 'n' } as never), { newPassword: 'n' }],
		['log out', () => gateway.logout(), {}],
		['revoke other sessions', () => gateway.revokeOtherSessions(), {}],
	])('%s posts its input', (_name, call, body) => {
		call();
		expect(http.post.mock.lastCall?.[1]).toEqual(body);
	});

	it.each<[string, () => unknown]>([
		['forgot', () => gateway.requestPasswordReset('a')],
		['invite', () => gateway.createInvite({ email: 'a' } as never)],
		['accept', () => gateway.acceptInvite({ token: 't' } as never)],
	])('%s hides the answer', async (_name, call) => {
		await expect(firstValueFrom(call() as never)).resolves.toBeUndefined();
	});

	it('lists the sessions', async () => {
		http.get.mockReturnValue(of({ items: [{ id: 's1' }] }));
		await expect(firstValueFrom(gateway.listSessions())).resolves.toEqual([{ id: 's1' }]);
	});

	it('reads the security settings', () => {
		gateway.securitySettings();
		expect(http.get).toHaveBeenCalledOnce();
	});

	it('revokes one session by its escaped id', () => {
		gateway.revokeSession('s 1');
		expect(String(http.delete.mock.lastCall?.[0])).toMatch(/s%201$/);
	});

	it('updates the profile', () => {
		gateway.updateProfile({ displayName: 'Asha' });
		expect(http.patch.mock.lastCall?.[1]).toEqual({ displayName: 'Asha' });
	});

	it('survives a URL that cannot be parsed', () => {
		expect(gateway.isCredentialEndpoint('http://[bad?x=1')).toBe(false);
		expect(gateway.isSessionEstablishingEndpoint('http://[bad?x=1')).toBe(false);
	});
});
