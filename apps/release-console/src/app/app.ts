import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

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
	}
}
