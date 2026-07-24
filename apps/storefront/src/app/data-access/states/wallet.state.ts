import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetUserTransactionAction } from '@data-access/actions/wallet.action';
import { ITransactionsData } from '@data-access/interfaces/wallet.interface';
import { WalletService } from '../services/wallet.service';

export class WalletStateModel {
  wallet = {
    balance: 0 as number,
    transactions: {
      data: [] as ITransactionsData[],
      total: 0,
    },
  };
}

@State<WalletStateModel>({
  name: 'wallet',
  defaults: {
    wallet: {
      balance: 0 as number,
      transactions: {
        data: [],
        total: 0,
      },
    },
  },
})
@Injectable()
export class WalletState {
  private walletService = inject(WalletService);

  @Selector()
  static wallet(state: WalletStateModel) {
    return state.wallet;
  }

  @Action(GetUserTransactionAction)
  getUserTransations(ctx: StateContext<WalletStateModel>, { payload }: GetUserTransactionAction) {
    return this.walletService.getUserTransaction(payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            wallet: {
              balance: result?.balance,
              transactions: {
                data: result?.transactions?.data,
                total: result?.transactions?.total
                  ? result?.transactions?.total
                  : result?.transactions?.data.length,
              },
            },
          });
        },
        error: err => {
          ctx.patchState({
            wallet: {
              balance: 0,
              transactions: {
                data: [],
                total: 0,
              },
            },
          });
          throw new Error(err?.error?.message);
        },
      }),
    );
  }
}
