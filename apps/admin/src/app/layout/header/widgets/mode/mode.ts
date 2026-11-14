import { Component, inject } from '@angular/core';

import { TranslocoPipe } from '@jsverse/transloco';

import { ThemeModeStore } from '@core/brand/theme-mode';

/** The header's light/dark switch: the moon in light mode, the sun in dark mode. */
@Component({
	selector: 'app-mode',
	templateUrl: './mode.html',
	imports: [TranslocoPipe],
	styleUrls: ['./mode.scss'],
	standalone: true,
})
export class Mode {
	readonly themeMode = inject(ThemeModeStore);
}
