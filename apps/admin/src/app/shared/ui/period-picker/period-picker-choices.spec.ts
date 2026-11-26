import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { ACCOUNTS_PRESETS, PeriodPicker, type PeriodPreset } from './period-picker';

import type { NgbDropdown } from '@ng-bootstrap/ng-bootstrap';

/** The picker on the accounts lists (accounts brief A1): its own choices, the first one, their words and hints. */

function setup(withHint = true) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			PeriodPicker,
			TranslocoTestingModule.forRoot({
				langs: { en: { period_this_month: 'This month', period_today: 'Today' } },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
	});
	const fixture = TestBed.createComponent(PeriodPicker);
	fixture.componentRef.setInput('choices', ACCOUNTS_PRESETS);
	fixture.componentRef.setInput('start', 'this_month');
	fixture.componentRef.setInput('labelPrefix', 'period_');
	if (withHint)
		fixture.componentRef.setInput('hint', (preset: PeriodPreset) => (preset === 'today' ? '24 Nov 2026' : null));
	const picker = fixture.componentInstance;
	const picked: unknown[] = [];
	const changed: unknown[] = [];
	picker.picked.subscribe((value) => picked.push(value));
	picker.changed.subscribe((value) => changed.push(value));
	return { fixture, picker, picked, changed, menu: { close: vi.fn() } as unknown as NgbDropdown };
}

describe('the period picker on accounts lists', () => {
	it('starts on the chosen period and names it with the page’s words', () => {
		const { fixture, picker } = setup();
		fixture.detectChanges();
		expect(picker.selected()).toBe('this_month');
		const anchor = (fixture.nativeElement as HTMLElement).querySelector('a') as HTMLElement;
		expect(anchor.textContent?.trim()).toBe('This month');
		anchor.click();
		fixture.detectChanges();
		const items = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
		expect(items).toHaveLength(ACCOUNTS_PRESETS.length);
		expect(items[0]?.textContent).toContain('Today');
		expect(items[0]?.textContent).toContain('24 Nov 2026');
	});

	it('sends every choice to the lists, and the dashboard’s own choices to the dashboard as well', () => {
		const { picker, picked, changed, menu } = setup();
		picker.choose('today', menu);
		picker.choose('last_month', menu);
		expect(picked).toEqual([{ period: 'today' }, { period: 'last_month' }]);
		expect(changed).toEqual([{ period: 'last_month' }]);
	});

	it('shows no hints unless the page gives them', () => {
		const { fixture } = setup(false);
		fixture.detectChanges();
		((fixture.nativeElement as HTMLElement).querySelector('a') as HTMLElement).click();
		fixture.detectChanges();
		expect((fixture.nativeElement as HTMLElement).querySelectorAll('small')).toHaveLength(0);
	});
});
