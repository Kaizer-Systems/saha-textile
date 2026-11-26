import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

/** Shell state: which of the current repository's environments the console is looking at. */
export const ConsoleState = signalStore(
	{ providedIn: 'root' },
	withState<{ environment: string }>({ environment: 'local' }),
	withMethods((store) => ({
		setEnvironment(environment: string): void {
			patchState(store, { environment });
		},
	})),
);
