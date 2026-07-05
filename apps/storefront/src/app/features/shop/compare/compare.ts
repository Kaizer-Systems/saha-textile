import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { DeleteCompareAction, GetCompareAction } from '@data-access/actions/compare.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { CompareService } from '@data-access/services/compare.service';
import { CompareState } from '@data-access/states/compare.state';

@Component({
  selector: 'app-compeer',
  templateUrl: './compare.html',
  styleUrls: ['./compare.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    Breadcrumb,
    NgbRating,
    NoData,
    AsyncPipe,
    TitleCasePipe,
    CurrencySymbolPipe,
    TranslateModule,
  ],
})
export class Compare {
  private store = inject(Store);
  compareService = inject(CompareService);

  public breadcrumb: IBreadcrumb = {
    title: 'Compare',
    items: [{ label: 'Compare', active: true }],
  };

  public skeletonItems = Array.from({ length: 3 }, (_, index) => index);

  compareItems$: Observable<IProduct[]> = inject(Store).select(CompareState.compareItems);

  constructor() {
    this.store.dispatch(new GetCompareAction());
  }

  removeCompare(id: number) {
    this.store.dispatch(new DeleteCompareAction(id));
  }
}
