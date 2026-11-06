import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { ErrorHandler, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError, TimeoutError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { GlobalErrorHandler } from '@core/error/global-error-handler';
import { ErrorService } from '@data-access/services/error.service';
import { NotificationService } from '@data-access/services/notification.service';

import { ServerApiTimeoutInterceptor } from './server-api-timeout.interceptor';
import { ServerInterceptor } from './server.interceptor';
import { environment } from '../../../../public/environments/environment';

const handler = (result: unknown) => ({ handle: vi.fn(() => result) }) as never;

describe('ServerInterceptor', () => {
	const run = (platform: string) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [ServerInterceptor, { provide: PLATFORM_ID, useValue: platform }],
		});
		return TestBed.inject(ServerInterceptor);
	};
	const request = new HttpRequest('GET', '/x');

	it('answers empty on the server', async () => {
		const answer = await firstValueFrom(run('server').intercept(request, handler(of('real'))));
		expect((answer as HttpResponse<unknown>).status).toBe(200);
	});

	it('passes through in the browser', async () => {
		await expect(firstValueFrom(run('browser').intercept(request, handler(of('real'))))).resolves.toBe('real');
	});
});

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

describe('GlobalErrorHandler', () => {
	const run = () => {
		const notifier = { showError: vi.fn() };
		const errors = { getServerErrorMessage: vi.fn(() => 'Readable') };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				GlobalErrorHandler,
				{ provide: ErrorService, useValue: errors },
				{ provide: NotificationService, useValue: notifier },
			],
		});
		return { handler: TestBed.inject(GlobalErrorHandler) as ErrorHandler, notifier };
	};

	it('shows an HTTP failure', () => {
		const { handler: errorHandler, notifier } = run();
		errorHandler.handleError(new HttpErrorResponse({ status: 500 }));
		expect(notifier.showError).toHaveBeenCalledWith('Readable');
	});

	it('does not show other errors to the customer', () => {
		const { handler: errorHandler, notifier } = run();
		errorHandler.handleError(new Error('bug'));
		expect(notifier.showError).not.toHaveBeenCalled();
	});
});
