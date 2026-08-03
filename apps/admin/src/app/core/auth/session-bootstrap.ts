import { inject, provideAppInitializer } from '@angular/core';

import { runtimeConfigReady } from '@core/config/runtime-config';
import { AuthStore } from '@core/state/auth.store';

/**
 * Resolves the admin cookie session before the router runs.
 *
 * It awaits {@link runtimeConfigReady} because Angular starts initializers concurrently and
 * the gateway needs the real `apiUrl`. Finishing before routing is what keeps a guard from
 * bouncing a signed-in operator to the login screen on a page refresh — the whole back
 * office is behind that guard, so an unresolved session would look like a logout.
 */
export function provideAdminSessionBootstrap() {
	return provideAppInitializer(async () => {
		const authStore = inject(AuthStore);
		await runtimeConfigReady;
		await authStore.bootstrap();
	});
}
