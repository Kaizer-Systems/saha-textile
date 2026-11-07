import { signal } from '@angular/core';
import type { FormGroup } from '@angular/forms';

export type LocalizedText = Record<string, string>;

/** The admin edits every language; English is the guide shown under other languages. */
export const ADMIN_LOCALES: readonly string[] = ['en', 'fr'];
export const SOURCE_LOCALE = 'en';

/**
 * Language-bound form fields behind one Language switch. Each field keeps one control; this holds
 * every language's text and swaps the controls when the language changes, so a form stays one
 * screen long however many languages the shop has.
 */
export class LocalizedFields {
	readonly locale = signal(SOURCE_LOCALE);
	private values: Record<string, LocalizedText>;

	constructor(
		private readonly form: FormGroup,
		private readonly fields: readonly string[],
	) {
		this.values = Object.fromEntries(fields.map((field) => [field, {}]));
	}

	/** Fills every language and shows the current one. */
	load(values: Record<string, LocalizedText>): void {
		this.values = Object.fromEntries(this.fields.map((field) => [field, { ...(values[field] ?? {}) }]));
		this.show();
	}

	switchTo(locale: string): void {
		this.capture();
		this.locale.set(locale);
		this.show();
	}

	/** Every language of one field, including anything typed but not yet switched away from. */
	text(field: string): LocalizedText {
		this.capture();
		return { ...this.values[field] };
	}

	/** The English text, shown as a guide under a field in another language. */
	source(field: string): string {
		if (this.locale() === SOURCE_LOCALE) return '';
		return this.values[field]?.[SOURCE_LOCALE] ?? '';
	}

	/** How many of these fields are empty in a language. */
	missing(locale: string): number {
		this.capture();
		return this.fields.filter((field) => !this.values[field]?.[locale]?.trim()).length;
	}

	private capture(): void {
		const raw = this.form.getRawValue() as Record<string, unknown>;
		for (const field of this.fields) {
			const value = raw[field];
			(this.values[field] as LocalizedText)[this.locale()] = typeof value === 'string' ? value : '';
		}
	}

	private show(): void {
		const locale = this.locale();
		const shown = Object.fromEntries(this.fields.map((field) => [field, this.values[field]?.[locale] ?? '']));
		this.form.patchValue(shown, { emitEvent: false });
	}
}
