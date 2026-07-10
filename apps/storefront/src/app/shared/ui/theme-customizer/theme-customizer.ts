import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { ThemeOptionStore } from '@core/state/theme-option.store';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { Button } from '../button/button';

@Component({
  selector: 'app-theme-customizer',
  templateUrl: './theme-customizer.html',
  styleUrls: ['./theme-customizer.scss'],
  standalone: true,
  imports: [
    ClickOutsideDirective,
    Button,
    NgClass,
    ReactiveFormsModule,
    FormsModule,
    TranslateModule,
  ],
})
export class ThemeCustomizer {
  themeOptionService = inject(ThemeOptionService);
  private platformId = inject<Object>(PLATFORM_ID);

  themeOption$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;

  public open: boolean = false;
  public show: boolean = false;
  public mode: string;
  public value: string;
  public primary_color: string;

  ngOnInit() {
    this.themeOption$.subscribe(option => {
      this.mode = option?.general ? option?.general?.mode : 'light';
      this.value = option?.general ? option?.general?.language_direction : 'ltr';
    });
  }

  toggle() {
    this.open = !this.open;
  }

  layout(value: string) {
    if (isPlatformBrowser(this.platformId)) {
      this.value = value;
      if (value === 'rtl') {
        document.body.classList.add('rtl');
      } else {
        document.body.classList.remove('rtl');
      }
    }
  }

  layoutMode(value: string) {
    if (isPlatformBrowser(this.platformId)) {
      this.mode = value;
      if (this.mode === 'dark') {
        document.getElementsByTagName('html')[0].classList.add('dark');
      } else {
        document.getElementsByTagName('html')[0].classList.remove('dark');
      }
    }
  }

  customizeThemeColor(event: Event) {
    if (isPlatformBrowser(this.platformId)) {
      const input = event.target as HTMLInputElement;
      document.documentElement.style.setProperty('--theme-color', input.value);
    }
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      // Remove Color
      document.documentElement.style.removeProperty('--theme-color');
    }
  }

  closeDropdown() {
    this.open = false;
  }
}
