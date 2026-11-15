import { Injectable, signal } from '@angular/core';

/**
 * Stories render without the API, so the admin's language list is the one the local API answers
 * (`GET /storefront/languages`): English and Bengali. Same surface as the admin's ActiveLanguages.
 */
@Injectable({ providedIn: 'root' })
export class ActiveLanguages {
	readonly locales = signal<readonly string[]>(['en', 'bn']);

	list(): readonly string[] {
		return this.locales();
	}

	async load(): Promise<void> {}
}

export function savedLanguages(): readonly string[] {
	return ['en', 'bn'];
}
