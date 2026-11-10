import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Shell } from './shell/shell';

@Component({
	selector: 'rc-root',
	imports: [Shell],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: '<rc-shell />',
})
export class App {}
