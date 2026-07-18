import { AsyncPipe } from '@angular/common';
import { Component, DOCUMENT, effect, inject, Renderer2, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { CartActions } from '@core/state/cart/cart.actions';
import { selectCartItems, selectCartTotal } from '@core/state/cart/cart.selectors';
import { LoaderStore } from '@core/state/loader.store';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { Loader } from '@layout/loader/loader';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { ProductBoxSkeleton } from '@shared/ui/skeleton/product-box-skeleton/product-box-skeleton';

@Component({
	selector: 'app-create-order',
	templateUrl: './create-order.html',
	styleUrls: ['./create-order.scss'],
	imports: [
		Loader,
		CarouselModule,
		ReactiveFormsModule,
		FormsModule,
		AdvancedDropdown,
		ProductBoxSkeleton,
		ProductBox,
		Pagination,
		NoData,
		Button,
		HasPermissionDirective,
		RouterModule,
		TranslocoModule,
		CurrencySymbolPipe,
		AsyncPipe,
	],
})
export class CreateOrder {
	private store = inject(Store);
	private document = inject<Document>(DOCUMENT);
	private renderer = inject(Renderer2);

	readonly loader = inject(LoaderStore);

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);

	public filter = {
		search: '',
		field: '',
		sort: '', // current Sorting Order
		page: 1, // current page number
		paginate: 20, // Display per page,
		category_ids: '',
		status: 1,
	};

	private readonly params = signal<Params>({ ...this.filter });
	private readonly productsQuery = injectProductsQuery(() => this.params());
	product$: Observable<IProductModel | undefined> = toObservable(this.productsQuery.data);

	cartItem$: Observable<ICart[]> = this.store.select(selectCartItems);
	cartTotal$: Observable<number> = this.store.select(selectCartTotal);

	public skeletonItems = Array.from({ length: 8 }, (_, index) => index);
	public activeCategory: ICategory | null;
	public selectedCategory: Number[] = [];
	public totalItems: number = 0;

	public customOptions: OwlOptions = {
		loop: true,
		margin: 15,
		dots: false,
		navSpeed: 700,
		responsive: {
			0: {
				items: 1,
			},
			400: {
				items: 2,
			},
			740: {
				items: 3,
			},
			940: {
				items: 5,
			},
		},
		nav: true,
	};
	public term = new FormControl();
	public loading: boolean = true;

	constructor() {
		this.product$.subscribe((product) => (this.totalItems = product?.total!));
		effect(() => {
			this.loading = this.productsQuery.isFetching();
		});
		this.store.dispatch(CartActions.loadCart());

		this.term.valueChanges.pipe(debounceTime(400), distinctUntilChanged()).subscribe((data: string) => {
			this.filter.search = data;
			this.getProducts(this.filter);
		});
	}

	getProducts(filter: Params, loader?: boolean) {
		filter['status'] = 1;
		this.params.set({ ...filter });
		if (!loader) this.renderer.addClass(this.document.body, 'loader-none');
	}

	selectCategory(data: ICategory) {
		this.activeCategory = this.activeCategory?.id != data?.id ? data : null;
		this.selectedCategory = [];
		this.filter.category_ids = String(this.activeCategory ? this.activeCategory?.id! : '');
		this.getProducts(this.filter);
	}

	selectCategoryItem(data: Number[]) {
		this.activeCategory = null;
		this.filter.category_ids = data.join();
		this.getProducts(this.filter);
	}

	updateQuantity(item: ICart, qty: number) {
		this.renderer.addClass(this.document.body, 'loader-none');
		const params: ICartAddOrUpdate = {
			id: item?.id,
			product_id: item?.product?.id!,
			product: item?.product,
			variation: item?.variation,
			variation_id: item?.variation_id ? item?.variation_id : null,
			quantity: qty,
		};
		this.store.dispatch(CartActions.updateCart({ payload: params }));
	}

	setPaginate(data: number) {
		this.filter.page = data;
		this.getProducts(this.filter);
	}

	ngOnDestroy() {
		this.renderer.removeClass(this.document.body, 'loader-none');
	}
}
