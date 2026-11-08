import { NgClass, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { Component, HostListener, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { ICategory } from '@data-access/interfaces/category.interface';
import { IMenu } from '@data-access/interfaces/menu.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectHomeRailsQuery } from '@data-access/queries/product.queries';
import * as data from '@shared/data/menu';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';

@Component({
	selector: 'app-menu',
	templateUrl: './menu.html',
	styleUrls: ['./menu.scss'],
	imports: [NgTemplateOutlet, NgClass, RouterLink, ShopDatePipe, TranslocoModule],
})
export class Menu {
	private readonly blogsQuery = injectBlogsQuery(() => ({ paginate: 2 }));
	blog$: Observable<IBlogModel | undefined> = toObservable(computed(() => this.blogsQuery.data()));
	// Real taxonomy for the header nav. Reference data (staleTime Infinity), shared cache with the rest of the app.
	private readonly categoriesQuery = injectCategoriesQuery();

	private readonly railsQuery = injectHomeRailsQuery();

	// Real products for the demo menu's product links. The demo slugs left with the old catalogue.
	private readonly productSlugs = computed(() => {
		const rails = this.railsQuery.data();
		if (!rails) return [];
		const cards = [...rails.newArrivals, ...rails.bestsellers, ...rails.featured, ...rails.sale];
		return [...new Set(cards.map((card) => card.slug))];
	});

	/** Where the mega menu's picture leads. */
	readonly featuredProductPath = computed(() => {
		const [slug] = this.productSlugs();
		return slug ? `/product/${slug}` : '/collections';
	});

	// The static demo menu with the real Sarees / Dress Materials trees spliced in once the taxonomy
	// resolves. A signal, so the server renders those links rather than only the demo menu.
	readonly menu = computed<IMenu[]>(() => {
		const categories = this.categoriesQuery.data()?.data ?? [];
		const items = categories.length ? this.buildMenu(categories, this.isMobileView()) : data.menu;
		const newestPost = this.blogsQuery.data()?.data[0]?.slug;
		return this.withNewestPost(this.withRealProducts(items, this.productSlugs()), newestPost);
	});
	public blogs: IBlog[];

	// < xl (1200px) = the offcanvas is in use. The theme can't render multi-level collapsible menus there
	// (nested toggles are hidden + submenus force-open = a flat dump), so the offcanvas gets a SHALLOWER
	// tree (L1 → L2 links + "View all {L1}") while desktop keeps the full flyout. `isMobileView` drives
	// both the tree shape (menu) and the L1 routerLink null-on-mobile (template).
	private platformId = inject(PLATFORM_ID);
	public isMobileView = signal(false);

	@HostListener('window:resize')
	onResize() {
		if (!isPlatformBrowser(this.platformId)) return;
		this.isMobileView.set(window.innerWidth < 1200); // re-shapes the tree only across the xl breakpoint
	}

	constructor() {
		if (isPlatformBrowser(this.platformId)) {
			this.isMobileView.set(window.innerWidth < 1200);
		}

		this.blog$.subscribe((blog) => {
			if (blog && blog.data) {
				this.blogs = blog.data.slice(0, 2);
			}
		});
	}

	/** A copy of the menu whose "Blog details" link opens the newest live post, or the blog list. */
	private withNewestPost(items: IMenu[], slug: string | undefined): IMenu[] {
		const walk = (nodes: IMenu[]): IMenu[] =>
			nodes.map((node) => {
				const path = node.path === 'blog/' ? (slug ? `blog/${slug}` : 'blogs') : node.path;
				return { ...node, path, ...(node.children ? { children: walk(node.children) } : {}) };
			});
		return walk(items);
	}

	/** A copy of the menu whose `product/…` links each open a real product, in turn. */
	private withRealProducts(items: IMenu[], slugs: string[]): IMenu[] {
		if (slugs.length === 0) return items;
		let next = 0;
		const walk = (nodes: IMenu[]): IMenu[] =>
			nodes.map((node) => {
				const path = node.path?.startsWith('product/') ? `product/${slugs[next++ % slugs.length]}` : node.path;
				return { ...node, path, ...(node.children ? { children: walk(node.children) } : {}) };
			});
		return walk(items);
	}

	/**
	 * Build the header nav from the taxonomy DAG and splice the top-level branches in after Home.
	 * Tree is walked strictly by `parent_id` (= a node's CANONICAL parent), so multi-placement nodes
	 * (e.g. Cotton Chikankari, Georgette) appear once under their canonical branch; the server already
	 * canonicalises the extra-placement URLs. All demo sections are preserved verbatim.
	 * Desktop = full recursive flyout; mobile = L1 → L2 links + "View all {L1}" (theme can't nest deeper).
	 */
	private buildMenu(categories: ICategory[], isMobile: boolean): IMenu[] {
		const roots = categories.filter((category) => category.level === 1);
		const branches = roots.map((root) =>
			isMobile ? this.toMobileBranch(root, categories) : this.toMenuNode(root, categories),
		);
		const merged = [...data.menu];
		merged.splice(1, 0, ...branches); // right after Home
		return merged;
	}

	/** Desktop: a category → `sub` (flyout parent) when it has children, else a leaf `link`. Every level is clickable. */
	private toMenuNode(category: ICategory, categories: ICategory[]): IMenu {
		const children = categories.filter((candidate) => candidate.parent_id === category.id);
		const path = category.canonical_path ? `/collections/${category.canonical_path}` : undefined;
		if (children.length) {
			return {
				id: category.id,
				title: category.name,
				i18nTitle: false,
				type: 'sub',
				path,
				active: false,
				children: children.map((child) => this.toMenuNode(child, categories)),
			};
		}
		return { id: category.id, title: category.name, i18nTitle: false, type: 'link', path };
	}

	/**
	 * Offcanvas (mobile) branch: the single level of nesting the theme CAN render — L1 is a tap-to-expand
	 * `sub`, its direct children (L2) are plain `link`s, and "View all {L1}" is appended last. No L3+.
	 */
	private toMobileBranch(root: ICategory, categories: ICategory[]): IMenu {
		const rootPath = root.canonical_path ? `/collections/${root.canonical_path}` : undefined;
		const children: IMenu[] = categories
			.filter((candidate) => candidate.parent_id === root.id)
			.map((child) => ({
				id: child.id,
				title: child.name,
				i18nTitle: false,
				type: 'link',
				path: child.canonical_path ? `/collections/${child.canonical_path}` : undefined,
			}));
		if (rootPath) {
			children.push({
				title: 'view_all',
				titleParams: { name: root.name },
				type: 'link',
				path: rootPath,
			});
		}
		return {
			id: root.id,
			title: root.name,
			i18nTitle: false,
			type: 'sub',
			path: rootPath,
			active: false,
			children,
		};
	}

	toggle(menu: IMenu) {
		if (!menu.active) {
			const items = this.menu();
			items.forEach((item) => {
				if (items.includes(menu)) {
					item.active = false;
				}
			});
		}
		menu.active = !menu.active;
	}
}
