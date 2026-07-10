import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { PointService } from '@data-access/services/point.service';

/**
 * TanStack Query for the user's point/reward transactions (replaces NGXS
 * PointState + GetUserTransactionAction). Keyed on the paginate params signal.
 */
export function injectPointTransactionsQuery(params: () => Params) {
  const pointService = inject(PointService);
  return injectQuery(() => ({
    queryKey: ['point-transactions', params()],
    queryFn: () => firstValueFrom(pointService.getUserTransaction(params())),
  }));
}
