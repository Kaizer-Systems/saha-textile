import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';

import { injectBrandQuery } from '@data-access/queries/brand.queries';

/** The full logo on wide screens and the seal on small ones, chosen by the browser, so nothing flickers. */
@Component({
	selector: 'app-logo',
	templateUrl: './logo.html',
	styleUrls: ['./logo.scss'],
	imports: [RouterLink],
})
export class Logo {
	private readonly brandQuery = injectBrandQuery();

	readonly brand = computed(() => this.brandQuery.data());
}
