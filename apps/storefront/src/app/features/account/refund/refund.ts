import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetRefundAction } from '@data-access/actions/refund.action';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IRefundModel } from '@data-access/interfaces/refund.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { RefundState } from '@data-access/states/refund.state';

@Component({
  selector: 'app-refund',
  templateUrl: './refund.html',
  styleUrls: ['./refund.scss'],
  imports: [Pagination, NoData, AsyncPipe, DatePipe, TitleCasePipe, TranslateModule],
})
export class Refund {
  private store = inject(Store);

  refund$: Observable<IRefundModel> = inject(Store).select(
    RefundState.refund,
  ) as Observable<IRefundModel>;

  public filter: Params = {
    page: 1, // Current page number
    paginate: 10, // Display per page,
  };

  constructor() {
    this.store.dispatch(new GetRefundAction(this.filter));
  }

  setPaginate(page: number) {
    this.filter['page'] = page;
    this.store.dispatch(new GetRefundAction(this.filter));
  }
}
