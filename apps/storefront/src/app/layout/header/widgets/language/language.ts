import { DOCUMENT } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';

import { filter, map } from 'rxjs';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { LOCALE_COOKIE, Locale, withLocale } from '@core/i18n/locale';
import { ILanguage } from '@data-access/interfaces/setting.interface';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';
import { Button } from '@shared/ui/button/button';

/** One year: the choice should outlast a session, not a device. */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The header language switcher (`DEC-I18N-ROUTES`).
 *
 * Each option is a real link to the SAME page under the other prefix, so a click is a full
 * navigation the server renders in that language — and a crawler, or a middle-click, follows it
 * like any link. The click also records the choice in the `st_locale` cookie, which is all `/`
 * consults. The language shown as selected is the one in the URL; nothing is kept in storage.
 */
@Component({
	selector: 'app-language',
	templateUrl: './language.html',
	styleUrls: ['./language.scss'],
	imports: [ClickOutsideDirective, Button],
})
export class Language {
	private router = inject(Router);
	private doc = inject(DOCUMENT);
	/**
	 * The current app URL as a signal, so the option links are re-rendered by navigation itself.
	 * A plain `router.url` read in the template relied on some later change-detection pass, and
	 * after hydration the links stayed on the URL they were first rendered for (`/en/`, `/fr/`).
	 */
	private url = toSignal(
		this.router.events.pipe(
			filter((event): event is NavigationEnd => event instanceof NavigationEnd),
			map((event) => event.urlAfterRedirects),
		),
		{ initialValue: this.router.url },
	);
	private locale = inject(ACTIVE_LOCALE);

	readonly style = input<string>('basic');

	public active: boolean = false;
	public languages: (ILanguage & { code: Locale })[] = [
		{
			language: 'English',
			code: 'en',
			icon: 'us',
		},
		{
			language: 'Français',
			code: 'fr',
			icon: 'fr',
		},
	];

	public selectedLanguage: ILanguage =
		this.languages.find((language) => language.code === this.locale) ?? this.languages[0];

	/** This page in `language`, query and fragment kept. */
	hrefFor(language: ILanguage & { code: Locale }): string {
		return withLocale(language.code, this.url());
	}

	/** Runs before the link's own navigation; it only has to leave the cookie behind. */
	selectLanguage(language: ILanguage) {
		this.active = false;
		const secure = this.doc.location?.protocol === 'https:' ? '; Secure' : '';
		this.doc.cookie = `${LOCALE_COOKIE}=${language.code}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
	}

	openDropDown() {
		this.active = !this.active;
	}

	hideDropdown() {
		this.active = false;
	}
}
