import { EnvironmentProviders, TransferState, inject, provideEnvironmentInitializer } from '@angular/core';

import { dehydrate } from '@tanstack/angular-query-experimental';

import { QUERY_CLIENT, QUERY_STATE, isPublicQuery } from './query-client';

/**
 * Ships the public queries' data in the server HTML so the browser's first render matches it.
 *
 * `onSerialize` runs while the transfer state is being written. A `BEFORE_APP_SERIALIZED`
 * callback provided here runs after that write, so its value never reaches the page.
 */
export function provideQueryTransfer(): EnvironmentProviders {
	return provideEnvironmentInitializer(() => {
		const client = inject(QUERY_CLIENT);
		inject(TransferState).onSerialize(QUERY_STATE, () =>
			dehydrate(client, {
				shouldDehydrateQuery: (query) => query.state.status === 'success' && isPublicQuery(query.queryKey),
			}),
		);
	});
}
