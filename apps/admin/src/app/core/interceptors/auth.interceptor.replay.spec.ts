import { HttpContext, HttpErrorResponse, HttpEvent, HttpRequest, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { CsrfTokens } from '@core/auth/csrf-tokens';
import { IdleLockService } from '@core/auth/idle-lock.service';
import { AuthStore } from '@core/state/auth.store';
import { UnsavedChanges } from '@core/unsaved/unsaved-changes';
import { NotificationService } from '@data-access/services/notification.service';

import { AuthInterceptor } from './auth.interceptor';
import { CSRF_REPLAY, QUIET_ERRORS } from './global-error-handler.interceptor';

describe('a CSRF replay keeps what the request said about itself', () => {
	it('copies the first attempt’s context onto the replay, marked as the replay', async () => {
		const tokens = new CsrfTokens();
		tokens.remember('stale-token');
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				AuthInterceptor,
				{ provide: Router, useValue: { navigate: vi.fn() } },
				{ provide: AuthStore, useValue: { clear: vi.fn() } },
				{ provide: NotificationService, useValue: { notification: true } },
				{
					provide: AdminAuthGateway,
					useValue: {
						isCredentialEndpoint: () => false,
						isSessionEstablishingEndpoint: () => false,
						isPresenceProofEndpoint: () => false,
						ensureCsrfToken: () => {
							tokens.remember('fresh-token');
							return of(undefined);
						},
						refreshSession: () => of(undefined),
					},
				},
				{ provide: CsrfTokens, useValue: tokens },
				{
					provide: IdleLockService,
					useValue: { lockFromServer: vi.fn(), whenUnlocked: () => Promise.resolve() },
				},
				{ provide: UnsavedChanges, useValue: { markSaved: vi.fn() } },
			],
		});
		const sent: HttpRequest<unknown>[] = [];
		const handler = {
			handle: (request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> => {
				sent.push(request);
				return sent.length === 1
					? throwError(
							() =>
								new HttpErrorResponse({
									status: 403,
									error: { error: { code: 'forbidden', reason: 'csrf_rejected' } },
								}),
						)
					: of(new HttpResponse({ status: 200 }));
			},
		};
		const quiet = new HttpRequest('POST', '/orders', {}, { context: new HttpContext().set(QUIET_ERRORS, true) });
		await firstValueFrom(TestBed.inject(AuthInterceptor).intercept(quiet, handler));
		const [first, replay] = sent;
		expect(first?.context.get(CSRF_REPLAY)).toBe(false);
		expect(replay?.context.get(QUIET_ERRORS)).toBe(true);
		expect(replay?.context.get(CSRF_REPLAY)).toBe(true);
		expect(replay?.headers.get('x-csrf-token')).toBe('fresh-token');
	});
});
