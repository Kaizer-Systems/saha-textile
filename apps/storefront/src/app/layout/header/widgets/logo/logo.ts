import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ThemeModeStore } from '@core/brand/theme-mode';
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

	private readonly themeMode = inject(ThemeModeStore);

	readonly brand = computed(() => this.brandQuery.data());
	/** The dark logo and seal in dark mode, where the Brand Kit has them. */
	readonly logo = computed(() => this.themeMode.pick(this.brand()?.logo, this.brand()?.logoDark));
	readonly seal = computed(() => this.themeMode.pick(this.brand()?.seal, this.brand()?.sealDark));
}
