import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';

import { injectBrandQuery } from '@data-access/queries/brand.queries';

/** The footer is dark, so the logo sits on a white plate and keeps its own colours. */
@Component({
	selector: 'app-footer-logo',
	templateUrl: './logo.html',
	styleUrls: ['./logo.scss'],
	imports: [RouterLink],
})
export class FooterLogo {
	private readonly brandQuery = injectBrandQuery();

	readonly brand = computed(() => this.brandQuery.data());
}
