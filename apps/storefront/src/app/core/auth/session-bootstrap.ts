import { PLATFORM_ID, inject, provideAppInitializer } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { runtimeConfigReady } from '@core/config/runtime-config';
import { AuthStore } from '@core/state/auth.store';

/**
 * Resolves the cookie session before the router runs.
 *
 * Ordering matters twice over. It awaits {@link runtimeConfigReady} because Angular starts
 * initializers concurrently and the gateway needs the real `apiUrl`. And it must finish
 * before routing, because a guard that runs against an unresolved session would bounce a
 * signed-in customer to the login page during hydration.
 *
 * Browser only. Server-side rendering has no cookie jar of its own, so calling `/me` there
 * would return anonymous regardless — and rendering someone's account shell on the server
 * is exactly what the "no per-user SSR caching" rule forbids. The server therefore renders
 * the anonymous view and the browser resolves the real session on hydration.
 */
export function provideSessionBootstrap() {
	return provideAppInitializer(async () => {
		if (!isPlatformBrowser(inject(PLATFORM_ID))) return;

		const authStore = inject(AuthStore);
		await runtimeConfigReady;
		await authStore.bootstrap();
	});
}
