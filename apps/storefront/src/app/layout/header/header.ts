import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

import { MinimalHeader } from './minimal-header/minimal-header';
import { MobileMenu } from './widgets/mobile-menu/mobile-menu';

/**
 * Global header shell. The app has a single header (Denver's minimal header) — the
 * old per-theme header-style switching (basic/classic/standard) and its pathname
 * branching were removed when the theme concept was dropped. `siteConfig$` still
 * feeds the header its site config (top-bar content, etc.); the mobile bottom bar
 * (app-mobile-menu) renders unconditionally below md.
 */
@Component({
	selector: 'app-header',
	templateUrl: './header.html',
	styleUrls: ['./header.scss'],
	imports: [MinimalHeader, MobileMenu, AsyncPipe],
})
export class Header {
	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	readonly logo = input<string>();
	public readonly sticky = true;
}
