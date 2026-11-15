import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { LanguageListPipe, LanguageNamePipe, PluralPipe, pluralKey, translateCount } from './language.pipes';

const transloco = (lang: string, strings: Record<string, string>) => ({
	getActiveLang: () => lang,
	getTranslation: () => strings,
	translate: vi.fn(
		(key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`,
	),
});

const pipe = <T>(type: new () => T, service: unknown): T => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [type, { provide: TranslocoService, useValue: service }] });
	return TestBed.inject(type);
};

describe('counts in sentences', () => {
	it('picks the plural form the language uses for the count', () => {
		const english = transloco('en', { image_count_one: '', image_count_other: '' }) as unknown as TranslocoService;
		expect(pluralKey(english, 'image_count', 1)).toBe('image_count_one');
		expect(pluralKey(english, 'image_count', 0)).toBe('image_count_other');
		expect(pluralKey(english, 'image_count', 37)).toBe('image_count_other');
	});

	it('falls back to the other form when the language’s file lacks one', () => {
		const sparse = transloco('en', { image_count_other: '' }) as unknown as TranslocoService;
		expect(pluralKey(sparse, 'image_count', 1)).toBe('image_count_other');
		const unloaded = { ...transloco('en', {}), getTranslation: () => undefined } as unknown as TranslocoService;
		expect(pluralKey(unloaded, 'image_count', 1)).toBe('image_count_other');
	});

	it('writes the count with the language’s digits, keeping other values', () => {
		const bengali = transloco('bn', { event_reach_one: '', event_reach_other: '' });
		expect(translateCount(bengali as unknown as TranslocoService, 'event_reach', 1234, { name: 'x' })).toBe(
			'event_reach_other{"name":"x","count":"1,234"}',
		);
		expect(pipe(PluralPipe, bengali).transform('event_reach', 1)).toBe('event_reach_one{"count":"1"}');
	});
});

describe('language names and lists', () => {
	it('names a language in its own script, whoever reads', () => {
		expect(new LanguageNamePipe().transform('bn')).toBe('বাংলা');
		expect(new LanguageNamePipe().transform('en')).toBe('English');
		expect(new LanguageNamePipe().transform(null)).toBe('');
	});

	it('joins the own-script names the way the reader’s language does', () => {
		expect(pipe(LanguageListPipe, transloco('en', {})).transform(['en', 'bn'])).toBe('English and বাংলা');
		expect(pipe(LanguageListPipe, transloco('bn', {})).transform(['en', 'bn'])).toBe('English এবং বাংলা');
		expect(pipe(LanguageListPipe, transloco('en', {})).transform(undefined)).toBe('');
	});
});
