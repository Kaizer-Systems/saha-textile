import { Component, inject, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { LoaderStore } from '@core/state/loader.store';
import { Loader } from '@layout/loader/loader';

@Component({
	selector: 'app-page-wrapper',
	templateUrl: './page-wrapper.html',
	styleUrls: ['./page-wrapper.scss'],
	imports: [Loader, TranslocoModule],
})
export class PageWrapper {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	public readonly title = input<string | undefined>();
	public readonly grid = input<boolean>(true);
	public readonly gridClass = input<string>('col-xxl-8 col-xl-10 m-auto');

	readonly loader = inject(LoaderStore);
}
