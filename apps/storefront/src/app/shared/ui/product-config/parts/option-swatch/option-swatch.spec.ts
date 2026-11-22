import { CurrencyPipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { IAddonTerm } from '@data-access/interfaces/product-detail.interface';

import { OptionSwatch } from './option-swatch';

describe('OptionSwatch', () => {
	const render = () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(OptionSwatch, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(OptionSwatch);
		fixture.componentRef.setInput('terms', [{ code: 'a', label: 'Alpha' }]);
		return fixture;
	};

	it('names the selected term, and nothing for an unknown one', () => {
		const fixture = render();
		fixture.componentRef.setInput('selected', 'a');
		expect(fixture.componentInstance.selectedLabel()).toBe('Alpha');
		fixture.componentRef.setInput('selected', 'b');
		expect(fixture.componentInstance.selectedLabel()).toBe('');
	});

	it('emits the chosen code', () => {
		const fixture = render();
		const seen: string[] = [];
		fixture.componentInstance.selectedChange.subscribe((code) => seen.push(code));
		fixture.componentInstance.select('a');
		expect(seen).toEqual(['a']);
	});
});

describe('OptionSwatch, the four looks from the renders', () => {
	const terms: IAddonTerm[] = [
		{ code: 'none', label: 'No Design', price_delta: 0 },
		{ code: 'boat', label: 'Boat Neck', price_delta: 750, image: 'https://cdn.example/boat.webp', hex: '#aa0000' },
		{ code: 'm', label: 'M', sub_label: 'Medium', price_delta: 0 },
	];
	const draw = (displayStyle: string) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [OptionSwatch, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
			providers: [CurrencyPipe],
		});
		const fixture = TestBed.createComponent(OptionSwatch);
		fixture.componentRef.setInput('terms', terms);
		fixture.componentRef.setInput('displayStyle', displayStyle);
		fixture.componentRef.setInput('selected', 'boat');
		fixture.detectChanges();
		return { host: fixture.nativeElement as HTMLElement, swatch: fixture.componentInstance };
	};

	it('draws picture rows with a picture, the name and the price, the chosen one ticked', () => {
		const { host } = draw('picture_row');
		const list = host.querySelector('.st-look-list');
		expect(list?.classList.contains('st-look-rows')).toBe(true);
		const items = [...host.querySelectorAll('.st-look')];
		expect(items).toHaveLength(3);
		expect(items.every((item) => item.querySelector('img.st-look-pic'))).toBe(true);
		expect(items.map((item) => item.querySelectorAll('.st-look-note').length)).toEqual([1, 1, 1]);
		expect(items[1]?.classList.contains('is-on')).toBe(true);
		expect(items[1]?.getAttribute('aria-pressed')).toBe('true');
		expect(items[1]?.querySelector('.st-look-check')).not.toBeNull();
		expect(items[0]?.querySelector('.st-look-check')).toBeNull();
	});

	it('draws picture chips and colour chips with a price only where one is added', () => {
		const chips = draw('picture_chip').host;
		expect(chips.querySelector('.st-look-rows, .st-look-sizes')).toBeNull();
		expect(
			[...chips.querySelectorAll('.st-look')].map((item) => item.querySelectorAll('.st-look-note').length),
		).toEqual([0, 1, 0]);
		const colours = draw('colour_chip').host;
		expect(colours.querySelector('img')).toBeNull();
		const dots = [...colours.querySelectorAll<HTMLElement>('.st-look-dot')];
		expect(dots.map((dot) => dot.style.backgroundColor)).toEqual(['', 'rgb(170, 0, 0)', '']);
	});

	it('draws Size V2 boxes with the second line and no picture', () => {
		const { host } = draw('size_v2');
		expect(host.querySelector('.st-look-list')?.classList.contains('st-look-sizes')).toBe(true);
		expect(host.querySelector('img')).toBeNull();
		const last = [...host.querySelectorAll('.st-look')].at(-1);
		expect(last?.querySelector('.st-look-name')?.textContent?.trim()).toBe('M');
		expect(last?.querySelector('.st-look-note')?.textContent?.trim()).toBe('Medium');
	});

	it('chooses a value on a tap', () => {
		const { host, swatch } = draw('picture_chip');
		const seen: string[] = [];
		swatch.selectedChange.subscribe((code) => seen.push(code));
		host.querySelectorAll<HTMLButtonElement>('.st-look')[0]?.click();
		expect(seen).toEqual(['none']);
	});

	it('folds a long picture-row list to three rows on smaller screens, keeping the chosen one (HX-3)', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [OptionSwatch, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
			providers: [CurrencyPipe],
		});
		const fixture = TestBed.createComponent(OptionSwatch);
		const terms = Array.from({ length: 6 }, (_, at) => ({
			code: `t${at}`,
			label: `T${at}`,
			price_delta: at === 0 ? 0 : 750,
		}));
		fixture.componentRef.setInput('terms', terms);
		fixture.componentRef.setInput('displayStyle', 'picture_row');
		fixture.componentRef.setInput('selected', 't5');
		fixture.detectChanges();
		const el: HTMLElement = fixture.nativeElement;
		const folded = [...el.querySelectorAll('.st-look-rows > li')].map((li) =>
			li.classList.contains('st-look-more'),
		);
		expect(folded).toEqual([false, false, false, true, true, false]);
		expect(el.querySelector('.st-look-all')).not.toBeNull();
		fixture.componentInstance.expanded.set(true);
		fixture.detectChanges();
		expect(el.querySelector('.st-look-rows')?.classList).toContain('is-open');
		expect(el.querySelector('.st-look-all')).toBeNull();
	});
});
