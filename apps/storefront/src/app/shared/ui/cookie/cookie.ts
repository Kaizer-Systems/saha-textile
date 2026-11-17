import { afterNextRender, Component, DOCUMENT, effect, inject, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CONSENT_ASK_CLASS } from '@core/consent/cookie-catalogue';
import { ConsentStore } from '@core/consent/consent.store';
import { AuthStore } from '@core/state/auth.store';

import { CookieSettings, longestLabel } from './cookie-settings/cookie-settings';

/**
 * First visit: the box. Refusing takes one click, the same as accepting. The server draws it hidden in every page and
 * the page head shows it to a visitor who has not decided (consent-ask.vite.ts); once this runs, `boxOpen` decides.
 */
@Component({
	selector: 'app-cookie',
	templateUrl: './cookie.html',
	styleUrls: ['./cookie.scss'],
	imports: [TranslocoModule, RouterLink, CookieSettings],
})
export class Cookie {
	readonly consent = inject(ConsentStore);
	readonly settings = viewChild.required(CookieSettings);
	readonly longest = longestLabel;

	constructor() {
		// From here the box follows the decision alone: the head script's mark has done its job.
		const page = inject(DOCUMENT);
		afterNextRender(() => page.documentElement.classList.remove(CONSENT_ASK_CLASS));
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
