import { isPlatformBrowser } from '@angular/common';
import { Component, SimpleChanges, PLATFORM_ID, inject, output, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Select2Data, Select2UpdateEvent, Select2 } from 'ng-select2-component';

import { Params } from '@data-access/interfaces/core.interface';
import { AttributeService } from '@data-access/services/attribute.service';

@Component({
	selector: 'app-collection-sort',
	templateUrl: './collection-sort.html',
	styleUrls: ['./collection-sort.scss'],
	imports: [Select2, TranslocoModule],
})
export class CollectionSort {
	private route = inject(ActivatedRoute);
	private attributeService = inject(AttributeService);
	private router = inject(Router);
	private platformId = inject<Object>(PLATFORM_ID);
	private transloco = inject(TranslocoService);

	readonly filter = input<Params>();
	readonly gridCol = input<string>();

	readonly setGridClass = output<string>();
	readonly showFilter = output<boolean>();

	public isBrowser: boolean;

	public sorting: Select2Data = [
		{
			value: 'asc',
			label: 'sort_ascending',
		},
		{
			value: 'desc',
			label: 'sort_descending',
		},
		{
			value: 'low-high',
			label: 'sort_price_low_high',
		},
		{
			value: 'high-low',
			label: 'sort_price_high_low',
		},
		{
			value: 'a-z',
			label: 'sort_name_a_z',
		},
		{
			value: 'z-a',
			label: 'sort_name_z_a',
		},
		{
			value: 'discount-high-low',
			label: 'sort_discount_high_low',
		},
	];

	/**
	 * The sort labels above are translation keys; select2 renders `label` as plain text, so
	 * they are resolved here. Re-emits once the active language's dictionary has loaded.
	 */
	public readonly sortOptions = toSignal(
		this.transloco
			.selectTranslation()
			.pipe(
				map(() =>
					this.sorting.map((option) =>
						'label' in option ? { ...option, label: this.transloco.translate(option.label) } : option,
					),
				),
			),
		{ initialValue: [] as Select2Data },
	);

	public selectedGrid: string = 'collection_4_grid';
	public class: string =
		'row g-sm-4 g-3 row-cols-xxl-4 row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2 product-list-section';
	public gridArray = ['collection_3_grid', 'collection_4_grid', 'collection_5_grid', 'collection_list_view'];
	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.setGridClass.emit(this.class);
	}

	ngOnChanges(changes: SimpleChanges) {
		let layout = changes['filter']?.currentValue.layout;
		let gridCol = changes['gridCol']?.currentValue;
		if (this.gridArray.includes(gridCol)) {
			this.selectedGrid = String(this.grid(gridCol));
		}

		if (this.gridArray.includes(layout)) {
			this.grid(layout);
		}
	}

	grid(value: string) {
		if (this.gridArray.includes(value)) {
			if (value == 'collection_3_grid')
				this.class = 'row g-sm-4 g-3 product-list-section row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2';
			else if (value == 'collection_4_grid')
				this.class =
					'row g-sm-4 g-3 product-list-section row-cols-xxl-4 row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2';
			else if (value == 'collection_5_grid')
				this.class = 'row g-sm-4 g-3 product-list-section row-cols-xl-5 row-cols-lg-4 row-cols-md-3 row-cols-2';
			else if (value == 'collection_list_view')
				this.class =
					'row g-sm-4 g-3 product-list-section row-cols-xxl-4 row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2 list-style';

			this.selectedGrid = value;
			this.setGridClass.emit(this.class);
		}
	}

	// SortBy Filter
	sortByFilter(data: Select2UpdateEvent) {
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: {
				sortBy: data && data.value ? data.value : null,
				field: data && (data.value == 'asc' || data.value == 'desc') ? 'created_at' : null,
			},
			queryParamsHandling: 'merge', // preserve the existing query params in the route
			skipLocationChange: false, // do trigger navigation
		});
	}

	openOffCanvasMenu() {
		this.attributeService.offCanvasMenu = true;
	}

	openFilter(value: boolean) {
		this.attributeService.offCanvasMenu = value;
	}
}
