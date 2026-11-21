import { afterNextRender, Component, DOCUMENT, effect, inject, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CONSENT_ASK_CLASS, CONSENT_TAP_ATTRIBUTE } from '@core/consent/cookie-catalogue';
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
	/** A button of the box has done its work since the box woke (a live tap, or Angular's replay of an early one). */
	private acted = false;

	constructor() {
		// From here the box follows the decision alone: the head script's mark has done its job.
		const page = inject(DOCUMENT);
		afterNextRender(() => {
			page.documentElement.classList.remove(CONSENT_ASK_CLASS);
			// After Angular's replay has had its turn (it runs in the same task as waking up).
			setTimeout(() => this.carryOutEarlyTap(page));
		});
		const auth = inject(AuthStore);
		let signedIn = false;
		effect(() => {
			const now = auth.isAuthenticated();
			if (now && !signedIn) untracked(() => void this.consent.syncAccount());
			signedIn = now;
		});
	}

	necessaryOnly() {
		this.acted = true;
		this.settings().necessaryOnly();
	}

	acceptAll() {
		this.acted = true;
		this.settings().acceptAll();
	}

	choose() {
		this.acted = true;
		this.consent.openSettings();
	}

	/**
	 * A tap the head script noted before the box woke, which Angular did not replay (it drops a tap that arrives while
	 * the box is already waking on idle): carried out now, once, unless a button has acted or a decision exists.
	 */
	carryOutEarlyTap(page: Document): void {
		const tapped = page.documentElement.getAttribute(CONSENT_TAP_ATTRIBUTE);
		page.documentElement.removeAttribute(CONSENT_TAP_ATTRIBUTE);
		if (!tapped || this.acted || this.consent.decided()) return;
		if (tapped === 'cookie_accept_btn') this.acceptAll();
		else if (tapped === 'cookie_necessary_btn') this.necessaryOnly();
		else if (tapped === 'cookie_choose_btn') this.choose();
	}
}
