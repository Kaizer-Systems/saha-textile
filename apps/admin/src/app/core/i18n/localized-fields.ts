import { signal } from '@angular/core';
import type { FormGroup } from '@angular/forms';

export type LocalizedText = Record<string, string>;

/** One line of the Language switch's to-do list. */
export interface LanguageGap {
	/** The form control name or element id the line jumps to. */
	key: string;
	/** A translation key. */
	label: string;
	/** Which row it means, when a label alone cannot say: a value's English name, for example. */
	name?: string;
}

/** Every language's to-do list, built from a function that lists one language. */
export function gapsByLocale(gaps: (locale: string) => LanguageGap[]): Record<string, LanguageGap[]> {
	return Object.fromEntries(ADMIN_LOCALES.map((locale) => [locale, gaps(locale)]));
}

/** Long enough for the to-do menu to hand focus back, and for a tab to finish fading in. */
const FOCUS_DELAY_MS = 200;

/** Puts the cursor in a field once the language and tab it lives on have been drawn. */
export function focusField(page: Document, key: string): void {
	setTimeout(() => {
		const target = page.getElementById(key) ?? page.querySelector(`[formcontrolname="${key}"]`);
		const field = target?.matches('input, textarea, select')
			? target
			: (target?.querySelector('[contenteditable], input, textarea, select') ?? target);
		(field as HTMLElement | null)?.focus();
	}, FOCUS_DELAY_MS);
}

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
		/** Fields that may stay empty, and need other languages only once English is written. */
		private readonly optional: readonly string[] = [],
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

	/** The fields still empty in a language, each named by its control and its translation key. */
	gaps(locale: string): LanguageGap[] {
		this.capture();
		return this.fields
			.filter((field) => {
				const needed = !this.optional.includes(field) || this.values[field]?.[SOURCE_LOCALE]?.trim();
				return needed && !this.values[field]?.[locale]?.trim();
			})
			.map((field) => ({ key: field, label: field }));
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
