import { Component, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { languageName } from '@saha-textile/core-domain/languages';

import type { LanguageGap } from '@core/i18n/localized-fields';

/**
 * One switch at the top of a form changes every language-bound field on it. The shop's active
 * languages decide the buttons, so adding a language adds a button and nothing else. A language
 * with work left shows a count that opens its to-do list; each line jumps to the field. Names come
 * from the browser's language data in the language the admin is shown in ("Bangla" in English,
 * "বাংলা" in Bengali), so a new language is named without anyone typing it.
 */
@Component({
	selector: 'app-language-switch',
	templateUrl: './language-switch.html',
	imports: [TranslocoModule, NgbDropdownModule],
})
export class LanguageSwitch {
	private readonly reading = toSignal(inject(TranslocoService).langChanges$, { initialValue: 'en' });

	readonly locales = input.required<readonly string[]>();
	readonly active = input.required<string>();
	/** What is still empty in each language. */
	readonly gaps = input<Readonly<Record<string, readonly LanguageGap[]>>>({});
	readonly changed = output<string>();
	readonly gapChosen = output<{ key: string; locale: string }>();

	name(locale: string): string {
		return languageName(locale, this.reading());
	}
}
