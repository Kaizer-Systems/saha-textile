import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { injectOrdersQuery } from '@data-access/queries/order.queries';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IOrderModel } from '@data-access/interfaces/order.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

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
  public filter = signal<Params>({
    page: 1, // Current page number
    paginate: 10, // Display per page,
  });

  private readonly ordersQuery = injectOrdersQuery(() => this.filter());
  order$: Observable<IOrderModel | undefined> = toObservable(
    computed(() => this.ordersQuery.data()),
  );

  setPaginate(page: number) {
    this.filter.update(f => ({ ...f, page }));
  }
}
