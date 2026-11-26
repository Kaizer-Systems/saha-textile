import { Pipe, PipeTransform, inject } from '@angular/core';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { intlLocale } from '@core/i18n/locale';

/**
 * A date as the shop shows it: day, month and year in Kolkata, in the page language, with English
 * digits on Bengali pages (BN-3). Never the time of day (owner log § blog).
 */
@Pipe({ name: 'shopDate' })
export class ShopDatePipe implements PipeTransform {
	private readonly locale = inject(ACTIVE_LOCALE);
	/** Indian English puts the day first: 8 Nov 2026. */
	private readonly format = new Intl.DateTimeFormat(this.locale === 'en' ? 'en-IN' : intlLocale(this.locale), {
		day: 'numeric',
		// Bengali's short month names are clipped (নভেঃ); the full name reads naturally.
		month: this.locale === 'bn' ? 'long' : 'short',
		year: 'numeric',
		timeZone: 'Asia/Kolkata',
	});

	transform(value: string | null | undefined): string {
		if (!value) return '';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? '' : this.format.format(date);
	}
}
