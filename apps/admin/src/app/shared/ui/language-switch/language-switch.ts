import { Component, inject, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { languageName } from '@saha-textile/core-domain/languages';

import { ActiveLanguages } from '@core/i18n/active-languages';

import type { LanguageGap } from '@core/i18n/localized-fields';

/**
 * One switch at the top of a form changes every language-bound field on it. The shop's active
 * languages decide the buttons, so adding a language adds a button and nothing else. A language
 * with work left shows a count that opens its to-do list; each line jumps to the field. Each
 * language is named in its own script ("English", "বাংলা") from the browser's language data, so a
 * new language is named without anyone typing it. A language the shop does not show yet is marked
 * Draft: its text can be written now, and nothing it lacks stops Go Live (Settings › Languages).
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

	private readonly languages = inject(ActiveLanguages);

	draft(locale: string): boolean {
		return this.languages.isDraft(locale);
	}

	name(locale: string): string {
		return languageName(locale);
	}
}
