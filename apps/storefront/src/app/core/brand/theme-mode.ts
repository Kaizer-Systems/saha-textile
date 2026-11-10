import { computed, DOCUMENT, effect, inject, Injectable, signal } from '@angular/core';

import { REQUEST } from '@analogjs/router/tokens';

import { ConsentStore } from '@core/consent/consent.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { injectBrandQuery } from '@data-access/queries/brand.queries';

export type ThemeMode = 'light' | 'dark';

/** The dark theme, built from `src/scss/dark.scss` by the `styles` script. */
export const DARK_THEME_HREF = '/assets/css/theme-dark.gen.css';
const DARK_THEME_LINK_ID = 'theme-dark';

/** The shopper's own light/dark choice. Functional; a visit-only cookie when Functional is refused. */
export const THEME_COOKIE = 'st_theme';
const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** The mode stored in a `Cookie` header or `document.cookie`, or null when there is none. */
export function themeOfCookies(cookies: string | undefined | null): ThemeMode | null {
	const value = (cookies ?? '')
		.split(/;\s*/)
		.find((row) => row.startsWith(`${THEME_COOKIE}=`))
		?.slice(THEME_COOKIE.length + 1);
	return value === 'dark' || value === 'light' ? value : null;
}

/**
 * Applies the shop's colour mode to the page. Dark mode adds the theme's `dark` class to `<html>`
 * and links the dark stylesheet; light mode removes both. The stylesheet is a file of its own so
 * light pages never download it. It runs on the server too, so a dark page arrives with its
 * stylesheet already linked and never flashes light.
 */
export function applyThemeMode(document: Document, mode: string | undefined): void {
	const html = document.documentElement;
	const link = document.getElementById(DARK_THEME_LINK_ID);
	if (mode !== 'dark') {
		html.classList.remove('dark');
		link?.remove();
		return;
	}
	html.classList.add('dark');
	if (link) return;
	const stylesheet = document.createElement('link');
	stylesheet.id = DARK_THEME_LINK_ID;
	stylesheet.rel = 'stylesheet';
	stylesheet.href = DARK_THEME_HREF;
	document.head.appendChild(stylesheet);
}

/**
 * The mode the shop shows. The shopper's switch wins (`st_theme`); without a choice, or when the
 * Brand Kit hides the switch, the site mode from `site-config` applies. The server reads the
 * cookie from the request, so the first HTML already has the right mode.
 */
@Injectable({ providedIn: 'root' })
export class ThemeModeStore {
	private readonly page = inject(DOCUMENT);
	private readonly request = inject(REQUEST, { optional: true });
	private readonly siteConfig = inject(SiteConfigStore);
	private readonly consent = inject(ConsentStore);
	private readonly brandQuery = injectBrandQuery();

	/** The shopper's choice, if they have pressed the switch. */
	readonly choice = signal<ThemeMode | null>(this.readChoice());
	/** False when the Brand Kit hides the switch. */
	readonly switchShown = computed(() => this.brandQuery.data()?.modeSwitch ?? true);
	readonly siteMode = computed<ThemeMode>(() =>
		this.siteConfig.siteConfig()?.general?.mode === 'dark' ? 'dark' : 'light',
	);
	readonly mode = computed<ThemeMode>(() => (this.switchShown() ? this.choice() : null) ?? this.siteMode());
	readonly dark = computed(() => this.mode() === 'dark');
	/**
	 * The mode the tab icon follows: the shopper's choice, or a dark site mode. Null leaves the
	 * browser to pick the light or dark icon from its own setting.
	 */
	readonly fixedMode = computed<ThemeMode | null>(
		() => (this.switchShown() ? this.choice() : null) ?? (this.siteMode() === 'dark' ? 'dark' : null),
	);

	constructor() {
		effect(() => applyThemeMode(this.page, this.mode()));
	}

	toggle(): void {
		const next: ThemeMode = this.dark() ? 'light' : 'dark';
		this.choice.set(next);
		const secure = this.page.location?.protocol === 'https:' ? '; Secure' : '';
		const keep = this.consent.allows('functional') ? `; Max-Age=${YEAR_SECONDS}` : '';
		this.page.cookie = `${THEME_COOKIE}=${next}; Path=/${keep}; SameSite=Lax${secure}`;
	}

	/** The dark version of a Brand Kit picture in dark mode, when one is set; otherwise the light one. */
	pick<T>(light: T | null | undefined, dark: T | null | undefined): T | null {
		return (this.dark() && dark) || light || null;
	}

	private readChoice(): ThemeMode | null {
		const header = this.request?.headers?.cookie;
		return themeOfCookies(typeof header === 'string' ? header : this.request ? null : this.page.cookie);
	}
}
