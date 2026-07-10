import { AsyncPipe, isPlatformBrowser, isPlatformServer, PlatformLocation } from '@angular/common';
import { Component, inject, input, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';

import { Observable } from 'rxjs';

import { BasicHeader } from './basic-header/basic-header';
import { ClassicHeader } from './classic-header/classic-header';
import { MinimalHeader } from './minimal-header/minimal-header';
import { StandardHeader } from './standard-header/standard-header';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionStore } from '@core/state/theme-option.store';
import { MobileMenu } from './widgets/mobile-menu/mobile-menu';

@Component({
  selector: 'app-header',
  templateUrl: './header.html',
  styleUrls: ['./header.scss'],
  imports: [BasicHeader, ClassicHeader, StandardHeader, MinimalHeader, MobileMenu, AsyncPipe],
})
export class Header {
  private platformId = inject<Object>(PLATFORM_ID);
  private platformLocation = inject(PlatformLocation);

  themeOption$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;

  readonly logo = input<string>();

  public style: string = 'basic_header';
  public sticky: boolean = true;

  constructor() {
    const router = inject(Router);

    this.setHeader();
    void router.events.forEach(event => {
      if (event instanceof NavigationEnd) {
        this.setHeader();
      }
    });
  }

  setHeader() {
    const pathname = isPlatformBrowser(this.platformId)
      ? window.location.pathname
      : isPlatformServer(this.platformId)
        ? this.platformLocation.pathname
        : null;

    if (pathname) {
      if (pathname.includes('/theme/rome')) {
        this.style = 'standard_header';
      } else if (pathname.includes('/theme/madrid')) {
        this.style = 'classic_header';
      } else if (pathname.includes('/theme/berlin') || pathname.includes('/theme/denver')) {
        this.style = 'minimal_header';
      } else {
        this.themeOption$.subscribe(theme => {
          this.style = theme?.header ? theme?.header?.header_options : 'basic_header';
          this.sticky = theme?.header && theme?.header?.sticky_header_enable ? true : this.sticky;
        });
      }
    }
  }
}
