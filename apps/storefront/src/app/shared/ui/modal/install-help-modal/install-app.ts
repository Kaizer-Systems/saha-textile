import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, provideEnvironmentInitializer } from '@angular/core';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { InstallHelpModal } from './install-help-modal';

/** Chrome's `beforeinstallprompt` event, which TypeScript's DOM types do not include. */
interface InstallOffer extends Event {
	prompt(): Promise<unknown>;
}

/**
 * What Get the App does. A browser that can install the shop gets its own prompt; any other gets
 * the how-to popup. Nothing here runs until a shopper clicks, and nothing is stored.
 */
@Injectable({ providedIn: 'root' })
export class InstallApp {
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly modals = inject(NgbModal);

	private offer: InstallOffer | null = null;

	/** The browser offers once per page, soon after load, so this listens from startup. */
	start(): void {
		if (!this.isBrowser) return;
		// No preventDefault(): that would remove the install bar Chrome shows by itself on Android.
		window.addEventListener('beforeinstallprompt', (event) => (this.offer = event as InstallOffer));
		window.addEventListener('appinstalled', () => (this.offer = null));
	}

	async open(): Promise<void> {
		const offer = this.offer;
		this.offer = null; // A browser's offer works once.
		try {
			if (offer) return void (await offer.prompt());
		} catch {
			// The browser refused, for example on a click replayed long after it was made.
		}
		this.modals.open(InstallHelpModal, {
			ariaLabelledBy: 'install_help_title',
			centered: true,
			windowClass: 'theme-modal modal-lg',
		});
	}
}

export function provideInstallApp() {
	return provideEnvironmentInitializer(() => inject(InstallApp).start());
}
