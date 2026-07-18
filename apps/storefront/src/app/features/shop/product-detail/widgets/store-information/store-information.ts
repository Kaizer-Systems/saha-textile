import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbRating } from '@ng-bootstrap/ng-bootstrap';

import { IStores } from '@data-access/interfaces/store.interface';
import { SummaryPipe } from '@shared/pipes/summary.pipe';

@Component({
	selector: 'app-store-information',
	templateUrl: './store-information.html',
	styleUrls: ['./store-information.scss'],
	imports: [RouterLink, NgbRating, SummaryPipe, TranslocoModule],
})
export class StoreInformation {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly store = input<IStores | null>();
}
