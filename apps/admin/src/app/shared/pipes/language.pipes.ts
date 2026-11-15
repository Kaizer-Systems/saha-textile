import { inject, Pipe, type PipeTransform } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { formatCount, languageList, languageName, pluralCategory } from '@saha-textile/core-domain/languages';

/**
 * The translation key for a count: `key_one`, `key_other` (or another form the language has),
 * chosen by the language's plural rules. A form the language's file lacks falls back to `_other`.
 */
export function pluralKey(transloco: TranslocoService, key: string, count: number): string {
	const lang = transloco.getActiveLang();
	const form = `${key}_${pluralCategory(count, lang)}`;
	const strings = transloco.getTranslation(lang) as Record<string, unknown> | undefined;
	return strings && form in strings ? form : `${key}_other`;
}

/** A sentence with a count, in the right plural form: `{{ 'image_count' | plural: 3 }}` → "3 images". */
export function translateCount(
	transloco: TranslocoService,
	key: string,
	count: number,
	params: Record<string, unknown> = {},
): string {
	return transloco.translate(pluralKey(transloco, key, count), {
		...params,
		count: formatCount(count, transloco.getActiveLang()),
	});
}

/** A count sentence in the right plural form for the language the admin is shown in. */
@Pipe({ name: 'plural', pure: false })
export class PluralPipe implements PipeTransform {
	private readonly transloco = inject(TranslocoService);

	transform(key: string, count: number, params: Record<string, unknown> = {}): string {
		return translateCount(this.transloco, key, count, params);
	}
}

/** A language's name in the language the admin is shown in: `{{ 'bn' | languageName }}` → "Bangla". */
@Pipe({ name: 'languageName', pure: false })
export class LanguageNamePipe implements PipeTransform {
	private readonly transloco = inject(TranslocoService);

	transform(code: string | null | undefined): string {
		return code ? languageName(code, this.transloco.getActiveLang()) : '';
	}
}

/** Several languages as one list: `{{ ['en', 'bn'] | languageList }}` → "English and Bangla". */
@Pipe({ name: 'languageList', pure: false })
export class LanguageListPipe implements PipeTransform {
	private readonly transloco = inject(TranslocoService);

	transform(codes: readonly string[] | null | undefined): string {
		return languageList(codes ?? [], this.transloco.getActiveLang());
	}
}
