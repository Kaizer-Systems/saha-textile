import {
	EnvironmentProviders,
	PendingTasks,
	TransferState,
	inject,
	provideEnvironmentInitializer,
} from '@angular/core';

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

const SETTLE_MS = 5;

/**
 * Holds a server render open while any query is fetching.
 *
 * TanStack runs outside the Angular zone, so between a query starting and its request going
 * out nothing tells Angular there is work left. It could call the page stable and send it
 * without its data, which is what a search engine would then read.
 */
export function provideServerQueryWait(): EnvironmentProviders {
	return provideEnvironmentInitializer(() => {
		const tasks = inject(PendingTasks);
		const client = inject(QUERY_CLIENT);
		let finish: (() => void) | null = null;
		const release = () => {
			if (client.isFetching() > 0) return;
			finish?.();
			finish = null;
		};
		client.getQueryCache().subscribe(() => {
			if (client.isFetching() > 0) finish ??= tasks.add();
			// TanStack tells its observers on a later turn, so the view has yet to hear about this.
			else if (finish) setTimeout(release, SETTLE_MS);
		});
	});
}
