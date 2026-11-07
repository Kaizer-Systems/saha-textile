import { Component, effect, inject, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { ConsentStore } from '@core/consent/consent.store';
import { AuthStore } from '@core/state/auth.store';

import { CookieSettings } from './cookie-settings/cookie-settings';

/** First visit: the box. Refusing takes one click, the same as accepting. */
@Component({
	selector: 'app-cookie',
	templateUrl: './cookie.html',
	styleUrls: ['./cookie.scss'],
	imports: [TranslocoModule, RouterLink, CookieSettings],
})
export class Cookie {
	readonly consent = inject(ConsentStore);
	readonly settings = viewChild.required(CookieSettings);

	constructor() {
		const auth = inject(AuthStore);
		let signedIn = false;
		effect(() => {
			const now = auth.isAuthenticated();
			if (now && !signedIn) untracked(() => void this.consent.syncAccount());
			signedIn = now;
		});
	}

	necessaryOnly() {
		this.settings().necessaryOnly();
	}

	acceptAll() {
		this.settings().acceptAll();
	}
}
