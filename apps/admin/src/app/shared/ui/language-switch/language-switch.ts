import { Component, input, output } from '@angular/core';

import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { TranslocoModule } from '@jsverse/transloco';

import type { LanguageGap } from '@core/i18n/localized-fields';

const NAMES: Readonly<Record<string, string>> = { en: 'English', fr: 'Français', bn: 'বাংলা' };

/**
 * One switch at the top of a form changes every language-bound field on it. The shop's active
 * languages decide the buttons, so adding a language adds a button and nothing else. A language
 * with work left shows a count that opens its to-do list; each line jumps to the field.
 */
@Component({
	selector: 'app-language-switch',
	templateUrl: './language-switch.html',
	imports: [TranslocoModule, NgbDropdownModule],
})
export class LanguageSwitch {
	readonly locales = input.required<readonly string[]>();
	readonly active = input.required<string>();
	/** What is still empty in each language. */
	readonly gaps = input<Readonly<Record<string, readonly LanguageGap[]>>>({});
	readonly changed = output<string>();
	readonly gapChosen = output<{ key: string; locale: string }>();

	name(locale: string): string {
		return NAMES[locale] ?? locale;
	}
}
