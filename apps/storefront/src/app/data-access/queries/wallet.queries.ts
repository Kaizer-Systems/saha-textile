import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { WalletService } from '@data-access/services/wallet.service';

/**
 * TanStack Query for the user's wallet transactions (replaces NGXS WalletState +
 * GetUserTransactionAction). Keyed on the paginate params signal.
 */
export function injectWalletTransactionsQuery(params: () => Params) {
	const walletService = inject(WalletService);
	return injectQuery(() => ({
		queryKey: ['wallet-transactions', params()],
		queryFn: () => firstValueFrom(walletService.getUserTransaction(params())),
	}));
}
