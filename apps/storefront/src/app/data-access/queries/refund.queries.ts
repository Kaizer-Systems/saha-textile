import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { RefundService } from '@data-access/services/refund.service';

/** Refund list (replaces NGXS RefundState + GetRefundAction). Keyed on paginate params. */
export function injectRefundsQuery(params: () => Params) {
  const refundService = inject(RefundService);
  return injectQuery(() => ({
    queryKey: ['refunds', params()],
    queryFn: () => firstValueFrom(refundService.getRefunds(params())),
  }));
}
