import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { SetSummary } from './set-summary';
import { setBundle, setItem, setLevel } from '../../set-test-data';

describe('SetSummary', () => {
	const render = (inputs: Record<string, unknown>) => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(SetSummary, { set: { imports: [], template: '', providers: [] } });
		const fixture = TestBed.createComponent(SetSummary);
		for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
		return fixture.componentInstance;
	};
	const bundle = setBundle(
		[
			setLevel('one', 1, [setItem('peacock', 35800)]),
			setLevel('two', 1, [setItem('offwhite', 6300, { quantity: 2 })]),
		],
		{ setPrice: 7300 },
	);

	it('adds the pieces up and shows what the set saves', () => {
		const summary = render({ bundle });
		expect(summary.lines().map((line) => [line.key, line.quantity, line.today])).toEqual([
			['peacock', 1, 35800],
			['offwhite', 2, 12600],
		]);
		expect(summary.separately()).toBe(35800 + 12600);
		expect(summary.price()).toBe(7300);
		expect(summary.saving()).toBe(48400 - 7300);
	});

	it('follows the picks and extras, and never shows a negative saving', () => {
		const choice = setBundle([setLevel('saree', 1, [setItem('a', 1000), setItem('b', 3000)])], { setPrice: 900 });
		choice.extras = [setItem('pc', 0, { today: 450 })];
		const summary = render({ bundle: choice, picks: { saree: ['b'] }, extras: ['pc'] });
		expect(summary.lines().map((line) => [line.key, line.extra, line.free])).toEqual([
			['b', false, false],
			['pc', true, true],
		]);
		expect(summary.price()).toBe(2900);
		expect(render({ bundle, total: 60000 }).saving()).toBe(0);
	});

	it('lets the browser pick a small photo file: card sizes first, then gallery sizes', () => {
		expect(render({ bundle }).srcset()).toBeNull();
		const gallery = { width: 900, height: 1200, roles: { gallery: [{ url: 'g600', width: 600 }] } };
		expect(render({ bundle, image: gallery }).srcset()).toBe('g600 600w');
	});
});
