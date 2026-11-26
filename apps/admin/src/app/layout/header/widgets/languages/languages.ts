import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';

import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { languageFlag, languageName } from '@saha-textile/core-domain/languages';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';
import { Button } from '@shared/ui/button/button';

export interface ILanguage {
	language: string;
	code: string;
	icon: string;
}

@Component({
	selector: 'app-languages',
	templateUrl: './languages.html',
	styleUrls: ['./languages.scss'],
	imports: [ClickOutsideDirective, Button, TranslocoPipe],
})
export class Languages {
	private translate = inject(TranslocoService);
	private platformId = inject<Object>(PLATFORM_ID);

	private readonly activeLanguages = inject(ActiveLanguages);

	public active: boolean = false;
	/**
	 * The page-language menu: the languages the Admin switch lets staff use (Settings › Languages),
	 * each in its own name, with the theme's flag. Languages only being written for the shop are not
	 * offered here (Option 1, 2026-11-15).
	 */
	public languages: ILanguage[] = this.activeLanguages.adminList().map((code) => ({
		language: languageName(code),
		code,
		icon: languageFlag(code),
	}));

	public selectedLanguage: ILanguage = this.languages[0]!;

	constructor() {
		if (isPlatformBrowser(this.platformId)) {
			let saved: unknown = null;
			try {
				saved = JSON.parse(localStorage.getItem('language') ?? 'null');
			} catch {
				saved = null;
			}
			const code = (saved as Partial<ILanguage> | null)?.code;
			// A saved language that is no longer active falls back to English.
			this.selectedLanguage = this.languages.find((language) => language.code === code) ?? this.languages[0]!;
			this.translate.setActiveLang(this.selectedLanguage.code);
		}
	}

	selectLanguage(language: ILanguage) {
		this.active = false;
		this.translate.setActiveLang(language.code);
		this.selectedLanguage = language;
		localStorage.setItem('language', JSON.stringify(this.selectedLanguage));
	}

	clickHeaderOnMobile() {
		this.active = !this.active;
	}

	hideDropdown() {
		this.active = false;
	}
}
