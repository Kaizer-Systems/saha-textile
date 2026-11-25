import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { VersionWatch } from './data/version-watch';
import { warmIcons } from './shared/icons';

@Component({
	selector: 'rc-root',
	imports: [RouterOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: '<router-outlet />',
})
export class App {
	constructor() {
		warmIcons();
		inject(VersionWatch).start();
	}
}
