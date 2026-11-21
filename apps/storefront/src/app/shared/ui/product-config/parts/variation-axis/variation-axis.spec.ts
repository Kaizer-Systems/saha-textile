import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { VariationAxis } from './variation-axis';

describe('VariationAxis', () => {
	const render = () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(VariationAxis, { set: { imports: [], template: '', providers: [] } });
		return TestBed.createComponent(VariationAxis).componentInstance;
	};

	it('shows the option table unless the host places it elsewhere', () => {
		expect(render().showTable()).toBe(true);
	});

	it('keeps the chosen option and tells the page', () => {
		const axis = render();
		const seen: unknown[] = [];
		axis.selectVariation.subscribe((value) => seen.push(value));
		const variation = { id: 7 } as never;
		axis.onSelect(variation);
		expect(axis.selectedVariation).toBe(variation);
		axis.onSelect(null);
		expect(seen).toEqual([variation, null]);
	});
});
