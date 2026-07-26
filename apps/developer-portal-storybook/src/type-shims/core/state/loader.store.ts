import { Injectable, signal } from '@angular/core';

/**
 * Compiler-only compatibility surface for the two application-local
 * `@core/state/loader.store` aliases. Webpack resolves the runtime import to the
 * correct Storefront or Admin class from the importing component's issuer.
 */
@Injectable({ providedIn: 'root' })
export class LoaderStore {
	readonly status = signal(false);
	readonly button_spinner = signal(false);
	readonly buttonSpinner = signal(false);
}
