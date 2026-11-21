import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { SetSummary } from './set-summary';

describe('SetSummary', () => {
	const render = (inputs: Record<string, unknown>) => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(SetSummary, { set: { imports: [], template: '', providers: [] } });
		const fixture = TestBed.createComponent(SetSummary);
		for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
		return fixture.componentInstance;
	};
	const bundle = {
		bundle_price: 7300,
		components: [
			{ code: 'a', name: 'Peacock Blue', price: 35800, quantity: 1 },
			{ code: 'b', name: 'Off White', price: 6300, quantity: 2 },
			{ code: 'c', name: 'No count', price: 100, quantity: 0 },
		],
	};

	it('adds the pieces up and shows what the set saves', () => {
		const summary = render({ bundle });
		expect(summary.separately()).toBe(35800 + 12600 + 100);
		expect(summary.price()).toBe(7300);
		expect(summary.saving()).toBe(48500 - 7300);
	});

	it('uses the price with the chosen options, and never shows a negative saving', () => {
		const summary = render({ bundle, total: 60000 });
		expect(summary.price()).toBe(60000);
		expect(summary.saving()).toBe(0);
	});

	it('lets the browser pick a small photo file: card sizes first, then gallery sizes', () => {
		expect(render({ bundle }).srcset()).toBeNull();
		const gallery = { width: 900, height: 1200, roles: { gallery: [{ url: 'g600', width: 600 }] } };
		expect(render({ bundle, image: gallery }).srcset()).toBe('g600 600w');
		const card = { ...gallery, roles: { ...gallery.roles, card: [{ url: 'c200', width: 200 }] } };
		expect(render({ bundle, image: card }).srcset()).toBe('c200 200w');
	});
});
