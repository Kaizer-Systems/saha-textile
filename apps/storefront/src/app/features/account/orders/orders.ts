import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetOrdersAction } from '@data-access/actions/order.action';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IOrderModel } from '@data-access/interfaces/order.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { OrderState } from '@data-access/states/order.state';

@Component({
  selector: 'app-orders',
  templateUrl: './orders.html',
  styleUrls: ['./orders.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    RouterLink,
    Pagination,
    NoData,
    AsyncPipe,
    DatePipe,
    TitleCasePipe,
    CurrencySymbolPipe,
    TranslateModule,
  ],
})
export class Orders {
  private store = inject(Store);

  order$: Observable<IOrderModel> = inject(Store).select(
    OrderState.order,
  ) as Observable<IOrderModel>;

  public filter: Params = {
    page: 1, // Current page number
    paginate: 10, // Display per page,
  };

  constructor() {
    this.store.dispatch(new GetOrdersAction(this.filter));
  }

  setPaginate(page: number) {
    this.filter['page'] = page;
    this.store.dispatch(new GetOrdersAction(this.filter));
  }
}
