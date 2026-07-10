import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { injectRefundsQuery } from '@data-access/queries/refund.queries';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IRefundModel } from '@data-access/interfaces/refund.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

@Component({
  selector: 'app-refund',
  templateUrl: './refund.html',
  styleUrls: ['./refund.scss'],
  imports: [Pagination, NoData, AsyncPipe, DatePipe, TitleCasePipe, TranslateModule],
})
export class Refund {
  public filter = signal<Params>({
    page: 1, // Current page number
    paginate: 10, // Display per page,
  });

  private readonly refundsQuery = injectRefundsQuery(() => this.filter());
  refund$: Observable<IRefundModel | undefined> = toObservable(
    computed(() => this.refundsQuery.data()),
  );

  setPaginate(page: number) {
    this.filter.update(f => ({ ...f, page }));
  }
}
