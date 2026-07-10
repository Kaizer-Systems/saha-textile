import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { injectWalletTransactionsQuery } from '@data-access/queries/wallet.queries';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IWallet } from '@data-access/interfaces/wallet.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

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
  public filter = signal<Params>({
    page: 1, // Current page number
    paginate: 10, // Display per page,
  });

  private readonly walletQuery = injectWalletTransactionsQuery(() => this.filter());
  // Template reads via optional chaining, so emit the raw query data (undefined
  // until loaded) rather than a partial IWallet placeholder.
  wallet$: Observable<IWallet | undefined> = toObservable(computed(() => this.walletQuery.data()));

  setPaginate(page: number) {
    this.filter.update(f => ({ ...f, page }));
  }
}
