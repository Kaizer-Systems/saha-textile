import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CompareStore } from '@core/state/compare/compare.store';

/** The theme's floating Compare button: the real count, hidden while the list is empty. */
@Component({
	selector: 'app-sticky-compare',
	templateUrl: './sticky-compare.html',
	styleUrls: ['./sticky-compare.scss'],
	imports: [RouterLink, TranslocoModule],
})
export class StickyCompare {
	readonly compare = inject(CompareStore);
}
