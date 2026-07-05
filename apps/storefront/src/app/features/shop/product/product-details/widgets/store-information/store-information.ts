import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';

import { IStores } from '@data-access/interfaces/store.interface';
import { SummaryPipe } from '@shared/pipes/summary.pipe';

@Component({
  selector: 'app-store-information',
  templateUrl: './store-information.html',
  styleUrls: ['./store-information.scss'],
  imports: [RouterLink, NgbRating, SummaryPipe, TranslateModule],
})
export class StoreInformation {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly store = input<IStores | null>();
}
