import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';

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
	imports: [ClickOutsideDirective, Button],
})
export class Languages {
	private translate = inject(TranslocoService);
	private platformId = inject<Object>(PLATFORM_ID);

	public active: boolean = false;
	public languages: ILanguage[] = [
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

	public selectedLanguage: ILanguage = {
		language: 'English',
		code: 'en',
		icon: 'us',
	};

	constructor() {
		if (isPlatformBrowser(this.platformId)) {
			let language = localStorage.getItem('language');

			if (language == null) {
				this.translate.setActiveLang(this.selectedLanguage.code);
			} else {
				this.selectedLanguage = JSON.parse(language);
				this.translate.setActiveLang(this.selectedLanguage.code);
			}
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
