import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetCompareAction } from '@data-access/actions/compare.action';
import { CompareState } from '@data-access/states/compare.state';

@Component({
  selector: 'app-sticky-compare',
  templateUrl: './sticky-compare.html',
  styleUrls: ['./sticky-compare.scss'],
  imports: [RouterLink, AsyncPipe, TranslateModule],
})
export class StickyCompare {
  private store = inject(Store);

  compareTotal$: Observable<number> = inject(Store).select(CompareState.compareTotal);

  constructor() {
    this.store.dispatch(new GetCompareAction());
  }
}
