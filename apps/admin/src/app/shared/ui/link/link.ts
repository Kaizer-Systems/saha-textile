import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, input, output } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2, Select2Data, Select2Module, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { Observable, Subject, debounceTime } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';

import { FormFields } from '../form-fields/form-fields';

@Component({
	selector: 'app-link',
	templateUrl: './link.html',
	styleUrls: ['./link.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [ReactiveFormsModule, FormFields, Select2Module, TranslocoModule],
})
export class Link {
	readonly linkForm = input<any>(undefined);
	readonly products = input<Select2Data>(undefined);

	readonly productFilter = output<Params>();

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ status: 1, type: 'product' }));
	categories$: Observable<Select2Data> = toObservable(
		computed(
			() =>
				this.categoriesQuery.data()?.data.map((res) => ({
					label: res?.name,
					value: res?.id,
					data: {
						name: res.name,
						slug: res.slug,
						image: res.category_icon ? res.category_icon.original_url : 'assets/images/category.png',
					},
				})) ?? [],
		),
	);

	private destroy$ = new Subject<void>();
	public categories: Select2Data;
	private search = new Subject<string>();
	public isBrowser: boolean;
	public filter = {
		search: '',
		paginate: 15,
		ids: '',
		with_union_products: false,
	};

	public linkOption = [
		{
			label: 'Product',
			value: 'product',
		},
		{
			label: 'Collection',
			value: 'collection',
		},
		{
			label: 'External Url',
			value: 'external_url',
		},
	];

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);
		this.categories = [];
		this.categories$.subscribe((categories) => {
			categories.forEach((category) => {
				this.categories?.push({
					label: category?.label,
					value: category?.data.slug,
					data: {
						name: category?.data.name,
						slug: category?.data.slug,
						image: category?.data.image ? category?.data.image : 'assets/images/product.png',
					},
				});
			});
		});
	}

	ngOnInit() {
		this.search
			.pipe(debounceTime(300)) // Adjust the debounce time as needed (in milliseconds)
			.subscribe((inputValue) => {
				this.filter['search'] = inputValue;
				this.productFilter.emit(this.filter);
			});
	}

	selectProduct(event: Select2UpdateEvent) {
		this.linkForm()?.get('product_ids')?.setValue(event?.value);
	}

	productDropdown(event: Select2) {
		if (event['innerSearchText']) {
			this.productFilter.emit(this.filter);
			this.search.next('');
		}
	}

	searchProduct(event: Select2SearchEvent) {
		this.search.next(event.search);
	}

	selectImageLink() {
		// this.linkForm.get('link').patchValue('');
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
