import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { GlobalErrorHandler } from '@core/error/global-error-handler';
import { LoaderStore } from '@core/state/loader.store';
import { ErrorService } from '@data-access/services/error.service';
import { LoggingService } from '@data-access/services/logging.service';
import { NotificationService } from '@data-access/services/notification.service';

import { GlobalErrorHandlerInterceptor } from './global-error-handler.interceptor';
import { LoaderInterceptor } from './loader.interceptor';
import { ServerInterceptor } from './server.interceptor';

const request = new HttpRequest('GET', '/x');
const handler = (result: unknown) => ({ handle: () => result }) as never;

describe('GlobalErrorHandlerInterceptor', () => {
	const run = (error: HttpErrorResponse) => {
		const notifier = { showError: vi.fn() };
		const logger = { logError: vi.fn() };
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				GlobalErrorHandlerInterceptor,
				{ provide: ErrorService, useValue: { getClientErrorMessage: () => 'Readable' } },
				{ provide: LoggingService, useValue: logger },
				{ provide: NotificationService, useValue: notifier },
			],
		});
		const stream = TestBed.inject(GlobalErrorHandlerInterceptor).intercept(
			request,
			handler(throwError(() => error)),
		);
		return { stream, notifier, logger };
	};

	it('leaves a 401 to the auth interceptor', async () => {
		const { stream, notifier } = run(new HttpErrorResponse({ status: 401 }));
		await expect(firstValueFrom(stream)).rejects.toMatchObject({ status: 401 });
		expect(notifier.showError).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it('shows and logs anything else', async () => {
		const { stream, notifier, logger } = run(new HttpErrorResponse({ status: 500 }));
		await expect(firstValueFrom(stream)).rejects.toMatchObject({ status: 500 });
		expect(notifier.showError).toHaveBeenCalledWith('Readable');
		expect(logger.logError).toHaveBeenCalledWith('Readable');
		vi.restoreAllMocks();
	});
});

describe('LoaderInterceptor', () => {
	const run = async (method: 'GET' | 'POST') => {
		const store = {
			showLoader: vi.fn(),
			showButtonSpinner: vi.fn(),
			hideLoader: vi.fn(),
			hideButtonSpinner: vi.fn(),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [LoaderInterceptor, { provide: LoaderStore, useValue: store }] });
		await firstValueFrom(
			TestBed.inject(LoaderInterceptor).intercept(
				new HttpRequest(method as 'GET', '/x'),
				handler(of({ type: 0 })),
			),
		);
		await Promise.resolve();
		return store;
	};

	it('shows the page loader for a read, and the spinner for a write', async () => {
		const read = await run('GET');
		expect(read.showLoader).toHaveBeenCalledWith(true);
		expect(read.showButtonSpinner).toHaveBeenCalledWith(false);
		expect(read.hideLoader).toHaveBeenCalledOnce();
		expect(read.hideButtonSpinner).toHaveBeenCalledOnce();
		const write = await run('POST');
		expect(write.showLoader).toHaveBeenCalledWith(false);
		expect(write.showButtonSpinner).toHaveBeenCalledWith(true);
	});
});

describe('ServerInterceptor', () => {
	const run = (platform: string) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [ServerInterceptor, { provide: PLATFORM_ID, useValue: platform }],
		});
		return TestBed.inject(ServerInterceptor);
	};

	it('answers empty on the server and passes through in the browser', async () => {
		const answer = await firstValueFrom(run('server').intercept(request, handler(of('real'))));
		expect((answer as HttpResponse<unknown>).status).toBe(200);
		await expect(firstValueFrom(run('browser').intercept(request, handler(of('real'))))).resolves.toBe('real');
	});
});

describe('GlobalErrorHandler', () => {
	const run = () => {
		const notifier = { showError: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				GlobalErrorHandler,
				{ provide: ErrorService, useValue: { getServerErrorMessage: () => 'Readable' } },
				{ provide: NotificationService, useValue: notifier },
			],
		});
		return { errors: TestBed.inject(GlobalErrorHandler), notifier };
	};

	it('shows an HTTP failure and nothing else', () => {
		const { errors, notifier } = run();
		errors.handleError(new Error('bug'));
		expect(notifier.showError).not.toHaveBeenCalled();
		errors.handleError(new HttpErrorResponse({ status: 500 }));
		expect(notifier.showError).toHaveBeenCalledWith('Readable');
	});
});
