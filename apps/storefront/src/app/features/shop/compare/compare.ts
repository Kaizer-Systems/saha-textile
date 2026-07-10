import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { CompareService } from '@data-access/services/compare.service';
import { CompareFacade } from '@core/state/compare/compare.store';

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
  private compareFacade = inject(CompareFacade);
  compareService = inject(CompareService);

  public breadcrumb: IBreadcrumb = {
    title: 'Compare',
    items: [{ label: 'Compare', active: true }],
  };

  public skeletonItems = Array.from({ length: 3 }, (_, index) => index);

  compareItems$: Observable<IProduct[]> = this.compareFacade.compareItems$;

  constructor() {
    this.compareFacade.getCompare();
  }

  removeCompare(id: number) {
    this.compareFacade.deleteCompare(id);
  }
}
