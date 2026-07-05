import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetUserTransactionAction } from '@data-access/actions/wallet.action';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IWallet } from '@data-access/interfaces/wallet.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { WalletState } from '@data-access/states/wallet.state';

@Component({
  selector: 'app-wallet',
  templateUrl: './wallet.html',
  styleUrls: ['./wallet.scss'],
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
export class Wallet {
  private store = inject(Store);

  wallet$: Observable<IWallet> = inject(Store).select(WalletState.wallet) as Observable<IWallet>;

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
