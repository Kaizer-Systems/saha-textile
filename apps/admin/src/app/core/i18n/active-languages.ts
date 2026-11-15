import { DOCUMENT, inject, Injectable, provideAppInitializer, signal } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { parseLanguageList, PRIMARY_LOCALE } from '@saha-textile/core-domain/languages';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

/** This browser's last copy of the list, so the admin still opens when the API is slow to answer. */
const STORAGE_KEY = 'st_admin_languages';

/** The list this browser saw last, or English alone. Read before the app starts (Transloco). */
export function savedLanguages(page: Document | undefined = globalThis.document): readonly string[] {
	try {
		const stored: unknown = JSON.parse(page?.defaultView?.localStorage.getItem(STORAGE_KEY) ?? 'null');
		return parseLanguageList(stored) ?? [PRIMARY_LOCALE];
	} catch {
		return [PRIMARY_LOCALE];
	}
}

/**
 * The shop's active languages, from the API (`GET /storefront/languages`): the one list every
 * Language switch, every per-language form and the header's page-language menu read. English is
 * always first. Loaded before the app starts, so forms that build one field per language can read
 * it when they open.
 */
@Injectable({ providedIn: 'root' })
export class ActiveLanguages {
	private readonly page = inject(DOCUMENT);

	readonly locales = signal<readonly string[]>(savedLanguages(this.page));

	/** The list now. */
	list(): readonly string[] {
		return this.locales();
	}

	async load(): Promise<void> {
		await runtimeConfigReady;
		try {
			const answer = await fetch(`${runtimeConfig.apiUrl}/storefront/languages`, { credentials: 'omit' });
			const locales = parseLanguageList(answer.ok ? await answer.json() : null);
			if (locales) this.apply(locales);
		} catch {
			// The API did not answer: keep this browser's last list.
		}
	}

	private apply(locales: readonly string[]): void {
		this.locales.set(locales);
		try {
			this.page.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify(locales));
		} catch {
			// Private windows may refuse storage; the list still applies for this visit.
		}
	}
}

/** Loads the list before the first screen is drawn, and lets Transloco load those languages. */
export function provideActiveLanguages() {
	return provideAppInitializer(async () => {
		const languages = inject(ActiveLanguages);
		const transloco = inject(TranslocoService);
		await languages.load();
		transloco.setAvailableLangs([...languages.list()]);
	});
}
