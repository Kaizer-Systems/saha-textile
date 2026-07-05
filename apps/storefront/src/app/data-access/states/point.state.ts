import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetUserTransactionAction } from '@data-access/actions/point.action';
import { ITransactionsData } from '@data-access/interfaces/point.interface';
import { PointService } from '../services/point.service';

export class PointStateModel {
  point = {
    balance: 0 as number,
    transactions: {
      data: [] as ITransactionsData[],
      total: 0,
    },
  };
}

@State<PointStateModel>({
  name: 'point',
  defaults: {
    point: {
      balance: 0 as number,
      transactions: {
        data: [],
        total: 0,
      },
    },
  },
})
@Injectable()
export class PointState {
  private pointService = inject(PointService);

  @Selector()
  static point(state: PointStateModel) {
    return state.point;
  }

  @Action(GetUserTransactionAction)
  getUserTransaction(ctx: StateContext<PointStateModel>, { payload }: GetUserTransactionAction) {
    return this.pointService.getUserTransaction(payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            point: {
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
            point: {
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
