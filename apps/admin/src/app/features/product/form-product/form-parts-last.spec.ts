import { ElementRef, Renderer2, RendererFactory2, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { DRAFT_MARKS, DraftMarkDirective } from './draft-mark';
import { flattenSnapshot } from './product-draft-state';
import { productExceptions } from './shipping-tab';

import type { ProductFormSnapshot } from './product-draft-state';
import type { ShippingException } from '@saha-textile/contracts';

/** The directive built straight in an injector, so its host can be a detached element. */
function mark(marks: unknown, host: HTMLElement) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ElementRef, useValue: new ElementRef(host) },
			{ provide: Renderer2, useFactory: () => inject(RendererFactory2).createRenderer(null, null) },
			...(marks ? [{ provide: DRAFT_MARKS, useValue: marks }] : []),
		],
	});
	return TestBed.runInInjectionContext(() => new DraftMarkDirective());
}

describe('product form parts: the last cases', () => {
	it('flattens a snapshot with no text, and a text field with no languages', () => {
		const bare = flattenSnapshot({ v: 1, raw: { sku: 'S1' }, state: {} } as unknown as ProductFormSnapshot);
		expect([...bare.keys()]).toEqual(['raw.sku']);
		const empty = flattenSnapshot({
			v: 1,
			raw: {},
			text: { name: null },
			state: {},
		} as unknown as ProductFormSnapshot);
		expect(empty.size).toBe(0);
	});

	it('a field outside a draft shows nothing, and one without a control or a parent shows its note unplaced', () => {
		const plain = document.createElement('input');
		mark(null, plain);
		TestBed.tick();
		expect(plain.classList.contains('border-warning')).toBe(false);
		const wasFor = vi.fn(() => 'was: Red');
		const detached = document.createElement('input');
		mark({ wasFor }, detached);
		TestBed.tick();
		expect(wasFor).toHaveBeenCalledWith(null);
		expect(detached.classList.contains('border-warning')).toBe(true);
		expect(detached.nextSibling).toBeNull();
	});

	it('asks the exception rules for a product with no id and no category', () => {
		const exceptions: ShippingException[] = [
			{
				id: 'ex-1',
				target: { kind: 'category', categoryId: 'sarees', includeSubcategories: true },
				domestic: { kind: 'free' },
				international: { kind: 'siteWide' },
				note: '',
				updatedBy: null,
			},
		];
		const settings = {
			domestic: { kind: 'ruleSet' as const, ruleSetId: 'rs-dom' },
			international: { kind: 'ruleSet' as const, ruleSetId: 'rs-int' },
			abroadPolicy: 'indiaOnly' as const,
		};
		expect(productExceptions(null, [], settings, exceptions)).toEqual([]);
	});
});
