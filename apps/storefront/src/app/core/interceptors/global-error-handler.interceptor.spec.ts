import { HttpErrorResponse, HttpEvent, HttpHandler, HttpRequest, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorService } from '@data-access/services/error.service';
import { LoggingService } from '@data-access/services/logging.service';
import { NotificationService } from '@data-access/services/notification.service';

import { backgroundRequest } from './background-request';
import { GlobalErrorHandlerInterceptor } from './global-error-handler.interceptor';
import { environment } from '../../../../public/environments/environment';

const api = `${environment.apiUrl}/catalog/home`;
const answering = (result: Observable<HttpEvent<unknown>>): HttpHandler => ({ handle: () => result });
const failing = (status: number) => answering(throwError(() => new HttpErrorResponse({ status })));
const succeeding = answering(of(new HttpResponse({ status: 200 })));

describe('the global error handler', () => {
	const showError = vi.fn();
	let interceptor: GlobalErrorHandlerInterceptor;

	const send = (request: HttpRequest<unknown>, handler: HttpHandler) =>
		interceptor.intercept(request, handler).subscribe({ error: () => undefined });

	beforeEach(() => {
		showError.mockClear();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				GlobalErrorHandlerInterceptor,
				{ provide: ErrorService, useValue: { getClientErrorMessage: () => 'Something went wrong.' } },
				{ provide: LoggingService, useValue: { logError: () => undefined } },
				{ provide: NotificationService, useValue: { showError } },
			],
		});
		interceptor = TestBed.inject(GlobalErrorHandlerInterceptor);
	});

	it('leaves a 401 and a domain refusal to the caller', () => {
		send(new HttpRequest('GET', api), failing(401));
		const refusal = {
			handle: () =>
				throwError(
					() =>
						new HttpErrorResponse({
							status: 400,
							error: { error: { code: 'bad_request', issues: [{ code: 'taken', path: ['request'] }] } },
						}),
				),
		} as unknown as HttpHandler;
		send(new HttpRequest('GET', api), refusal);
		expect(showError).not.toHaveBeenCalled();
	});

	it('says one thing per outage, however many reads fail', () => {
		send(new HttpRequest('GET', api), failing(0));
		send(new HttpRequest('GET', api), failing(503));
		send(new HttpRequest('GET', api), failing(0));

		expect(showError).toHaveBeenCalledOnce();
	});

	it('speaks again after the API has answered', () => {
		send(new HttpRequest('GET', api), failing(0));
		send(new HttpRequest('GET', api), succeeding);
		send(new HttpRequest('GET', api), failing(0));

		expect(showError).toHaveBeenCalledTimes(2);
	});

	it('does not treat a static file as the API coming back', () => {
		send(new HttpRequest('GET', api), failing(0));
		send(new HttpRequest('GET', '/assets/data/setting.json'), succeeding);
		send(new HttpRequest('GET', api), failing(0));

		expect(showError).toHaveBeenCalledOnce();
	});

	it("always answers a shopper's own action during an outage", () => {
		send(new HttpRequest('GET', api), failing(0));
		send(new HttpRequest('POST', `${environment.apiUrl}/cart`, {}), failing(503));

		expect(showError).toHaveBeenCalledTimes(2);
	});

	it('stays quiet about a marked background read', () => {
		send(new HttpRequest('GET', api, { context: backgroundRequest() }), failing(503));

		expect(showError).not.toHaveBeenCalled();
	});
});
