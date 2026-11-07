import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

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
