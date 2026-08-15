import { Component, DOCUMENT, effect, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { Router, RouterModule } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbNavConfig } from '@ng-bootstrap/ng-bootstrap';
import { LoadingBarRouterModule } from '@ngx-loading-bar/router';
import { Observable } from 'rxjs';

import { IdleLockService } from '@core/auth/idle-lock.service';
import { AuthStore } from '@core/state/auth.store';
import { SettingStore } from '@core/state/setting.store';
import { IValues } from '@data-access/interfaces/setting.interface';
import { IdleLockModal } from '@shared/ui/idle-lock-modal/idle-lock-modal';

@Component({
	selector: 'app-root',
	imports: [RouterModule, LoadingBarRouterModule, IdleLockModal],
	templateUrl: './app.html',
	styleUrl: './app.scss',
})
export class App {
	private titleService = inject(Title);
	private settingStore = inject(SettingStore);
	private translate = inject(TranslocoService);
	private readonly auth = inject(AuthStore);
	private readonly idleLock = inject(IdleLockService);
	private readonly router = inject(Router);

	setting$: Observable<IValues | null> = toObservable(this.settingStore.setting);

	public favIcon: HTMLLinkElement | null;

	/** True after this tab has held an authenticated session — drives clean login redirect. */
	private hadAuthenticatedSession = false;

	constructor() {
		const config = inject(NgbNavConfig);
		const document = inject<Document>(DOCUMENT);

		this.translate.setActiveLang('en');
		this.settingStore.loadSetting().subscribe();

		effect(() => {
			if (this.auth.isAuthenticated()) this.idleLock.start();
			else this.idleLock.stop();
		});

		// Interceptor clears the session without navigating (startup deadlock). Once the
		// router is live, leave the empty shell for login instead of Dashboard-only chrome.
		effect(() => {
			if (this.auth.isResolving()) return;
			if (this.auth.isAuthenticated()) {
				this.hadAuthenticatedSession = true;
				return;
			}
			if (this.hadAuthenticatedSession && this.auth.status() === 'anonymous') {
				this.hadAuthenticatedSession = false;
				const url = this.router.url;
				if (!url.startsWith('/auth/')) {
					void this.router.navigate(['/auth/login']);
				}
			}
		});

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
