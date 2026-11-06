import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { ProductService } from '@data-access/services/product.service';

import { Product } from './product';

const render = () => {
	const service = { skeletonLoader: false };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: ProductService, useValue: service }] });
	TestBed.overrideComponent(Product, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Product);
	return { fixture, rail: fixture.componentInstance, service };
};

describe('Theme product rail', () => {
	it('shows the skeleton while loading', () => {
		const { fixture, service } = render();
		fixture.componentRef.setInput('loading', true);
		TestBed.tick();
		expect(service.skeletonLoader).toBe(true);
	});

	it('shows the supplied cards, or none', () => {
		const { fixture, rail, service } = render();
		TestBed.tick();
		expect(rail.products).toEqual([]);
		fixture.componentRef.setInput('supplied', [{ id: 1 }]);
		TestBed.tick();
		expect(rail.products).toEqual([{ id: 1 }]);
		expect(service.skeletonLoader).toBe(false);
	});

	it('loads only the first image eagerly on the first rail', () => {
		const { fixture, rail } = render();
		expect(rail.priority(0)).toBe('lazy');
		fixture.componentRef.setInput('fold', 'first');
		expect(rail.priority(0)).toBe('high');
		expect(rail.priority(1)).toBe('low');
	});
});
