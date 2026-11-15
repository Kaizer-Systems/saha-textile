import { Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { LanguageNamePipe } from '@shared/pipes/language.pipes';

/**
 * The line above a list opened from Settings › Languages: it shows only what is missing in one
 * language, and "Show all" takes the filter off. The theme's amber alert, nothing of its own.
 */
@Component({
	selector: 'app-missing-language-notice',
	imports: [RouterModule, TranslocoModule, LanguageNamePipe],
	template: `
		@if (code(); as language) {
			<div class="alert alert-warning d-flex align-items-center justify-content-between flex-wrap gap-2">
				<span>{{ 'lang_missing_filter' | transloco: { language: (language | languageName) } }}</span>
				<a
					id="missing_language_show_all"
					[routerLink]="[]"
					[queryParams]="{ missing: null }"
					queryParamsHandling="merge"
				>
					{{ 'lang_show_all' | transloco }}
				</a>
			</div>
		}
	`,
})
export class MissingLanguageNotice {
	readonly code = input<string | null>(null);
}
