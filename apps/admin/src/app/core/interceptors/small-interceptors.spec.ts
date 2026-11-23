import { HttpContext, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, map, of, throwError, timer } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LoaderStore } from '@core/state/loader.store';
import { ErrorService } from '@data-access/services/error.service';
import { LoggingService } from '@data-access/services/logging.service';
import { NotificationService } from '@data-access/services/notification.service';

import { CSRF_REPLAY, GlobalErrorHandlerInterceptor, QUIET_ERRORS } from './global-error-handler.interceptor';
import { LoaderInterceptor } from './loader.interceptor';

const request = new HttpRequest('GET', '/x');
const handler = (result: unknown) => ({ handle: () => result }) as never;

describe('GlobalErrorHandlerInterceptor', () => {
	const run = (error: HttpErrorResponse, sent = request) => {
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
		const stream = TestBed.inject(GlobalErrorHandlerInterceptor).intercept(sent, handler(throwError(() => error)));
		return { stream, notifier, logger };
	};

	it('leaves a 401 to the auth interceptor', async () => {
		const { stream, notifier } = run(new HttpErrorResponse({ status: 401 }));
		await expect(firstValueFrom(stream)).rejects.toMatchObject({ status: 401 });
		expect(notifier.showError).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it('leaves a request that explains its own failure in the page alone (the Inbox reads)', async () => {
		const quiet = new HttpRequest('GET', '/x', { context: new HttpContext().set(QUIET_ERRORS, true) });
		const { stream, notifier } = run(new HttpErrorResponse({ status: 502 }), quiet);
		await expect(firstValueFrom(stream)).rejects.toMatchObject({ status: 502 });
		expect(notifier.showError).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it('leaves a refused CSRF token to the auth interceptor, and speaks for the replay', async () => {
		const refused = () =>
			new HttpErrorResponse({
				status: 403,
				error: { error: { code: 'forbidden', message: 'x', issues: [], reason: 'csrf_rejected' } },
			});
		const first = run(refused());
		await expect(firstValueFrom(first.stream)).rejects.toMatchObject({ status: 403 });
		expect(first.notifier.showError).not.toHaveBeenCalled();

		const replay = new HttpRequest('POST', '/x', null, { context: new HttpContext().set(CSRF_REPLAY, true) });
		const again = run(refused(), replay);
		await expect(firstValueFrom(again.stream)).rejects.toMatchObject({ status: 403 });
		expect(again.notifier.showError).toHaveBeenCalledWith('Readable');

		// A plain 403 (no access) is still shown.
		const plain = run(new HttpErrorResponse({ status: 403, error: { error: { code: 'forbidden', issues: [] } } }));
		await expect(firstValueFrom(plain.stream)).rejects.toMatchObject({ status: 403 });
		expect(plain.notifier.showError).toHaveBeenCalledWith('Readable');
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
	/** `slow` answers after the loader's tick, as a real request does; otherwise the answer comes at once. */
	const run = async (method: 'GET' | 'POST', slow = false) => {
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
				handler(slow ? timer(0).pipe(map(() => ({ type: 0 }))) : of({ type: 0 })),
			),
		);
		await Promise.resolve();
		return store;
	};

	it('shows the page loader for a read, and the spinner for a write, then hides them', async () => {
		const read = await run('GET', true);
		expect(read.showLoader).toHaveBeenCalledWith(true);
		expect(read.showButtonSpinner).toHaveBeenCalledWith(false);
		expect(read.hideLoader).toHaveBeenCalledOnce();
		expect(read.hideButtonSpinner).toHaveBeenCalledOnce();
		const write = await run('POST', true);
		expect(write.showLoader).toHaveBeenCalledWith(false);
		expect(write.showButtonSpinner).toHaveBeenCalledWith(true);
	});

	it('never shows the loader for a request that ended before it could appear (answered at once or cancelled)', async () => {
		const quick = await run('GET');
		expect(quick.showLoader).not.toHaveBeenCalled();
		expect(quick.hideLoader).not.toHaveBeenCalled();
	});
});
