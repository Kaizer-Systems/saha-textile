import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';

import { LanguageSwitch } from './language-switch';

const render = (gaps: Record<string, { key: string; label: string }[]> = {}) => {
	TestBed.resetTestingModule();
	const states = signal<Record<string, string>>({ en: 'on', bn: 'on', hi: 'draft' });
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActiveLanguages, useValue: { isDraft: (code: string) => states()[code] !== 'on' } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(LanguageSwitch, {
		set: {
			imports: [],
			template: `@for (locale of locales(); track locale) {<button [attr.data-locale]="locale">{{ name(locale) }}@if (draft(locale)) {<span class="badge bg-warning">Draft</span>}</button>}`,
		},
	});
	const fixture = TestBed.createComponent(LanguageSwitch);
	fixture.componentRef.setInput('locales', ['en', 'bn', 'hi']);
	fixture.componentRef.setInput('active', 'en');
	fixture.componentRef.setInput('gaps', gaps);
	fixture.detectChanges();
	return fixture;
};

describe('the form Language switch', () => {
	it('names each language in its own script and marks one the shop does not show yet as Draft', () => {
		const fixture = render();
		const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
		expect(buttons.map((button) => button.textContent)).toEqual(['English', 'বাংলা', 'हिन्दीDraft']);
		expect(fixture.componentInstance.draft('bn')).toBe(false);
	});
});
