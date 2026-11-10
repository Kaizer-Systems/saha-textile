import { Component, DOCUMENT, effect, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { Router, RouterModule } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbNavConfig } from '@ng-bootstrap/ng-bootstrap';
import { LoadingBarRouterModule } from '@ngx-loading-bar/router';
import { Observable } from 'rxjs';

import { injectBrandQuery } from '@core/brand/brand.gateway';
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

	private readonly brand = injectBrandQuery();

	/** True after this tab has held an authenticated session — drives clean login redirect. */
	private hadAuthenticatedSession = false;

	constructor() {
		const page = inject<Document>(DOCUMENT);
		// The admin's tab icon from the Brand Kit (its own set, else the shop's), plus the icon a
		// dark browser picks when the Brand Kit has one.
		effect(() => {
			const logos = this.brand.data()?.admin;
			const icon = logos?.icons['32'];
			const link = page.querySelector<HTMLLinkElement>('#appIcon');
			if (icon && link) {
				link.type = 'image/png';
				link.href = icon;
			}
			const darkIcon = logos?.iconsDark['32'];
			let dark = page.querySelector<HTMLLinkElement>('#appIconDark');
			if (!darkIcon) {
				dark?.remove();
				return;
			}
			if (!dark) {
				dark = page.createElement('link');
				dark.id = 'appIconDark';
				dark.rel = 'icon';
				dark.type = 'image/png';
				dark.media = '(prefers-color-scheme: dark)';
				page.head.appendChild(dark);
			}
			dark.href = darkIcon;
		});
		const config = inject(NgbNavConfig);
		const document = inject<Document>(DOCUMENT);

		this.translate.setActiveLang('en');
		// The page states its language, so the Bengali type rules (`:lang(bn)`) and screen
		// readers follow the switcher.
		this.translate.langChanges$.subscribe((lang) => (page.documentElement.lang = lang));
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

			// Set site title
			this.titleService.setTitle(
				setting?.general?.site_title && setting?.general?.site_tagline
					? `${setting?.general?.site_title} | ${setting?.general?.site_tagline}`
					: 'Saha Textile Admin',
			);
		});

		// customize default values of navs used by this component tree
		config.destroyOnHide = false;
		config.roles = false;
	}
}
