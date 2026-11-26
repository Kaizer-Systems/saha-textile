import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { VersionWatch } from './data/version-watch';
import { warmIcons } from './shared/icons';
import { TipLayer } from './shared/tip-layer';

@Component({
	selector: 'rc-root',
	imports: [RouterOutlet, TipLayer],
	changeDetection: ChangeDetectionStrategy.OnPush,
	// One box for every hover name, above the page (owner, 26 Nov).
	template: '<router-outlet /><rc-tip-layer />',
})
export class App {
	constructor() {
		warmIcons();
		inject(VersionWatch).start();
	}
}
