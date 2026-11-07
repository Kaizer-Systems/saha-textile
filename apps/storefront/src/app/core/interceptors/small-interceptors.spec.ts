import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { ErrorHandler, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError, TimeoutError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ErrorService } from '@data-access/services/error.service';
import { NotificationService } from '@data-access/services/notification.service';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';

import { CatalogLocaleInterceptor } from './catalog-locale.interceptor';
import { ServerApiTimeoutInterceptor } from './server-api-timeout.interceptor';
import { environment } from '../../../../public/environments/environment';

const handler = (result: unknown) => ({ handle: vi.fn(() => result) }) as never;

describe('ServerApiTimeoutInterceptor', () => {
	const run = () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [ServerApiTimeoutInterceptor] });
		return TestBed.inject(ServerApiTimeoutInterceptor);
	};
	const api = new HttpRequest('GET', `${environment.apiUrl}/catalog/home`);

	it('leaves other hosts alone', async () => {
		const other = new HttpRequest('GET', 'https://elsewhere.test/x');
		await expect(firstValueFrom(run().intercept(other, handler(of('real'))))).resolves.toBe('real');
	});

	it('passes an API answer through', async () => {
		await expect(firstValueFrom(run().intercept(api, handler(of('real'))))).resolves.toBe('real');
	});

	it('turns a timeout into a 504', async () => {
		await expect(
			firstValueFrom(run().intercept(api, handler(throwError(() => new TimeoutError())))),
		).rejects.toMatchObject({ status: 504 });
	});

	it('keeps any other failure', async () => {
		const failure = new Error('down');
		await expect(firstValueFrom(run().intercept(api, handler(throwError(() => failure))))).rejects.toBe(failure);
	});
});

describe('CatalogLocaleInterceptor', () => {
	const run = (request: HttpRequest<unknown>) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [CatalogLocaleInterceptor, { provide: ACTIVE_LOCALE, useValue: 'fr' }],
		});
		const next = { handle: vi.fn((seen: HttpRequest<unknown>) => of(seen as never)) };
		TestBed.inject(CatalogLocaleInterceptor).intercept(request, next as never);
		return next.handle.mock.calls[0]?.[0] as HttpRequest<unknown>;
	};

	it('names the language on catalogue reads and cart calls', () => {
		environment.apiUrl = 'https://api.test';
		expect(run(new HttpRequest('GET', 'https://api.test/catalog/home')).params.get('locale')).toBe('fr');
		expect(run(new HttpRequest('GET', 'https://api.test/cart/current')).params.get('locale')).toBe('fr');
		expect(run(new HttpRequest('POST', 'https://api.test/cart/current/lines', {})).params.get('locale')).toBe('fr');
		expect(run(new HttpRequest('GET', 'https://api.test/account')).params.has('locale')).toBe(false);
		expect(run(new HttpRequest('POST', 'https://api.test/catalog/x', {})).params.has('locale')).toBe(false);
	});
});
