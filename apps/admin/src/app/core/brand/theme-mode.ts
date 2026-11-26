import { computed, DestroyRef, DOCUMENT, effect, inject, Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

/**
 * The admin's dark stylesheet: the theme's `body.dark-only` rules, colour changes only, built by
 * `scripts/build-dark-theme.mjs` (the `styles` script). A file of its own, so light pages never
 * download it. `public/assets/js/theme-mode.js` links the same file before the app starts.
 */
export const DARK_THEME_HREF = '/assets/css/theme-dark.gen.css';
export const DARK_THEME_LINK_ID = 'theme-dark';
/** The class the theme's dark rules hang on. */
export const DARK_CLASS = 'dark-only';
/** This browser's choice. Per device, like the theme colour (`st_admin_theme_color`). */
export const THEME_STORAGE_KEY = 'st_admin_theme';

/** The saved mode, or light when there is none or storage is refused (private windows). */
export function savedThemeMode(page: Document): ThemeMode {
	try {
		return page.defaultView?.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
	} catch {
		return 'light';
	}
}

/**
 * Applies a mode to the page. Dark links the stylesheet and, once it has arrived, marks `<body>`, so
 * the page never shows dark text on the light theme in between. Light removes both. Idempotent: the
 * boot script may already have done the dark half.
 */
export function applyThemeMode(page: Document, mode: ThemeMode): void {
	const body = page.body;
	let link = page.getElementById(DARK_THEME_LINK_ID) as HTMLLinkElement | null;
	if (mode !== 'dark') {
		body?.classList.remove(DARK_CLASS);
		link?.remove();
		return;
	}
	if (link?.sheet || (link && body?.classList.contains(DARK_CLASS))) {
		body?.classList.add(DARK_CLASS);
		return;
	}
	if (!link) {
		link = page.createElement('link');
		link.id = DARK_THEME_LINK_ID;
		link.rel = 'stylesheet';
		link.href = DARK_THEME_HREF;
		page.head.appendChild(link);
	}
	const mark = (): void => {
		// The person may have switched back while the file loaded.
		if (page.getElementById(DARK_THEME_LINK_ID)) body?.classList.add(DARK_CLASS);
	};
	link.addEventListener('load', mark, { once: true });
	// A failed download still switches: the theme then looks as it did before this file existed.
	link.addEventListener('error', mark, { once: true });
}

/**
 * The admin's light/dark mode: each person's own choice on this device, applied before the app
 * starts by `public/assets/js/theme-mode.js` and kept in step here. Other open admin tabs follow a
 * change at once.
 */
@Injectable({ providedIn: 'root' })
export class ThemeModeStore {
	private readonly page = inject(DOCUMENT);

	readonly mode = signal<ThemeMode>(savedThemeMode(this.page));
	readonly dark = computed(() => this.mode() === 'dark');

	constructor() {
		effect(() => applyThemeMode(this.page, this.mode()));
		const view = this.page.defaultView;
		const follow = (event: StorageEvent): void => {
			if (event.key === THEME_STORAGE_KEY) this.mode.set(event.newValue === 'dark' ? 'dark' : 'light');
		};
		view?.addEventListener('storage', follow);
		inject(DestroyRef).onDestroy(() => view?.removeEventListener('storage', follow));
	}

	/** The dark version of a Brand Kit picture in dark mode, when one is set; otherwise the light one. */
	pick<T>(light: T | null | undefined, dark: T | null | undefined): T | null {
		return (this.dark() && dark) || light || null;
	}

	toggle(): void {
		const next: ThemeMode = this.dark() ? 'light' : 'dark';
		this.mode.set(next);
		try {
			this.page.defaultView?.localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch {
			// Private windows may refuse storage; the mode still applies for this visit.
		}
	}
}
