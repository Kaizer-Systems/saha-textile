import { Component, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Params } from '@data-access/interfaces/core.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

@Component({
	selector: 'app-collection-price-filter',
	templateUrl: './collection-price-filter.html',
	styleUrls: ['./collection-price-filter.scss'],
	providers: [CurrencySymbolPipe],
	imports: [CurrencySymbolPipe],
})
export class CollectionPriceFilter {
	private route = inject(ActivatedRoute);
	private router = inject(Router);

	readonly filter = input<Params>();

	public prices = [
		{
			id: 1,
			price: 100,
			text: 'Below',
			value: '100',
		},
		{
			id: 2,
			minPrice: 100,
			maxPrice: 200,
			value: '0-200',
		},
		{
			id: 3,
			minPrice: 200,
			maxPrice: 400,
			value: '200-400',
		},
		{
			id: 4,
			minPrice: 400,
			maxPrice: 600,
			value: '400-600',
		},
		{
			id: 5,
			minPrice: 600,
			maxPrice: 800,
			value: '600-800',
		},
		{
			id: 6,
			minPrice: 800,
			maxPrice: 1000,
			value: '800-1000',
		},
		{
			id: 7,
			price: 1000,
			text: 'Above',
			value: '1000',
		},
	];

	public selectedPrices: string[] = [];

	ngOnChanges() {
		const filter = this.filter();
		this.selectedPrices = filter!['price'] ? filter!['price'].split(',') : [];
	}

	applyFilter(event: Event) {
		const index = this.selectedPrices.indexOf((<HTMLInputElement>event?.target)?.value); // checked and unchecked value

		if ((<HTMLInputElement>event?.target)?.checked)
			this.selectedPrices.push((<HTMLInputElement>event?.target)?.value); // push in array cheked value
		else this.selectedPrices.splice(index, 1); // removed in array unchecked value

		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: {
				price: this.selectedPrices.length ? this.selectedPrices.join(',') : null,
			},
			queryParamsHandling: 'merge', // preserve the existing query params in the route
			skipLocationChange: false, // do trigger navigation
		});
	}

	// check if the item are selected
	checked(item: string) {
		if (this.selectedPrices?.indexOf(item) != -1) {
			return true;
		}
		return false;
	}
}
