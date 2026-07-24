import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';

import { ILanguage } from '@data-access/interfaces/setting.interface';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';
import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-language',
	templateUrl: './language.html',
	styleUrls: ['./language.scss'],
	imports: [ClickOutsideDirective, Button],
})
export class Language {
	private transloco = inject(TranslocoService);
	private platformId = inject<Object>(PLATFORM_ID);

	readonly style = input<string>('basic');

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

	ngOnInit() {
		if (isPlatformBrowser(this.platformId)) {
			let language = localStorage.getItem('language');

			if (language == null) {
				localStorage.setItem('language', JSON.stringify(this.selectedLanguage));
				this.transloco.setActiveLang(this.selectedLanguage.code);
			} else {
				this.selectedLanguage = JSON.parse(language);
				this.transloco.setActiveLang(this.selectedLanguage.code);
			}
		}
	}

	selectLanguage(language: ILanguage) {
		this.active = false;
		this.transloco.setActiveLang(language.code);
		this.selectedLanguage = language;
		localStorage.setItem('language', JSON.stringify(this.selectedLanguage));
	}

	openDropDown() {
		this.active = !this.active;
	}

	hideDropdown() {
		this.active = false;
	}
}
