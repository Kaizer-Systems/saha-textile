import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

/**
 * Global loading/spinner state (replaces NGXS LoaderState + its Show/Hide
 * loader/button-spinner actions). Root-provided NgRx SignalStore — the first of
 * the app-shell states moving off NGXS in phase 5c-B.
 *
 * `loadingCount` ref-counts in-flight requests so overlapping calls don't clear
 * the loader early (ported verbatim from the old reducers).
 */
interface LoaderStateModel {
	status: boolean;
	loadingCount: number;
	button_spinner: boolean;
	button_id: string | null;
}

const initialState: LoaderStateModel = {
	status: false,
	loadingCount: 0,
	button_spinner: false,
	button_id: null,
};

export const LoaderStore = signalStore(
	{ providedIn: 'root' },
	withState(initialState),
	withMethods((store) => ({
		showLoader(loading = true): void {
			const count = (store.loadingCount() ? store.loadingCount() : 0) + 1;
			// A GET turns the loader on; a non-GET (loading=false) leaves the current
			// state so it doesn't hide an in-flight GET's loader.
			patchState(store, { status: loading ? true : store.status(), loadingCount: count });
		},
		hideLoader(): void {
			// Clamp at 0 and force status off once the ref-count fully drains, so a
			// timing drift in the deferred-show/sync-hide interceptor can't leave the
			// loader overlay stuck on (the old `count === 1` check could stick).
			const count = Math.max(0, store.loadingCount() - 1);
			patchState(store, { status: count === 0 ? false : store.status(), loadingCount: count });
		},
		showButtonSpinner(loading = true): void {
			patchState(store, { button_spinner: loading });
		},
		hideButtonSpinner(): void {
			patchState(store, { button_spinner: false });
		},
	})),
);
