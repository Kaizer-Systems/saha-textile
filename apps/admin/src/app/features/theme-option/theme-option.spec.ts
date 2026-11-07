import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeOptionService } from '@data-access/services/theme-option.service';

import { ThemeOption } from './theme-option';

const categories = signal<unknown>(undefined);
const products = signal<unknown>(undefined);
const blogs = signal<unknown>(undefined);
const params: unknown[] = [];

vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown) => (p(), { data: categories }),
}));
vi.mock('@data-access/queries/product.queries', () => ({
	injectProductsQuery: (p: () => unknown) => {
		params.push(p);
		return { data: products };
	},
}));
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: (p: () => unknown) => (p(), { data: blogs }),
}));

const options = (overrides: Record<string, unknown> = {}) => ({
	general: { site_title: 'Shop' },
	logo: { header_logo_id: 1 },
	seo: { meta_title: 'Meta' },
	header: { today_deals: [1, 2], top_bar_content: [{ content: 'Hi' }] },
	footer: {
		footer_categories: [3],
		useful_link: [{ id: 1 }],
		help_center: [{ id: 2 }],
	},
	blog: { blog_style: 'list_view' },
	seller: {
		about: { title: 'About' },
		services: { title: 'S', service_1: {}, service_2: {}, service_3: {}, service_4: {} },
		steps: { title: 'T', step_1: {}, step_2: {}, step_3: {} },
		start_selling: { title: 'Sell' },
	},
	about_us: {
		about: { futures: [{ icon: 'i', title: 'F' }] },
		clients: { content: [{ icon: 'i', title: 'C', description: 'D' }] },
		team: { members: [{ name: 'M', profile_image_url: 'p', designation: 'd', description: 'x' }] },
		testimonial: { reviews: [{ name: 'R', review: 'Good', designation: 'd', profile_image_url: 'p' }] },
		blog: { blog_ids: [1] },
	},
	contact_us: { detail_1: {}, detail_2: {}, detail_3: {}, detail_4: {} },
	collection: { collection_layout: 'x' },
	product: { product_layout: 'y' },
	...overrides,
});

const render = (option: unknown = options(), platform = 'browser') => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ThemeOptionService, useValue: { getThemeOption: () => of({ options: option }) } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(ThemeOption, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ThemeOption);
	fixture.detectChanges();
	TestBed.tick();
	return fixture.componentInstance;
};
const event = () => ({ preventDefault: vi.fn() }) as never;

afterEach(() => {
	for (const value of [categories, products, blogs]) value.set(undefined);
	params.length = 0;
});

describe('ThemeOption reading', () => {
	it('fills the form and every list', () => {
		const page = render();
		expect(page.form.value.general.site_title).toBe('Shop');
		expect(page.topBarContent.length).toBe(3);
		expect(page.futuresContent.at(0).value).toEqual({ icon: 'i', title: 'F' });
		expect(page.clientsContent.length).toBe(1);
		expect(page.members.at(0).value.name).toBe('M');
		expect(page.testimonials.at(0).value).toMatchObject({ title: 'R', review: 'Good' });
		expect(page.usefulLinks).toEqual([1]);
		expect(page.helpCenterIds).toEqual([2]);
		expect(page.selectedCategories).toEqual([3]);
		expect(page.editor).toBeDefined();
	});

	it('asks for a few deals together with others, and many on their own', () => {
		const few = render();
		expect(few.filter).toMatchObject({ paginate: 15, ids: '1,2', with_union_products: 1 });
		const ids = Array.from({ length: 16 }, (_, id) => id);
		const many = render(options({ header: { today_deals: ids } }));
		expect(many.filter).toMatchObject({ paginate: 16, with_union_products: 0 });
	});

	it('copes with nothing saved', () => {
		const page = render(null);
		expect(page.usefulLinks).toEqual([]);
		expect(page.helpCenterIds).toEqual([]);
		expect(page.futuresContent.length).toBe(0);
	});

	it('copes with sparse sections', () => {
		const page = render({ header: {} });
		expect(page.filter.ids).toBe('');
		expect(page.members.length).toBe(0);
	});

	it('skips the editor on the server', () => {
		expect(render(null, 'server').editor).toBeUndefined();
	});

	it('maps its lists with fallback images', async () => {
		const page = render();
		expect(await firstValueFrom(page.categories$)).toEqual([]);
		expect(await firstValueFrom(page.product$)).toEqual([]);
		expect(await firstValueFrom(page.blogs$)).toEqual([]);
		categories.set({
			data: [
				{ id: 1, name: 'A', slug: 'a', category_icon: { original_url: 'i.png' } },
				{ id: 2, name: 'B', slug: 'b' },
			],
		});
		products.set({
			data: [
				{ id: 1, name: 'A', slug: 'a', product_thumbnail: { original_url: 'p.png' } },
				{ id: 2, name: 'B', slug: 'b' },
			],
		});
		blogs.set({ data: [{ id: 1, title: 'T' }] });
		TestBed.tick();
		expect(await firstValueFrom(page.categories$)).toMatchObject([
			{ data: { image: 'i.png' } },
			{ data: { image: 'assets/images/category.png' } },
		]);
		expect(await firstValueFrom(page.product$)).toMatchObject([
			{ data: { image: 'p.png' } },
			{ data: { image: 'assets/images/product.png' } },
		]);
		expect(await firstValueFrom(page.blogs$)).toEqual([{ label: 'T', value: 1 }]);
		expect((params[0] as () => unknown)()).toMatchObject({ ids: '1,2' });
	});
});

describe('ThemeOption rows', () => {
	it('adds and removes each kind of row, stopping at empty', () => {
		const page = render(null);
		const rows = [
			[page.futuresContent, 'addFuture', 'removeFutures'],
			[page.clientsContent, 'addClientsContent', 'removeClient'],
			[page.members, 'addMember', 'removeMember'],
			[page.testimonials, 'reviews', 'removeProfile'],
		] as const;
		for (const [array, add, remove] of rows) {
			page[add](event());
			expect(array.length).toBe(1);
			page[remove](0);
			expect(array.length).toBe(0);
			page[remove](0);
			expect(array.length).toBe(0);
		}
	});

	it('stores row images and clears them', () => {
		const page = render();
		const pickers = [
			['selectFutures', page.futuresContent, 'icon'],
			['selectIcon', page.clientsContent, 'icon'],
			['selectMemberProfile', page.members, 'profile_image_url'],
			['selectReviewProfile', page.testimonials, 'profile_image_url'],
		] as const;
		for (const [method, array, control] of pickers) {
			page[method]('u.png', 0);
			expect(array.at(0).get(control)?.value).toBe('u.png');
			page[method]('', 0);
			expect(array.at(0).get(control)?.value).toBeNull();
		}
	});
});

describe('ThemeOption pickers', () => {
	it('stores single images, clears them and ignores lists', () => {
		const page = render();
		const pickers = [
			['selectHeaderLogo', 'logo.header_logo_id'],
			['selectFooterLogo', 'logo.footer_logo_id'],
			['selectFaviconIcon', 'logo.favicon_icon_id'],
			['selectOgImage', 'seo.og_image_id'],
		] as const;
		for (const [method, path] of pickers) {
			page[method]({ id: 4 } as never);
			expect(page.form.get(path)?.value).toBe(4);
			page[method]([] as never);
			expect(page.form.get(path)?.value).toBe(4);
			page[method](null as never);
			expect(page.form.get(path)?.value).toBeNull();
		}
	});

	it('stores seller and banner images', () => {
		const page = render();
		page.selectSellerImage('u.png', 'seller.about.image_url');
		expect(page.form.get('seller.about.image_url')?.value).toBe('u.png');
		page.selectSellerImage([] as never, 'seller.about.image_url');
		expect(page.form.get('seller.about.image_url')?.value).toBe('u.png');
		page.selectSellerImage('', 'seller.about.image_url');
		expect(page.form.get('seller.about.image_url')?.value).toBeNull();
		page.selectBanner('b.png', 'product.banner_image_url');
		expect(page.form.get('product.banner_image_url')?.value).toBe('b.png');
		page.selectBanner('', 'product.banner_image_url');
		expect(page.form.get('product.banner_image_url')?.value).toBeNull();
	});

	it('stores the footer lists, ignoring anything else', () => {
		const page = render();
		page.usefulLink([1]);
		expect(page.form.get('footer.useful_link')?.value).toEqual([expect.objectContaining({ id: 1 })]);
		page.helpCenter([1]);
		expect(page.form.get('footer.help_center')?.value).toEqual([expect.objectContaining({ id: 1 })]);
		page.selectCategoryItem([9] as never);
		expect(page.form.get('footer.footer_categories')?.value).toEqual([9]);
		page.usefulLink('x' as never);
		page.helpCenter('x' as never);
		page.selectCategoryItem('x' as never);
		expect(page.form.get('footer.footer_categories')?.value).toEqual([9]);
	});

	it('marks the form as touched when submitted', () => {
		const page = render();
		page.submit();
		expect(page.form.touched).toBe(true);
	});
});
