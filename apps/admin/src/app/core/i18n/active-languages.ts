import { DOCUMENT, inject, Injectable, provideAppInitializer, signal } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { isLocaleCode, orderLocales, parseLanguageList, PRIMARY_LOCALE } from '@saha-textile/core-domain/languages';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

/** This browser's last copy of the lists, so the admin still opens when the API is slow to answer. */
const STORAGE_KEY = 'st_admin_languages';

/** Where the shop stands with a language (contracts' `LanguageShopState`). */
export type ShopState = 'draft' | 'on' | 'off';

/** The lists the admin keeps, and this browser's copy of them. */
export interface LanguageLists {
	/** Every added language: forms show each one, drafts included (Option 1, 2026-11-15). */
	content: readonly string[];
	/** The languages staff may turn the admin into: the header's language menu. */
	admin: readonly string[];
	/** The languages the shop shows. */
	shop: readonly string[];
	/** Each added language's shop state; a language missing here is on. */
	states: Readonly<Record<string, ShopState>>;
}

const ENGLISH_ONLY: LanguageLists = {
	content: [PRIMARY_LOCALE],
	admin: [PRIMARY_LOCALE],
	shop: [PRIMARY_LOCALE],
	states: {},
};

const codes = (value: unknown): string[] | null =>
	Array.isArray(value) && value.every(isLocaleCode) ? orderLocales(value) : null;

/** The stored copy; an older copy held one list, which stands for all three. */
function parseLists(value: unknown): LanguageLists | null {
	const legacy = parseLanguageList(value);
	if (Array.isArray(value)) return legacy ? { content: legacy, admin: legacy, shop: legacy, states: {} } : null;
	const stored = value as Partial<Record<keyof LanguageLists, unknown>> | null;
	const content = codes(stored?.content);
	if (!content) return null;
	const states =
		stored?.states && typeof stored.states === 'object' ? (stored.states as Record<string, ShopState>) : {};
	return {
		content,
		admin: codes(stored?.admin) ?? [PRIMARY_LOCALE],
		shop: codes(stored?.shop) ?? [PRIMARY_LOCALE],
		states,
	};
}

/** The lists this browser saw last, or English alone. Read before the app starts (Transloco). */
export function savedLanguageLists(page: Document | undefined = globalThis.document): LanguageLists {
	try {
		return parseLists(JSON.parse(page?.defaultView?.localStorage.getItem(STORAGE_KEY) ?? 'null')) ?? ENGLISH_ONLY;
	} catch {
		return ENGLISH_ONLY;
	}
}

/** The admin's own languages this browser saw last: what Transloco may load before the API answers. */
export function savedLanguages(page: Document | undefined = globalThis.document): readonly string[] {
	return savedLanguageLists(page).admin;
}

interface PublicAnswer {
	active?: unknown;
	admin?: unknown;
}

interface WorkingAnswer {
	languages?: { code?: unknown; admin?: unknown; shop?: unknown }[];
}

/**
 * The languages, from the API (Settings › Languages, step 0d). Forms build one field per language
 * from `list()`: every added language, drafts included, because writing a language's text for the
 * shop never waits on a switch (Option 1). The header's language menu reads `adminList()`: only the
 * languages the Admin switch lets staff use. Loaded before the app starts, and again when the
 * signed-in admin opens, so a form can read the list the moment it opens.
 */
@Injectable({ providedIn: 'root' })
export class ActiveLanguages {
	private readonly page = inject(DOCUMENT);
	private readonly saved = savedLanguageLists(this.page);

	readonly locales = signal<readonly string[]>(this.saved.content);
	readonly adminLocales = signal<readonly string[]>(this.saved.admin);
	readonly shopLocales = signal<readonly string[]>(this.saved.shop);
	readonly states = signal<Readonly<Record<string, ShopState>>>(this.saved.states);

	/** Every added language, English first: what forms show. */
	list(): readonly string[] {
		return this.locales();
	}

	/** The languages staff may turn the admin into. */
	adminList(): readonly string[] {
		return this.adminLocales();
	}

	/** True for a language the shop does not show yet (or any more): its form button says Draft. */
	isDraft(code: string): boolean {
		const state = this.states()[code];
		return state !== undefined && state !== 'on';
	}

	/** Reads the public list, then the signed-in one; whatever does not answer keeps this browser's copy. */
	async load(): Promise<void> {
		await runtimeConfigReady;
		const lists: LanguageLists = {
			content: this.locales(),
			admin: this.adminLocales(),
			shop: this.shopLocales(),
			states: this.states(),
		};
		try {
			const answer = await fetch(`${runtimeConfig.apiUrl}/storefront/languages`, { credentials: 'omit' });
			const body = (answer.ok ? await answer.json() : null) as PublicAnswer | null;
			const shop = parseLanguageList(body);
			if (shop) {
				lists.shop = shop;
				lists.admin = codes(body?.admin) ?? shop;
				// Drafts come only with the signed-in list; until it answers, the last copy keeps them.
				lists.content = orderLocales([...lists.content, ...shop]);
			}
		} catch {
			// The API did not answer: keep this browser's last lists.
		}
		try {
			// Signed in, the working list adds the drafts; signed out it answers 401 and changes nothing.
			const answer = await fetch(`${runtimeConfig.apiUrl}/admin/languages`, { credentials: 'include' });
			const body = (answer.ok ? await answer.json() : null) as WorkingAnswer | null;
			const rows = (body?.languages ?? []).filter((row) => isLocaleCode(row.code));
			if (rows.length) {
				lists.content = orderLocales(rows.map((row) => row.code as string));
				lists.states = Object.fromEntries(rows.map((row) => [row.code as string, row.shop as ShopState]));
				lists.admin = orderLocales(rows.filter((row) => row.admin === true).map((row) => row.code as string));
			}
		} catch {
			// Not signed in, or the API is away: the public list stands.
		}
		this.apply(lists);
	}

	private apply(lists: LanguageLists): void {
		this.locales.set(lists.content);
		this.adminLocales.set(lists.admin);
		this.shopLocales.set(lists.shop);
		this.states.set(lists.states);
		try {
			this.page.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
		} catch {
			// Private windows may refuse storage; the lists still apply for this visit.
		}
	}
}

/** Loads the lists before the first screen is drawn, and lets Transloco load the admin's own languages. */
export function provideActiveLanguages() {
	return provideAppInitializer(async () => {
		const languages = inject(ActiveLanguages);
		const transloco = inject(TranslocoService);
		await languages.load();
		transloco.setAvailableLangs([...languages.adminList()]);
	});
}
