import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

/**
 * App-wide loading state (migrated from the NGXS LoaderState).
 * Pattern for our client/UI stores: an NgRx SignalStore, `providedIn: 'root'`,
 * living under `core/state/` when app-wide (feature-scoped stores live with
 * their feature). Read signals directly in templates — no async pipe.
 */
interface LoaderState {
	status: boolean;
	loadingCount: number;
	buttonSpinner: boolean;
	buttonId: string | null;
}

const initialState: LoaderState = {
	status: false,
	loadingCount: 0,
	buttonSpinner: false,
	buttonId: null,
};

export const LoaderStore = signalStore(
	{ providedIn: 'root' },
	withState(initialState),
	withMethods((store) => ({
		showLoader(loading: boolean): void {
			patchState(store, (s) => ({ status: loading, loadingCount: s.loadingCount + 1 }));
		},
		hideLoader(): void {
			patchState(store, (s) => ({
				status: s.loadingCount === 1 ? false : true,
				loadingCount: s.loadingCount - 1,
			}));
		},
		showButtonSpinner(loading: boolean, id?: string): void {
			patchState(store, { buttonSpinner: loading, buttonId: id ?? null });
		},
		hideButtonSpinner(): void {
			patchState(store, { buttonSpinner: false });
		},
	})),
);
