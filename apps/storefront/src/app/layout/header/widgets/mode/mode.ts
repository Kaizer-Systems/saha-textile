import { Component, inject, input } from '@angular/core';

import { TranslocoPipe } from '@jsverse/transloco';

import { ThemeModeStore } from '@core/brand/theme-mode';

/**
 * The shopper's light/dark switch, after the admin header's mode button. The icon shows the mode a
 * press gives: a moon while the shop is light, a sun while it is dark.
 */
@Component({
	selector: 'app-mode',
	templateUrl: './mode.html',
	imports: [TranslocoPipe],
})
export class Mode {
	readonly themeMode = inject(ThemeModeStore);
	/** In the top bar the icon is white, like Language and Currency; in the menu heading it is not. */
	readonly onTopBar = input(true);
}
