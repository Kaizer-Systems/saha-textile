import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';

import { TranslateService } from '@ngx-translate/core';

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
  private translate = inject(TranslateService);
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
        this.translate.use(this.selectedLanguage.code);
      } else {
        this.selectedLanguage = JSON.parse(language);
        this.translate.use(this.selectedLanguage.code);
      }
    }
  }

  selectLanguage(language: ILanguage) {
    this.active = false;
    this.translate.use(language.code);
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
