import { Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

const NAMES: Readonly<Record<string, string>> = { en: 'English', fr: 'Français', bn: 'বাংলা' };

/**
 * One switch at the top of a form changes every language-bound field on it. The shop's active
 * languages decide the buttons, so adding a language adds a button and nothing else.
 */
@Component({
	selector: 'app-language-switch',
	templateUrl: './language-switch.html',
	imports: [TranslocoModule],
})
export class LanguageSwitch {
	readonly locales = input.required<readonly string[]>();
	readonly active = input.required<string>();
	/** Fields still empty in each language. */
	readonly missing = input<Readonly<Record<string, number>>>({});
	readonly changed = output<string>();

	name(locale: string): string {
		return NAMES[locale] ?? locale;
	}
}
