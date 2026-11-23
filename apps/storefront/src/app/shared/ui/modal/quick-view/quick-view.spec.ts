import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { SiteConfigStore } from '@core/state/site-config.store';

import { QUICK_VIEW_OPTIONS, QuickView } from './quick-view';

const query = { data: signal<unknown>(undefined), isError: signal(false) };
const asked = vi.hoisted(() => ({
	slug: null as null | (() => string | undefined),
	fallback: null as null | (() => unknown),
}));
vi.mock('@data-access/queries/product.queries', () => ({
	injectProductBySlugQuery: (slug: () => string | undefined, fallback: () => unknown) => {
		asked.slug = slug;
		asked.fallback = fallback;
		return query;
	},
}));

describe('QuickView', () => {
	it('asks for the product by the slug the card sets, and shows it once it arrives', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: {} },
				{ provide: SiteConfigStore, useValue: { siteConfig: signal({ general: {} }) } },
			],
		});
		TestBed.overrideComponent(QuickView, { set: { imports: [], template: '' } });
		const view = TestBed.createComponent(QuickView).componentInstance;
		expect(asked.slug?.()).toBeUndefined();
		expect(asked.fallback?.()).toBeNull();
		view.slug.set('red-saree');
		expect(asked.slug?.()).toBe('red-saree');
		expect(view.product()).toBeUndefined();
		expect(view.failed()).toBe(false);
		query.data.set({ slug: 'red-saree' });
		query.isError.set(true);
		expect(view.product()).toEqual({ slug: 'red-saree' });
		expect(view.failed()).toBe(true);
		expect(view.siteConfig()).toEqual({ general: {} });
	});

	it('opens centred, scrolling inside, sized by its window class', () => {
		expect(QUICK_VIEW_OPTIONS).toMatchObject({
			centered: true,
			scrollable: true,
			size: 'xl',
			windowClass: 'st-quick-view',
		});
	});
});
