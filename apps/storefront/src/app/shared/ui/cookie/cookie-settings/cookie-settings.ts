import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, inject, signal, TemplateRef, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';

import { ConsentStore } from '@core/consent/consent.store';
import { EMPTY_CATEGORIES, FUNCTIONAL_ITEMS, NECESSARY_ITEMS } from '@core/consent/cookie-catalogue';

/** The longest label's length: the buttons use it to decide how many fit on a row. */
export const longestLabel = (...labels: string[]): number => Math.max(...labels.map((label) => label.length));

/** The choice in full. Empty categories say so instead of offering a switch that does nothing. */
@Component({
	selector: 'app-cookie-settings',
	templateUrl: './cookie-settings.html',
	imports: [NgTemplateOutlet, TranslocoModule, RouterLink],
})
export class CookieSettings {
	private readonly modal = inject(NgbModal);
	private readonly consent = inject(ConsentStore);

	readonly template = viewChild.required<TemplateRef<unknown>>('cookieSettings');
	readonly necessary = NECESSARY_ITEMS;
	readonly functionalItems = FUNCTIONAL_ITEMS;
	readonly empty = EMPTY_CATEGORIES;
	readonly longest = longestLabel;

	readonly functional = signal(false);
	readonly openList = signal<'necessary' | 'functional' | null>(null);
	private ref: NgbModalRef | null = null;

	constructor() {
		effect(() => {
			if (this.consent.settingsRequests() > 0) untracked(() => this.open());
		});
	}

	/**
	 * One popup at a time. A tap on the box's Choose before the box woke can arrive twice on a slow phone: the box
	 * carries out the tap the page head noted, then Angular's late replay of the same tap asks again.
	 */
	private open() {
		if (this.ref) return;
		this.functional.set(this.consent.allows('functional'));
		this.openList.set(null);
		this.ref = this.modal.open(this.template(), {
			ariaLabelledBy: 'cookie-settings-title',
			modalDialogClass: 'cookie-settings',
			windowClass: 'theme-modal cookie-settings-modal',
		});
		const closed = () => (this.ref = null);
		this.ref.result.then(closed, closed);
	}

	toggleList(list: 'necessary' | 'functional') {
		this.openList.update((open) => (open === list ? null : list));
	}

	necessaryOnly() {
		this.finish(false);
	}

	/** Turns on what is really in use, so nobody agrees to something that does not exist. */
	acceptAll() {
		this.finish(true);
	}

	saveChoices() {
		this.finish(this.functional());
	}

	private finish(functional: boolean) {
		this.consent.save({ functional });
		this.ref?.close();
	}
}
