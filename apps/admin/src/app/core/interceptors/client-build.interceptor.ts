import { isPlatformBrowser } from '@angular/common';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

/** Stamped at build time from `BUILD_ID` (vite.config.ts); absent in tests and plain `vite` runs. */
declare const __CLIENT_BUILD__: string | undefined;

export const CLIENT_BUILD_HEADER = 'x-client-build';

/** This bundle's build (a short commit), or null for a local build without one. */
export function clientBuild(
	stamped: unknown = typeof __CLIENT_BUILD__ === 'string' ? __CLIENT_BUILD__ : undefined,
): string | null {
	return typeof stamped === 'string' && /^[a-z0-9]{7,40}$/.test(stamped) ? stamped : null;
}

/** The header's value: the build, with `-app` when the admin runs as the installed app. */
export function clientBuildValue(build: string, installed: boolean): string {
	return installed ? `${build}-app` : build;
}

/**
 * Client versions (Release Console brief 26gq3NbcbBESea6abRtsa3, screen 4): which build of the
 * admin people are running. The build rides only on calls that change something (cart, sign-in,
 * orders), which the browser pre-checks anyway for their CSRF header, so no read ever gains a CORS
 * pre-check. Nothing personal: the build and whether it is the installed app.
 */
@Injectable()
export class ClientBuildInterceptor implements HttpInterceptor {
	private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly build = clientBuild();

	intercept<T>(request: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		if (!this.browser || !this.build || !request.url.startsWith(runtimeConfig.apiUrl)) return next.handle(request);
		if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next.handle(request);
		const installed = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
		return next.handle(
			request.clone({ setHeaders: { [CLIENT_BUILD_HEADER]: clientBuildValue(this.build, installed) } }),
		);
	}
}
