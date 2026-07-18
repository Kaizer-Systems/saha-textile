import { Component, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { IAttribute } from '@data-access/interfaces/attribute.interface';
import { Params } from '@data-access/interfaces/core.interface';

@Component({
	selector: 'app-collection-attributes-filter',
	imports: [],
	templateUrl: './collection-attributes-filter.html',
	styleUrls: ['./collection-attributes-filter.scss'],
})
export class CollectionAttributes {
	private route = inject(ActivatedRoute);
	private router = inject(Router);

	readonly attribute = input<IAttribute>();

	readonly filter = input<Params>();

	public selectedAttributes: string[] = [];

	ngOnChanges() {
		const filter = this.filter();
		this.selectedAttributes = filter!['attribute'] ? filter!['attribute'].split(',') : [];
	}

	applyFilter(event: Event) {
		const index = this.selectedAttributes.indexOf((<HTMLInputElement>event?.target)?.value); // checked and unchecked value

		if ((<HTMLInputElement>event?.target)?.checked)
			this.selectedAttributes.push((<HTMLInputElement>event?.target)?.value); // push in array checked value
		else this.selectedAttributes.splice(index, 1); // removed in array unchecked value

		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: {
				attribute: this.selectedAttributes.length ? this.selectedAttributes.join(',') : null,
			},
			queryParamsHandling: 'merge', // preserve the existing query params in the route
			skipLocationChange: false, // do trigger navigation
		});
	}

	// check if the item are selected
	checked(item: string) {
		if (this.selectedAttributes?.indexOf(item) != -1) {
			return true;
		}
		return false;
	}
}
