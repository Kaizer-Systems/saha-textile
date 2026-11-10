import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

import type { ConsoleEnvironment } from '@saha-textile/release-console-contracts';

/** Shell state: which environment the console is looking at. */
export const ConsoleState = signalStore(
	{ providedIn: 'root' },
	withState<{ environment: ConsoleEnvironment }>({ environment: 'local' }),
	withMethods((store) => ({
		setEnvironment(environment: ConsoleEnvironment): void {
			patchState(store, { environment });
		},
	})),
);
