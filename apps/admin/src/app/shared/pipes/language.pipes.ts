import { inject, Pipe, type PipeTransform } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import {
	formatBytes,
	formatCount,
	languageList,
	languageName,
	pluralCategory,
} from '@saha-textile/core-domain/languages';

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

/** A language's name in its own script: `{{ 'bn' | languageName }}` → "বাংলা". */
@Pipe({ name: 'languageName' })
export class LanguageNamePipe implements PipeTransform {
	transform(code: string | null | undefined): string {
		return code ? languageName(code) : '';
	}
}

/** Several languages as one list, joined the reader's way: `{{ ['en', 'bn'] | languageList }}` → "English and বাংলা". */
@Pipe({ name: 'languageList', pure: false })
export class LanguageListPipe implements PipeTransform {
	private readonly transloco = inject(TranslocoService);

	transform(codes: readonly string[] | null | undefined): string {
		return languageList(codes ?? [], this.transloco.getActiveLang());
	}
}

/** A size in the admin's language: `{{ bytes | fileSize }}` → "18.6 MB" (steps of 1024, as the storage box). */
@Pipe({ name: 'fileSize', pure: false })
export class FileSizePipe implements PipeTransform {
	private readonly transloco = inject(TranslocoService);

	transform(bytes: number | null | undefined): string {
		return formatBytes(bytes ?? 0, this.transloco.getActiveLang());
	}
}
