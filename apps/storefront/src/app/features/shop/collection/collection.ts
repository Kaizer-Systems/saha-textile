import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';

import { combineLatest, Observable } from 'rxjs';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { injectCatalogQuery } from '@data-access/queries/product.queries';
import { AttributeService } from '@data-access/services/attribute.service';
import * as data from '@shared/data/owl-carousel';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';

import { CollectionCategories } from './widgets/collection-categories/collection-categories';
import { CollectionProducts } from './widgets/collection-products/collection-products';
import { CollectionSidebar } from './widgets/sidebar/sidebar';

@Component({
	selector: 'app-collection',
	templateUrl: './collection.html',
	styleUrls: ['./collection.scss'],
	imports: [Breadcrumb, CollectionCategories, CollectionSidebar, CollectionProducts],
})
export class Collection {
	private route = inject(ActivatedRoute);
	private transloco = inject(TranslocoService);
	/** The general page's name in the active language (the dictionary loads before first render). */
	private readonly collectionsLabel = this.transloco.translate('collections');
	attributeService = inject(AttributeService);

	public filter = signal<Params>({
		page: 1, // Current page number
		paginate: 25, // page size — server route slices to this; pagination UI derives page count from it
		status: 1,
		field: '',
		price: '',
		category: '',
		tag: '',
		sort: '', // ASC, DSC
		sortBy: '',
		rating: '',
		attribute: '',
	});

	private readonly productsQuery = injectCatalogQuery(() => this.filter());
	product$: Observable<ICatalogResponse | undefined> = toObservable(computed(() => this.productsQuery.data()));

	public breadcrumb = signal<IBreadcrumb>({
		title: this.collectionsLabel,
		items: [{ label: this.collectionsLabel, active: true }],
	});

	public categorySlider = data.categorySlider;
	public skeleton: boolean = true;

	private router = inject(Router);
	private meta = inject(Meta);
	private title = inject(Title);
	private seo = inject(LocaleSeo);

	constructor() {
		// Base category = the URL PATH after /collections/ (named-category pages,
		// catch-all `[...category]` → Angular `**`, no named param), filters/sort/page
		// from the query string. Path wins over any legacy `?category=`.
		combineLatest([this.route.url, this.route.queryParams]).subscribe(([, query]) => {
			const path = this.router.url
				.split('?')[0]
				.replace(/^\/collections\/?/, '')
				.replace(/\/$/, '');
			const categoryPath = decodeURIComponent(path) || (query['category'] as string) || '';
			const next: Params = {
				page: query['page'] ? query['page'] : 1,
				paginate: 25, // page size (see above)
				status: 1,
				field: query['field'] ? query['field'] : this.filter()['field'],
				price: query['price'] ? query['price'] : '',
				category: categoryPath,
				tag: query['tag'] ? query['tag'] : '',
				sort: query['sort'] ? query['sort'] : '',
				sortBy: query['sortBy'] ? query['sortBy'] : this.filter()['sortBy'],
				rating: query['rating'] ? query['rating'] : '',
				attribute: query['attribute'] ? query['attribute'] : '',
			};
			this.filter.set(next);
		});

		// SEO + breadcrumb are driven by the RESPONSE, which resolves the category to
		// its canonical identity (so an extra-placement URL canonicalises to the home
		// path) and returns the breadcrumb trail.
		this.product$.subscribe((res) => this.applySeo(res));
	}

	private applySeo(res: ICatalogResponse | undefined) {
		const cat = res?.category;
		const trail = res?.breadcrumb ?? [];

		// Title + breadcrumb from the resolved node (fall back to the general page).
		this.title.setTitle(`${cat?.name ?? this.collectionsLabel} | Saha Textile`);
		this.breadcrumb.set(
			trail.length
				? {
						title: cat?.name ?? this.collectionsLabel,
						items: trail.map((c, i) => ({
							label: c.name,
							url: `/collections/${c.path}`,
							active: i === trail.length - 1,
						})),
					}
				: { title: this.collectionsLabel, items: [{ label: this.collectionsLabel, active: true }] },
		);

		// Canonical = the node's CANONICAL path (not the current URL) so extra-placement
		// pages consolidate onto the home URL; clean category page otherwise. The language
		// alternates follow it. Without a response (still loading, or the catalogue failed)
		// the page keeps its own address rather than claiming to be the general page.
		if (res) this.seo.setCanonicalPath(`/collections${cat ? '/' + cat.canonical_path : ''}`);

		// Filtered / paged combinations are noindex,follow (protect crawl budget).
		const f = this.filter();
		const filtered = !!(f['attribute'] || f['price'] || f['rating'] || Number(f['page']) > 1);
		this.meta.updateTag({ name: 'robots', content: filtered ? 'noindex,follow' : 'index,follow' });
	}
}
