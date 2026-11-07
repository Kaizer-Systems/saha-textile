import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { ErrorHandler, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError, TimeoutError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ErrorService } from '@data-access/services/error.service';
import { NotificationService } from '@data-access/services/notification.service';

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
