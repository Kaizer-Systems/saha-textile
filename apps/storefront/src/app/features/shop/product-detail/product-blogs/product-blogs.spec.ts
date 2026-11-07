import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductBlogs } from './product-blogs';

const data = signal<unknown>(undefined);
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: (params: () => unknown) => {
		params();
		return { data };
	},
}));

const render = (product?: unknown) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(ProductBlogs, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductBlogs);
	if (product) fixture.componentRef.setInput('product', product);
	return fixture.componentInstance;
};

afterEach(() => data.set(undefined));

describe('ProductBlogs', () => {
	it('shows nothing without linked posts', () => {
		data.set({ data: [{ id: 1 }] });
		expect(render().blogs()).toEqual([]);
		expect(render({ related_blog_ids: [] }).blogs()).toEqual([]);
	});

	it('picks the linked posts from a list or a page of results', () => {
		const product = { related_blog_ids: [1] };
		data.set({ data: [{ id: 1 }, { id: 2 }] });
		expect(render(product).blogs()).toEqual([{ id: 1 }]);
		data.set([{ id: 1 }]);
		expect(render(product).blogs()).toEqual([{ id: 1 }]);
		data.set(undefined);
		expect(render(product).blogs()).toEqual([]);
		data.set({});
		expect(render(product).blogs()).toEqual([]);
	});
});
