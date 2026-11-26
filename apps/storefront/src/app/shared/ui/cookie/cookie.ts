import { afterNextRender, Component, DestroyRef, DOCUMENT, effect, inject, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { ConsentStore } from '@core/consent/consent.store';
import { CONSENT_ASK_CLASS, CONSENT_TAP_ATTRIBUTE } from '@core/consent/cookie-catalogue';
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
		const destroyed = inject(DestroyRef);
		afterNextRender(() => {
			page.documentElement.classList.remove(CONSENT_ASK_CLASS);
			// After Angular's replay has had its turn (it runs in the same task as waking up). A box gone by then does nothing.
			const later = setTimeout(() => this.carryOutEarlyTap(page));
			destroyed.onDestroy(() => clearTimeout(later));
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
		this.answer(() => this.settings().necessaryOnly());
	}

	acceptAll() {
		this.answer(() => this.settings().acceptAll());
	}

	choose() {
		this.answer(() => this.consent.openSettings());
	}

	/**
	 * The box's buttons act only while no decision exists. The box is hidden once there is one, so what still reaches
	 * them then is the same early tap a second time: carried out from the head script's note, then replayed late by
	 * Angular on a slow phone. Answering it twice would record the decision twice.
	 */
	private answer(act: () => void): void {
		if (this.consent.decided()) return;
		this.acted = true;
		act();
	}

	/**
	 * A tap the head script noted before the box woke, which Angular did not replay (it drops a tap that arrives while
	 * the box is already waking on idle): carried out now, once, unless a button has acted or a decision exists.
	 */
	carryOutEarlyTap(page: Document): void {
		const tapped = page.documentElement.getAttribute(CONSENT_TAP_ATTRIBUTE);
		page.documentElement.removeAttribute(CONSENT_TAP_ATTRIBUTE);
		if (!tapped || this.acted) return;
		if (tapped === 'cookie_accept_btn') this.acceptAll();
		else if (tapped === 'cookie_necessary_btn') this.necessaryOnly();
		else if (tapped === 'cookie_choose_btn') this.choose();
	}
}
