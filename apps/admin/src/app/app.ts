import { Component, DOCUMENT, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbNavConfig } from '@ng-bootstrap/ng-bootstrap';
import { LoadingBarRouterModule } from '@ngx-loading-bar/router';
import { Observable } from 'rxjs';

import { SettingStore } from '@core/state/setting.store';
import { IValues } from '@data-access/interfaces/setting.interface';

@Component({
	selector: 'app-root',
	imports: [RouterModule, LoadingBarRouterModule],
	templateUrl: './app.html',
	styleUrl: './app.scss',
})
export class App {
	private titleService = inject(Title);
	private settingStore = inject(SettingStore);
	private translate = inject(TranslocoService);

	setting$: Observable<IValues | null> = toObservable(this.settingStore.setting);

	public favIcon: HTMLLinkElement | null;

	constructor() {
		const config = inject(NgbNavConfig);
		const document = inject<Document>(DOCUMENT);

		this.translate.setActiveLang('en');
		this.settingStore.loadSetting().subscribe();
		this.setting$.subscribe((setting) => {
			// Set Direction
			if (setting?.general?.admin_site_language_direction === 'rtl') {
				document.getElementsByTagName('html')[0].setAttribute('dir', 'rtl');
				document.body.classList.add('rtl');
			} else {
				document.getElementsByTagName('html')[0].removeAttribute('dir');
				document.body.classList.remove('rtl');
			}

			// Set Favicon
			this.favIcon = document.querySelector('#appIcon');
			this.favIcon!.href = <string>setting?.general?.favicon_image?.original_url;

			// Set site title
			this.titleService.setTitle(
				setting?.general?.site_title && setting?.general?.site_tagline
					? `${setting?.general?.site_title} | ${setting?.general?.site_tagline}`
					: 'FastKart Marketplace: Where Vendors Shine Together',
			);
		});

		// customize default values of navs used by this component tree
		config.destroyOnHide = false;
		config.roles = false;
	}
}
