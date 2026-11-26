import { isPlatformBrowser } from '@angular/common';
import {
	Component,
	ElementRef,
	Injector,
	PLATFORM_ID,
	afterNextRender,
	computed,
	inject,
	signal,
	viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { EMPTY, catchError, map, of, switchMap, tap } from 'rxjs';

import { ConsentStore } from '@core/consent/consent.store';
import { rememberSearchProduct, rememberSearchTerm } from '@core/search/search-history';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectCatalogQuery } from '@data-access/queries/product.queries';
import { ProductService, type SearchPage } from '@data-access/services/product.service';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';
import { SearchSuggest } from '@shared/ui/search-suggest/search-suggest';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

export const SEARCH_PAGE_SIZE = 24;

const positivePage = (value: unknown): number => {
	const page = Number(value);
	return Number.isInteger(page) && page > 0 ? page : 1;
};

/**
 * The results page. The address is the source of truth: `?search=` and `?page=` decide what
 * shows, so typing then Enter, the button, a shared link and Back all land on the same results.
 */
@Component({
	selector: 'app-search',
	templateUrl: './search.html',
	styleUrls: ['./search.scss'],
	imports: [
		Breadcrumb,
		ReactiveFormsModule,
		Button,
		SkeletonProductBox,
		ProductBox,
		NoData,
		Pagination,
		SearchSuggest,
		TranslocoModule,
	],
})
export class Search {
	private productService = inject(ProductService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private consent = inject(ConsentStore);
	private injector = inject(Injector);
	private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

	public breadcrumb = translatedBreadcrumb('search');
	readonly pageSize = SEARCH_PAGE_SIZE;
	public search = new FormControl<string | null>('');
	public gridClass: string = 'row g-sm-4 g-3 row-cols-2 row-cols-md-3 cols-lg-4 row-cols-xxl-6 product-list-section';
	public skeletonItems = Array.from({ length: 12 }, (_, index) => index);

	private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

	/** The words and page in the address. */
	readonly term = signal('');
	readonly page = signal(1);
	readonly unavailable = signal(false);
	/** Results for the current words; null until they arrive. */
	private readonly results = signal<SearchPage | null>(null);

	/** With no words the page lists the catalogue, a page at a time. */
	private readonly productsQuery = injectCatalogQuery(
		() => ({ page: this.page(), paginate: SEARCH_PAGE_SIZE, status: 1 }),
		() => !this.term(),
	);

	readonly products = computed<IProduct[]>(() =>
		this.term() ? (this.results()?.items ?? []) : (this.productsQuery.data()?.data ?? []),
	);
	readonly total = computed(() =>
		this.term() ? (this.results()?.total ?? 0) : (this.productsQuery.data()?.total ?? 0),
	);
	readonly loading = computed(() => (this.term() ? this.results() === null : this.productsQuery.isFetching()));

	constructor() {
		this.route.queryParams
			.pipe(
				map((params) => ({
					term: String(params['search'] ?? '').trim(),
					page: positivePage(params['page']),
					// Back and Forward return to a search already counted.
					counted: this.router.currentNavigation?.()?.trigger !== 'popstate',
				})),
				tap(({ term, page }) => {
					this.search.setValue(term, { emitEvent: false });
					this.term.set(term);
					this.page.set(page);
					this.results.set(null);
					this.unavailable.set(false);
				}),
				// switchMap drops an older answer that lands after a newer search.
				switchMap(({ term, page, counted }) =>
					// In the browser only: on the server every shopper would share one rate-limit address.
					term && this.browser
						? this.productService
								.search(term, {
									page,
									pageSize: SEARCH_PAGE_SIZE,
									source: counted ? 'page' : 'typeahead',
								})
								.pipe(
									catchError(() => {
										this.unavailable.set(true);
										return of<SearchPage>({ items: [], total: 0 });
									}),
								)
						: EMPTY,
				),
				takeUntilDestroyed(),
			)
			.subscribe((page) => this.results.set(page));

		// Arriving with nothing to look for (the phone's Search tab), the field is ready to type.
		afterNextRender(() => {
			if (!this.term()) this.field()?.nativeElement.focus({ preventScroll: true });
		});
	}

	/** Enter, the button, "See all" or a recent search. New words start again at page 1. */
	searchProduct(words?: string) {
		const term = (words ?? this.search.value ?? '').replace(/\s+/g, ' ').trim();
		if (term && this.browser && this.consent.allows('functional')) rememberSearchTerm(window.localStorage, term);
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: { search: term || null, page: null },
		});
	}

	setPage(page: number) {
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: { page: page > 1 ? page : null },
			queryParamsHandling: 'merge',
		});
		if (this.browser) afterNextRender(() => window.scrollTo({ top: 0 }), { injector: this.injector });
	}

	/** A product opened from the results counts towards Trending and the shopper's own list. */
	openedFromResults(event: Event, product: IProduct) {
		const link = (event.target as Element | null)?.closest?.('a[href*="/product/"]');
		const term = this.term();
		if (!link || !term) return;
		this.productService.searchClick(term, product.id);
		if (this.browser && this.consent.allows('functional')) rememberSearchProduct(window.localStorage, product.slug);
	}
}
