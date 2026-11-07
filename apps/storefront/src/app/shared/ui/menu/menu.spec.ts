import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Menu } from './menu';

const blogs = signal<unknown>(undefined);
const categories = signal<unknown>(undefined);
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: (params: () => unknown) => {
		params();
		return { data: blogs };
	},
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: () => ({ data: categories }),
}));

const tree = {
	data: [
		{ id: 1, name: 'Sarees', level: 1, canonical_path: 'sarees' },
		{ id: 2, name: 'Silk', level: 2, parent_id: 1, canonical_path: 'sarees/silk' },
		{ id: 3, name: 'Banarasi', level: 3, parent_id: 2 },
		{ id: 4, name: 'Loose', level: 1 },
		{ id: 5, name: 'Unlinked', level: 2, parent_id: 4 },
	],
};

const render = (platform = 'browser') => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	TestBed.overrideComponent(Menu, { set: { imports: [], template: '' } });
	const menu = TestBed.createComponent(Menu).componentInstance;
	TestBed.tick();
	return menu;
};
const width = (value: number) => vi.stubGlobal('innerWidth', value);

afterEach(() => {
	blogs.set(undefined);
	categories.set(undefined);
	vi.unstubAllGlobals();
});

describe('Menu', () => {
	it('keeps the demo menu until the taxonomy arrives', () => {
		const menu = render();
		const before = menu.menu().length;
		categories.set({ data: [] });
		expect(menu.menu()).toHaveLength(before);
	});

	it('splices the full tree after Home on a desktop', () => {
		width(1400);
		categories.set(tree);
		const [, sarees, loose] = render().menu();
		expect(sarees).toMatchObject({
			title: 'Sarees',
			type: 'sub',
			path: '/collections/sarees',
			children: [
				{
					title: 'Silk',
					type: 'sub',
					path: '/collections/sarees/silk',
					children: [{ title: 'Banarasi', type: 'link', path: undefined }],
				},
			],
		});
		expect(loose).toMatchObject({ title: 'Loose', path: undefined });
	});

	it('uses the shallow tree on a phone, with View all', () => {
		width(400);
		categories.set(tree);
		const [, sarees, loose] = render().menu();
		expect(sarees?.children).toEqual([
			{ id: 2, title: 'Silk', i18nTitle: false, type: 'link', path: '/collections/sarees/silk' },
			{ title: 'view_all', titleParams: { name: 'Sarees' }, type: 'link', path: '/collections/sarees' },
		]);
		expect(loose?.children).toEqual([
			{ id: 5, title: 'Unlinked', i18nTitle: false, type: 'link', path: undefined },
		]);
	});

	it('follows the window across the breakpoint in the browser only', () => {
		width(1400);
		const menu = render();
		width(400);
		menu.onResize();
		expect(menu.isMobileView()).toBe(true);
		const server = render('server');
		expect(server.isMobileView()).toBe(false);
		server.onResize();
		expect(server.isMobileView()).toBe(false);
	});

	it('keeps two posts for the mega menu', () => {
		const menu = render();
		expect(menu.blogs).toBeUndefined();
		blogs.set({});
		TestBed.tick();
		expect(menu.blogs).toBeUndefined();
		blogs.set({ data: [{ id: 1 }, { id: 2 }, { id: 3 }] });
		TestBed.tick();
		expect(menu.blogs).toHaveLength(2);
	});

	it('opens one item and closes the others', () => {
		width(1400);
		categories.set(tree);
		const menu = render();
		const [first, second] = menu.menu();
		first!.active = true;
		menu.toggle(second!);
		expect(first!.active).toBe(false);
		expect(second!.active).toBe(true);
		menu.toggle(second!);
		expect(second!.active).toBe(false);
	});

	it('does not close the others for an item outside the top level', () => {
		const menu = render();
		const [first] = menu.menu();
		first!.active = true;
		menu.toggle({ active: false } as never);
		expect(first!.active).toBe(true);
	});
});
