import { HttpRequest, type HttpHandler } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_BUILD_HEADER, ClientBuildInterceptor, clientBuild } from './client-build.interceptor';
import { environment } from '../../../../public/environments/environment';

interface Stamped {
	__CLIENT_BUILD__?: string;
}

const make = (platform = 'browser') => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [ClientBuildInterceptor, { provide: PLATFORM_ID, useValue: platform }],
	});
	return TestBed.inject(ClientBuildInterceptor);
};
const send = (interceptor: ClientBuildInterceptor, method: string, url = `${environment.apiUrl}/cart/current`) => {
	const handle = vi.fn((request: HttpRequest<unknown>) => of(request as never));
	const request = new HttpRequest(method as 'POST', url, null);
	interceptor.intercept(request, { handle } as unknown as HttpHandler);
	return (handle.mock.calls[0]?.[0] as HttpRequest<unknown>).headers.get(CLIENT_BUILD_HEADER);
};

afterEach(() => {
	delete (globalThis as Stamped).__CLIENT_BUILD__;
	vi.unstubAllGlobals();
});

describe('ClientBuildInterceptor', () => {
	it('reads the build stamped into the bundle', () => {
		(globalThis as Stamped).__CLIENT_BUILD__ = 'ea27a021';
		expect(clientBuild()).toBe('ea27a021');
	});

	it('sends nothing from a bundle without a build', () => {
		expect(send(make(), 'POST')).toBeNull();
	});

	it('stamps changes to the shop’s API with the build, -app from the installed app', () => {
		(globalThis as Stamped).__CLIENT_BUILD__ = 'ea27a021';
		const interceptor = make();
		expect(send(interceptor, 'POST')).toBe('ea27a021');
		vi.stubGlobal('matchMedia', () => ({ matches: true }));
		expect(send(interceptor, 'PATCH')).toBe('ea27a021-app');
	});

	it('leaves reads, other hosts and the server alone', () => {
		(globalThis as Stamped).__CLIENT_BUILD__ = 'ea27a021';
		const interceptor = make();
		expect(send(interceptor, 'GET')).toBeNull();
		expect(send(interceptor, 'POST', 'https://elsewhere.test/x')).toBeNull();
		expect(send(make('server'), 'POST')).toBeNull();
	});
});
