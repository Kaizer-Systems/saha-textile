import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { CompareFacade } from '@core/state/compare/compare.store';

@Component({
	selector: 'app-sticky-compare',
	templateUrl: './sticky-compare.html',
	styleUrls: ['./sticky-compare.scss'],
	imports: [RouterLink, AsyncPipe, TranslocoModule],
})
export class StickyCompare {
	private compareFacade = inject(CompareFacade);

	compareTotal$: Observable<number> = this.compareFacade.compareTotal$;

	constructor() {
		this.compareFacade.getCompare();
	}
}
