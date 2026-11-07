import { Component, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

@Component({
	selector: 'app-collection-price-filter',
	templateUrl: './collection-price-filter.html',
	styleUrls: ['./collection-price-filter.scss'],
	providers: [CurrencySymbolPipe],
	imports: [CurrencySymbolPipe, TranslocoModule],
})
export class CollectionPriceFilter {
	private route = inject(ActivatedRoute);
	private router = inject(Router);

	readonly filter = input<Params>();

	public prices = [
		{ id: 1, price: 1000, text: 'below', value: '0-1000' },
		{ id: 2, minPrice: 1000, maxPrice: 2500, value: '1000-2500' },
		{ id: 3, minPrice: 2500, maxPrice: 5000, value: '2500-5000' },
		{ id: 4, minPrice: 5000, maxPrice: 10000, value: '5000-10000' },
		{ id: 5, minPrice: 10000, maxPrice: 20000, value: '10000-20000' },
		{ id: 6, price: 20000, text: 'above', value: '20000-' },
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
