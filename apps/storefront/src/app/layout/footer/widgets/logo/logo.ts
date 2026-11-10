import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ThemeModeStore } from '@core/brand/theme-mode';
import { injectBrandQuery } from '@data-access/queries/brand.queries';

/**
 * The footer is dark, so the light logo sits on a white plate and keeps its own colours. In dark
 * mode the Brand Kit's dark logo, where set, is drawn without the plate.
 */
@Component({
	selector: 'app-footer-logo',
	templateUrl: './logo.html',
	styleUrls: ['./logo.scss'],
	imports: [RouterLink],
})
export class FooterLogo {
	private readonly brandQuery = injectBrandQuery();

	private readonly themeMode = inject(ThemeModeStore);

	readonly brand = computed(() => this.brandQuery.data());
	readonly logo = computed(() => this.themeMode.pick(this.brand()?.logo, this.brand()?.logoDark));
	/** True when the dark logo is shown, which needs no white plate. */
	readonly darkLogo = computed(() => this.themeMode.dark() && !!this.brand()?.logoDark);
}
