import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, DOCUMENT, inject, Injectable, Injector, PLATFORM_ID, signal } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

import { COOKIE_POLICY_VERSION, OPTIONAL_COOKIES, OPTIONAL_STORAGE, type OptionalCategory } from './cookie-catalogue';

const COOKIE = 'st_consent';
const YEAR_SECONDS = 365 * 24 * 60 * 60;

type Categories = Record<OptionalCategory, boolean>;

/** The decision as `st_consent` holds it. */
export interface ConsentChoice {
	/** Random, so a guest's history can be kept without knowing who they are. */
	id: string;
	version: string;
	savedAt: string;
	categories: Categories;
}

const NOTHING_OPTIONAL: Categories = {
	functional: false,
	analytics: false,
	targeting: false,
	marketing: false,
	promotional: false,
};

function parseChoice(value: string | undefined): ConsentChoice | null {
	if (!value) return null;
	try {
		const choice = JSON.parse(decodeURIComponent(value)) as Partial<ConsentChoice>;
		return choice.version === COOKIE_POLICY_VERSION && choice.id && choice.categories
			? (choice as ConsentChoice)
			: null;
	} catch {
		return null;
	}
}

/**
 * The shopper's cookie decision. The browser's `st_consent` cookie is the live answer, because the
 * shop must know before any request returns; the API keeps the add-only history. Nothing optional
 * runs until `allows` says so. The server never shows the box, so returning visitors see no flash.
 */
@Injectable({ providedIn: 'root' })
export class ConsentStore {
	/** Reached only when a decision is sent, so the many readers of `allows` carry no HTTP weight. */
	private readonly injector = inject(Injector);
	private readonly page = inject<Document>(DOCUMENT);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	readonly choice = signal<ConsentChoice | null>(this.isBrowser ? this.readCookie() : null);
	readonly decided = computed(() => this.choice() !== null);
	/** Browser only: the first HTML never carries the box. */
	readonly boxOpen = computed(() => this.isBrowser && !this.decided());
	/** Goes up each time something asks for Cookie settings. */
	readonly settingsRequests = signal(0);

	allows(category: OptionalCategory): boolean {
		return this.choice()?.categories[category] ?? false;
	}

	openSettings(): void {
		this.settingsRequests.update((count) => count + 1);
	}

	/** Takes effect at once: anything refused is removed before this returns. */
	save(categories: Partial<Categories>): void {
		const choice: ConsentChoice = {
			id: this.choice()?.id ?? crypto.randomUUID(),
			version: COOKIE_POLICY_VERSION,
			savedAt: new Date().toISOString(),
			categories: { ...NOTHING_OPTIONAL, ...categories },
		};
		this.writeCookie(choice);
		this.choice.set(choice);
		if (!choice.categories.functional) this.clearOptional();
		void this.record(choice);
	}

	private readCookie(): ConsentChoice | null {
		const entry = this.page.cookie.split('; ').find((row) => row.startsWith(`${COOKIE}=`));
		return parseChoice(entry?.slice(COOKIE.length + 1));
	}

	private writeCookie(choice: ConsentChoice): void {
		const secure = this.page.location.protocol === 'https:' ? '; Secure' : '';
		const value = encodeURIComponent(JSON.stringify(choice));
		this.page.cookie = `${COOKIE}=${value}; Max-Age=${YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
	}

	private clearOptional(): void {
		for (const name of OPTIONAL_COOKIES) this.page.cookie = `${name}=; Max-Age=0; Path=/`;
		for (const key of OPTIONAL_STORAGE) this.page.defaultView?.localStorage.removeItem(key);
	}

	/** The history is evidence, not the live answer, so a failed write never blocks the shopper. */
	private async record(choice: ConsentChoice): Promise<void> {
		try {
			await runtimeConfigReady;
			await firstValueFrom(
				this.injector.get(HttpClient).post(`${runtimeConfig.apiUrl}/privacy/consent`, {
					categories: { necessary: true, ...choice.categories },
					policyVersion: choice.version,
					consentId: choice.id,
				}),
			);
		} catch {
			// The browser still holds the decision.
		}
	}

	/** On sign-in this device's choice joins the account; a new device picks up the account's. */
	async syncAccount(): Promise<void> {
		const local = this.choice();
		if (local) return this.record(local);
		try {
			await runtimeConfigReady;
			const saved = await firstValueFrom(
				this.injector
					.get(HttpClient)
					.get<{ categories: Categories; policyVersion: string | null }>(`${runtimeConfig.apiUrl}/privacy/consent`),
			);
			if (saved.policyVersion !== COOKIE_POLICY_VERSION) return;
			const { functional, analytics, targeting, marketing, promotional } = saved.categories;
			const categories = { functional, analytics, targeting, marketing, promotional };
			const choice: ConsentChoice = {
				id: crypto.randomUUID(),
				version: COOKIE_POLICY_VERSION,
				savedAt: new Date().toISOString(),
				categories,
			};
			this.writeCookie(choice);
			this.choice.set(choice);
		} catch {
			// The box asks instead.
		}
	}
}
