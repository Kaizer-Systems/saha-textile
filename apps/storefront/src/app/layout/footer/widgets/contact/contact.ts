import { Component, computed, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { injectBrandQuery } from '@data-access/queries/brand.queries';

@Component({
	selector: 'app-footer-contact',
	templateUrl: './contact.html',
	styleUrls: ['./contact.scss'],
	imports: [TranslocoModule],
})
export class Contact {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly data = input<ISiteConfig | null>();

	private readonly brand = injectBrandQuery();
	/**
	 * The shop's app store pages from the Brand Kit (owner, 2026-11-10). Each badge shows only once
	 * its link is saved; the theme file's placeholder links are no longer used.
	 */
	readonly apps = computed(() => this.brand.data()?.apps ?? { android: '', ios: '' });
}
