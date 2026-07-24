import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PaymentDetailsService } from '@data-access/services/payment-details.service';

/** Payment/bank details (replaces NGXS PaymentDetailsState + GetPaymentDetailsAction). */
export function injectPaymentDetailsQuery() {
	const paymentDetailsService = inject(PaymentDetailsService);
	return injectQuery(() => ({
		queryKey: ['payment-details'],
		queryFn: () => firstValueFrom(paymentDetailsService.getPaymentAccount()),
	}));
}
