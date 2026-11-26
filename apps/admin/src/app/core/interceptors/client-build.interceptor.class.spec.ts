import { HttpRequest } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { CLIENT_BUILD_HEADER, ClientBuildInterceptor, clientBuild } from './client-build.interceptor';

/** The interceptor on a page, with the build the bundle was stamped with (`__CLIENT_BUILD__`). */
function interceptor(stamped: string | undefined, platform = 'browser'): ClientBuildInterceptor {
	if (stamped === undefined) Reflect.deleteProperty(globalThis, '__CLIENT_BUILD__');
	else Reflect.set(globalThis, '__CLIENT_BUILD__', stamped);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [ClientBuildInterceptor, { provide: PLATFORM_ID, useValue: platform }],
	});
	return TestBed.inject(ClientBuildInterceptor);
}

/** The request the next handler received. */
function sent(subject: ClientBuildInterceptor, request: HttpRequest<unknown>): HttpRequest<unknown> {
	let passed: HttpRequest<unknown> | undefined;
	subject.intercept(request, {
		handle: (next) => {
			passed = next;
			return { subscribe: () => undefined } as never;
		},
	});
	if (!passed) throw new Error('The request never reached the next handler.');
	return passed;
}

const api = (path: string) => `${runtimeConfig.apiUrl}${path}`;

describe('ClientBuildInterceptor', () => {
	afterEach(() => {
		Reflect.deleteProperty(globalThis, '__CLIENT_BUILD__');
		vi.unstubAllGlobals();
	});

	it('reads the build the bundle was stamped with', () => {
		Reflect.set(globalThis, '__CLIENT_BUILD__', 'ea27a021');
		expect(clientBuild()).toBe('ea27a021');
	});

	it('names the build on a call that changes something, with -app in the installed app', () => {
		const subject = interceptor('ea27a021');
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		expect(sent(subject, new HttpRequest('POST', api('/orders'), {})).headers.get(CLIENT_BUILD_HEADER)).toBe(
			'ea27a021',
		);
		vi.stubGlobal('matchMedia', () => ({ matches: true }));
		expect(sent(subject, new HttpRequest('PUT', api('/orders/1'), {})).headers.get(CLIENT_BUILD_HEADER)).toBe(
			'ea27a021-app',
		);
	});

	it('names the plain build where the browser has no matchMedia', () => {
		const subject = interceptor('ea27a021');
		vi.stubGlobal('matchMedia', undefined);
		expect(sent(subject, new HttpRequest('DELETE', api('/orders/1'))).headers.get(CLIENT_BUILD_HEADER)).toBe(
			'ea27a021',
		);
	});

	it('leaves reads, other hosts, unstamped bundles and the server alone', () => {
		const stamped = interceptor('ea27a021');
		for (const read of [
			new HttpRequest('GET', api('/orders')),
			new HttpRequest('HEAD', api('/orders')),
			new HttpRequest('OPTIONS', api('/orders')),
		]) {
			expect(sent(stamped, read).headers.has(CLIENT_BUILD_HEADER)).toBe(false);
		}
		expect(
			sent(stamped, new HttpRequest('POST', 'https://elsewhere.test/x', {})).headers.has(CLIENT_BUILD_HEADER),
		).toBe(false);
		const unstamped = interceptor(undefined);
		expect(sent(unstamped, new HttpRequest('POST', api('/orders'), {})).headers.has(CLIENT_BUILD_HEADER)).toBe(
			false,
		);
		const server = interceptor('ea27a021', 'server');
		expect(sent(server, new HttpRequest('POST', api('/orders'), {})).headers.has(CLIENT_BUILD_HEADER)).toBe(false);
	});
});
