import { Injectable, signal } from '@angular/core';

/**
 * Stories render without the API, so the admin's language list is the one the local API answers
 * (`GET /storefront/languages`): English and Bengali, both on in the admin and the shop, no
 * drafts. Same surface as the admin's ActiveLanguages.
 */
@Injectable({ providedIn: 'root' })
export class ActiveLanguages {
	readonly locales = signal<readonly string[]>(['en', 'bn']);
	readonly adminLocales = signal<readonly string[]>(['en', 'bn']);
	readonly shopLocales = signal<readonly string[]>(['en', 'bn']);

	list(): readonly string[] {
		return this.locales();
	}

	adminList(): readonly string[] {
		return this.adminLocales();
	}

	isDraft(_code: string): boolean {
		return false;
	}

	async load(): Promise<void> {}
}

export function savedLanguages(): readonly string[] {
	return ['en', 'bn'];
}
