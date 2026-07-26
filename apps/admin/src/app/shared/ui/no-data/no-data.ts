import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

@Component({
	selector: 'app-no-data',
	templateUrl: './no-data.html',
	styleUrls: ['./no-data.scss'],
	imports: [TranslocoModule],
})
export class NoData {
	readonly class = input<string>('no-data-added');
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly image = input<string | undefined>();
	readonly text = input<string | undefined>();
}
