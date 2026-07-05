import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetUserTransactionAction } from '@data-access/actions/point.action';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IPoint } from '@data-access/interfaces/point.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { PointState } from '@data-access/states/point.state';
import { SettingState } from '@data-access/states/setting.state';

@Component({
  selector: 'app-point',
  templateUrl: './point.html',
  styleUrls: ['./point.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    Pagination,
    NoData,
    AsyncPipe,
    DatePipe,
    TitleCasePipe,
    CurrencySymbolPipe,
    TranslateModule,
  ],
})
export class Point {
  private store = inject(Store);

  setting$: Observable<IValues> = inject(Store).select(SettingState.setting) as Observable<IValues>;
  point$: Observable<IPoint> = inject(Store).select(PointState.point) as Observable<IPoint>;

  public filter: Params = {
    page: 1, // Current page number
    paginate: 10, // Display per page,
  };

  constructor() {
    this.store.dispatch(new GetUserTransactionAction(this.filter));
  }

  setPaginate(page: number) {
    this.filter['page'] = page;
    this.store.dispatch(new GetUserTransactionAction(this.filter));
  }
}
